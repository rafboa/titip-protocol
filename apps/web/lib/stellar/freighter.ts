import {
  isConnected as freighterIsConnected,
  isAllowed as freighterIsAllowed,
  setAllowed as freighterSetAllowed,
  getAddress as freighterGetAddress,
  getNetwork as freighterGetNetwork,
  signTransaction as freighterSignTransaction,
  signAuthEntry as freighterSignAuthEntry,
} from '@stellar/freighter-api';
import { STELLAR_CONFIG } from './config';

export class FreighterError extends Error {
  constructor(
    public readonly code: 'NOT_INSTALLED' | 'WRONG_NETWORK' | 'REJECTED',
    message: string,
    /** Template vars for localizing this error at the UI layer (e.g. { network: 'Testnet' }) */
    public readonly vars?: Record<string, string>
  ) {
    super(message);
    this.name = 'FreighterError';
  }
}

export async function checkConnection(): Promise<boolean> {
  const connected = await freighterIsConnected();
  if ('error' in connected && connected.error) return false;
  if (!connected.isConnected) return false;

  const allowed = await freighterIsAllowed();
  if (!allowed.isAllowed) {
    const granted = await freighterSetAllowed();
    return granted.isAllowed;
  }
  return true;
}

export async function getPublicKey(): Promise<string> {
  const result = await freighterGetAddress();
  if ('error' in result && result.error) {
    throw new Error(`Freighter error: ${result.error}`);
  }
  if (!result.address) {
    throw new Error('Freighter wallet not connected or public key unavailable.');
  }
  return result.address;
}

/** Expected Freighter network string for the app's configured Stellar network. */
export function expectedFreighterNetwork(): 'TESTNET' | 'PUBLIC' {
  return STELLAR_CONFIG.network === 'mainnet' ? 'PUBLIC' : 'TESTNET';
}

/**
 * Network guard — ALWAYS call before any Freighter signing call.
 * Throws FreighterError('WRONG_NETWORK') if Freighter isn't on the network the app expects.
 */
export async function assertCorrectNetwork(): Promise<void> {
  const expected = expectedFreighterNetwork();
  const details = await freighterGetNetwork();
  // English default message (dev/log fallback) — UI layers localize by
  // catching FreighterError and mapping .code + .vars through useTranslation().
  if ('error' in details && details.error) {
    throw new FreighterError('NOT_INSTALLED', 'Freighter wallet not detected or connection refused.');
  }
  if (details.network !== expected) {
    const networkLabel = expected === 'TESTNET' ? 'Testnet' : 'Mainnet';
    throw new FreighterError('WRONG_NETWORK', `Please switch Freighter to ${networkLabel}.`, {
      network: networkLabel,
    });
  }
}

function normalizeSignError(e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  if (/declin|reject/i.test(message)) {
    throw new FreighterError('REJECTED', 'Transaction was rejected in Freighter.');
  }
  throw e instanceof Error ? e : new Error(message);
}

export async function signTx(xdr: string): Promise<string> {
  await assertCorrectNetwork();
  try {
    const signed = await freighterSignTransaction(xdr, {
      networkPassphrase: STELLAR_CONFIG.networkPassphrase,
    });
    if ('error' in signed && signed.error) {
      throw new Error(`Freighter error: ${signed.error}`);
    }
    return signed.signedTxXdr;
  } catch (e) {
    normalizeSignError(e);
  }
}

export async function signAuth(entryXdr: string): Promise<string> {
  await assertCorrectNetwork();
  try {
    const signed = await freighterSignAuthEntry(entryXdr, {
      networkPassphrase: STELLAR_CONFIG.networkPassphrase,
    });
    if ('error' in signed && signed.error) {
      throw new Error(`Freighter error: ${signed.error}`);
    }
    if (!signed.signedAuthEntry) {
      throw new Error('Freighter did not return a signed auth entry.');
    }
    return signed.signedAuthEntry;
  } catch (e) {
    normalizeSignError(e);
  }
}
