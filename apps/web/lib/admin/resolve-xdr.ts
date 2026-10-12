// Reads a Freighter-signed transaction BEFORE the server submits it.
//
// The admin signs an XDR the browser sends back, so the server must not trust what the request body
// says about it: the split it records in the database, the escrow it updates and the notifications
// it sends all come from the arguments decoded here, never from a field next to the XDR.

import { Address, FeeBumpTransaction, TransactionBuilder, scValToNative, xdr } from '@stellar/stellar-sdk'

export type DecodedResolveTx = {
  /** The account that signs and pays: must be the contract admin (checked by the caller). */
  source: string
  escrowId: bigint
  buyerBps: number
  /** Lowercase hex transaction hash, to look the transaction up later. */
  txHash: string
}

export class ResolveTxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResolveTxError'
  }
}

/**
 * Accepts exactly one operation: `resolve_dispute_split(escrow_id, buyer_bps)` on `contractAddress`,
 * carrying at least one signature. Anything else (another function, another contract, extra
 * operations, a fee bump) is rejected.
 */
export function decodeResolveSplitTx(
  signedXdr: string,
  networkPassphrase: string,
  contractAddress: string
): DecodedResolveTx {
  let parsed
  try {
    parsed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
  } catch {
    throw new ResolveTxError('The signed transaction cannot be read')
  }
  if (parsed instanceof FeeBumpTransaction) throw new ResolveTxError('Fee-bump transactions are not accepted')
  if (parsed.signatures.length === 0) throw new ResolveTxError('The transaction is not signed')
  if (parsed.operations.length !== 1) throw new ResolveTxError('Expected exactly one operation')

  const op = parsed.operations[0]
  if (op.type !== 'invokeHostFunction') throw new ResolveTxError('Expected a contract call')
  if (op.source && op.source !== parsed.source) throw new ResolveTxError('The operation has a different source')
  if (op.func.switch().name !== 'hostFunctionTypeInvokeContract') throw new ResolveTxError('Expected a contract call')

  const call = op.func.invokeContract()
  if (Address.fromScAddress(call.contractAddress()).toString() !== contractAddress) {
    throw new ResolveTxError('The call targets a different contract')
  }
  if (call.functionName().toString() !== 'resolve_dispute_split') {
    throw new ResolveTxError('Expected a call to resolve_dispute_split')
  }
  const args: xdr.ScVal[] = call.args()
  if (args.length !== 2) throw new ResolveTxError('Unexpected arguments')

  const escrowId: unknown = scValToNative(args[0])
  const buyerBps: unknown = scValToNative(args[1])
  if (typeof escrowId !== 'bigint' || typeof buyerBps !== 'number') throw new ResolveTxError('Unexpected argument types')

  return { source: parsed.source, escrowId, buyerBps, txHash: parsed.hash().toString('hex') }
}
