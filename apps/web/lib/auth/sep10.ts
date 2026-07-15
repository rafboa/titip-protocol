// lib/auth/sep10.ts
// SEP-10 Web Authentication helpers for Titip Protocol
// Spec: https://stellar.org/protocol/sep-10
//
// Flow:
//   1. Client calls GET /api/auth/challenge?account=G...
//   2. Server builds a Stellar "challenge" transaction (manage_data op, random nonce)
//      signed with a server keypair, and returns the XDR.
//   3. Client signs the XDR with Freighter (adds their signature).
//   4. Client POSTs the signed XDR to /api/auth/verify.
//   5. Server validates both signatures and the nonce, then issues a JWT.

import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  StrKey,
} from '@stellar/stellar-sdk'
import { SignJWT, jwtVerify } from 'jose'
import { STELLAR_CONFIG } from '@/lib/stellar/config'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// SEP-10 challenge transaction is valid for 5 minutes
const CHALLENGE_EXPIRY_SECONDS = 5 * 60

// JWT issued after verification is valid for 7 days
const JWT_EXPIRY = '7d'

// Manage data key used in the challenge operation
const SEP10_MANAGE_DATA_KEY = 'titip_auth'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the network passphrase string for the current environment.
 * Used when constructing/verifying Stellar transactions server-side.
 */
function getNetworkPassphrase(): string {
  return STELLAR_CONFIG.networkPassphrase as string
}

/**
 * Returns the server signing keypair from env.
 * The SERVER signing keypair is the oracle keypair re-used here for SEP-10.
 * v1.1: Use a dedicated SEP10_SERVER_SECRET env var separate from the oracle key.
 */
function getServerKeypair(): Keypair {
  const secret = process.env.ORACLE_SECRET_KEY
  if (!secret) {
    throw new Error('ORACLE_SECRET_KEY environment variable is not set')
  }
  return Keypair.fromSecret(secret)
}

/**
 * Returns the jose SecretKey for JWT signing/verification.
 */
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set')
  }
  return new TextEncoder().encode(secret)
}

// ---------------------------------------------------------------------------
// Challenge transaction builder
// ---------------------------------------------------------------------------

type BuildChallengeResult = {
  transactionXdr: string
  /** ISO-8601 expiry time of the challenge transaction */
  expiresAt: string
}

/**
 * Builds a SEP-10 challenge transaction for a given Stellar account.
 *
 * The transaction:
 *  - Has the server account as the source (server pays the fee conceptually)
 *  - Contains a manage_data operation sourced to the CLIENT account
 *  - Contains a 48-byte random nonce in the manage_data value
 *  - Is signed by the server keypair
 *  - Expires in CHALLENGE_EXPIRY_SECONDS (5 minutes)
 *
 * Returns the XDR of the signed transaction.
 */
export async function buildChallenge(clientPublicKey: string): Promise<BuildChallengeResult> {
  if (!StrKey.isValidEd25519PublicKey(clientPublicKey)) {
    throw new Error('Invalid Stellar public key')
  }

  const serverKeypair = getServerKeypair()
  const networkPassphrase = getNetworkPassphrase()

  // Use a dummy sequence number — SEP-10 challenge transactions do NOT need
  // a real account sequence; the client only signs, never submits to the ledger.
  // We create a minimal account-like object instead of fetching from Horizon
  // to avoid a network round-trip and keep this pure/fast.
  const serverPublicKey = serverKeypair.publicKey()

  // 48-byte random nonce encoded as base64 (gives 64 chars, fits manage_data's 64-byte limit)
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString('base64')

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + CHALLENGE_EXPIRY_SECONDS

  // Build using a synthetic account with sequence 0 — valid for SEP-10
  const { Account } = await import('@stellar/stellar-sdk')
  const serverAccount = new Account(serverPublicKey, '0')

  const tx = new TransactionBuilder(serverAccount, {
    fee: String(BASE_FEE),
    networkPassphrase,
    timebounds: {
      minTime: now,
      maxTime: expiresAt,
    },
  })
    .addOperation(
      // The manage_data source is the CLIENT account — this forces the client to sign
      Operation.manageData({
        name: SEP10_MANAGE_DATA_KEY,
        value: nonce,
        source: clientPublicKey,
      })
    )
    .addOperation(
      // Second op to include the web_auth_domain per SEP-10 spec
      Operation.manageData({
        name: 'web_auth_domain',
        value: process.env.SEP10_WEB_AUTH_DOMAIN ?? 'localhost:3000',
        source: serverPublicKey,
      })
    )
    .build()

  // Server signs first
  tx.sign(serverKeypair)

  return {
    transactionXdr: tx.toXDR(),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Challenge verification
// ---------------------------------------------------------------------------

type VerifyResult = {
  /** JWT token for the authenticated session */
  token: string
  /** The verified Stellar public key */
  address: string
}

/**
 * Verifies a signed SEP-10 challenge transaction and issues a JWT.
 *
 * Checks:
 *  1. The transaction is a valid Stellar transaction
 *  2. The first operation is manage_data with key SEP10_MANAGE_DATA_KEY
 *  3. The transaction is signed by BOTH the server keypair AND the client account
 *  4. The transaction has not expired (timebounds)
 *
 * Returns a signed JWT containing the client's address on success.
 */
export async function verifyChallenge(signedXdr: string): Promise<VerifyResult> {
  const networkPassphrase = getNetworkPassphrase()
  const serverKeypair = getServerKeypair()

  let tx: Transaction
  try {
    tx = new Transaction(signedXdr, networkPassphrase)
  } catch {
    throw new Error('Invalid transaction XDR')
  }

  // 1. Check timebounds — transaction must not have expired
  const now = Math.floor(Date.now() / 1000)
  const { minTime, maxTime } = tx.timeBounds ?? {}
  if (!minTime || !maxTime) {
    throw new Error('Challenge transaction must have timebounds')
  }
  if (now < Number(minTime) || now > Number(maxTime)) {
    throw new Error('Challenge transaction has expired or is not yet valid')
  }

  // 2. Validate first operation is manage_data with correct key
  const [firstOp] = tx.operations
  if (firstOp?.type !== 'manageData' || firstOp.name !== SEP10_MANAGE_DATA_KEY) {
    throw new Error('Invalid challenge: unexpected first operation')
  }

  // 3. The source of the first operation is the client's public key
  const clientPublicKey = firstOp.source
  if (!clientPublicKey || !StrKey.isValidEd25519PublicKey(clientPublicKey)) {
    throw new Error('Challenge transaction missing valid client public key on first operation')
  }

  // 4. Verify both signatures exist
  const signers = [serverKeypair.publicKey(), clientPublicKey]
  const txHash = tx.hash()

  for (const signerPublicKey of signers) {
    const keypairForVerify = Keypair.fromPublicKey(signerPublicKey)
    const matchingSignature = tx.signatures.find((sig) => {
      try {
        return keypairForVerify.verify(txHash, sig.signature())
      } catch {
        return false
      }
    })
    if (!matchingSignature) {
      throw new Error(
        `Challenge transaction is missing a valid signature from ${
          signerPublicKey === serverKeypair.publicKey() ? 'the server' : 'the client'
        }`
      )
    }
  }

  // All checks passed — issue JWT
  const secret = getJwtSecret()
  const token = await new SignJWT({ sub: clientPublicKey, address: clientPublicKey })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .setIssuer(process.env.SEP10_WEB_AUTH_DOMAIN ?? 'titip-protocol')
    .sign(secret)

  return { token, address: clientPublicKey }
}

// ---------------------------------------------------------------------------
// JWT verification (for use in protected API routes)
// ---------------------------------------------------------------------------

type JwtPayload = {
  sub: string
  address: string
  iat: number
  exp: number
}

/**
 * Verifies a Bearer JWT from an Authorization header value and returns the payload.
 * Throws on invalid/expired token.
 *
 * Usage in a route handler:
 *   const payload = await verifyJwt(request.headers.get('authorization') ?? '')
 */
export async function verifyJwt(authHeader: string): Promise<JwtPayload> {
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    throw new Error('Missing authorization token')
  }

  const secret = getJwtSecret()
  const { payload } = await jwtVerify(token, secret, {
    issuer: process.env.SEP10_WEB_AUTH_DOMAIN ?? 'titip-protocol',
  })

  if (typeof payload.sub !== 'string' || typeof payload.address !== 'string') {
    throw new Error('Invalid token payload')
  }

  return payload as JwtPayload
}
