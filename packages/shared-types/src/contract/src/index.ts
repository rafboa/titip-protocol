import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





/**
 * Global contract configuration.
 */
export interface Config {
  admin: string;
  next_escrow_id: u64;
  oracle: string;
  token: string;
}


/**
 * Core escrow record stored on-chain.
 */
export interface Escrow {
  amount: i128;
  buyer: string;
  /**
 * Courier code (e.g., "jnt", "jne", "sicepat").
 */
courier_code: string;
  escrow_id: u64;
  seller: string;
  status: EscrowStatus;
  /**
 * Ledger sequence number after which the buyer can claim a refund.
 */
timeout_ledger: u32;
  token: string;
  /**
 * Tracking number submitted by the seller.
 */
tracking_number: string;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Escrow", values: readonly [u64]} | {tag: "OracleSet", values: void} | {tag: "Approvals", values: readonly [u64]} | {tag: "Evidence", values: readonly [u64]};


/**
 * M-of-N oracle set. When present it replaces the single `Config.oracle`: delivery is released
 * only once `threshold` distinct oracles from `oracles` have approved it.
 */
export interface OracleSet {
  oracles: Array<string>;
  threshold: u32;
}

export const EscrowError = {
  /**
   * Contract has already been initialized.
   */
  1: {message:"AlreadyInitialized"},
  /**
   * Contract has not been initialized yet.
   */
  2: {message:"NotInitialized"},
  /**
   * Caller is not authorized for this operation.
   */
  3: {message:"Unauthorized"},
  /**
   * The escrow is not in the expected status for this operation.
   */
  4: {message:"InvalidStatus"},
  /**
   * The amount must be greater than zero.
   */
  5: {message:"InvalidAmount"},
  /**
   * Timeout must be at least 1000 ledgers in the future.
   */
  6: {message:"InvalidTimeout"},
  /**
   * The specified escrow ID does not exist.
   */
  7: {message:"EscrowNotFound"},
  /**
   * Timeout has not yet been reached; cannot refund.
   */
  8: {message:"TimeoutNotReached"},
  /**
   * Buyer cannot be the same address as seller.
   */
  9: {message:"BuyerIsSeller"},
  /**
   * Oracle set is empty, too large, has duplicates, or the threshold is out of range.
   */
  10: {message:"InvalidOracleSet"},
  /**
   * Basis points must be between 0 and 10_000.
   */
  11: {message:"InvalidBps"},
  /**
   * Evidence limit reached or the evidence pointer is too long.
   */
  12: {message:"EvidenceLimit"}
}

/**
 * Escrow lifecycle states — terminal states are DELIVERED and REFUNDED.
 */
export type EscrowStatus = {tag: "Pending", values: void} | {tag: "Funded", values: void} | {tag: "Shipped", values: void} | {tag: "Delivered", values: void} | {tag: "Refunded", values: void} | {tag: "Disputed", values: void};


/**
 * One piece of dispute evidence: a SHA-256 hash of the file plus an optional pointer (e.g. an
 * IPFS CID or a URL). The file itself is never stored on-chain.
 */
export interface EvidenceItem {
  hash: Buffer;
  ledger: u32;
  submitter: string;
  uri: string;
}

export interface Client {
  /**
   * Construct and simulate a fund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Fund an escrow by transferring USDC from the buyer to this contract.
   * 
   * Transitions: PENDING → FUNDED.
   * 
   * The buyer must have approved or have sufficient balance for the SAC token transfer.
   * 
   * # Arguments
   * * `escrow_id` — The escrow to fund.
   */
  fund: ({escrow_id}: {escrow_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the current contract configuration.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Config>>>

  /**
   * Construct and simulate a get_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get an escrow by ID. Returns None if not found.
   */
  get_escrow: ({escrow_id}: {escrow_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Escrow>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize the contract with admin, oracle, and USDC token addresses.
   * 
   * Must be called exactly once before any other function.
   * 
   * # Arguments
   * * `admin`  — Administrator address (can update oracle, pause contract in v1.1).
   * * `oracle` — Courier oracle address (only address allowed to call `confirm_delivery`).
   * * `token`  — SAC token contract address for USDC.
   */
  initialize: ({admin, oracle, token}: {admin: string, oracle: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_oracles transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Replace the oracle set. Admin only. `threshold` of the `oracles` must approve a delivery.
   * Approvals already collected stay stored, but only those from oracles that remain in the
   * set are counted.
   */
  set_oracles: ({oracles, threshold}: {oracles: Array<string>, threshold: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claim_refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Buyer claims a refund after the timeout has passed.
   * 
   * Transitions: FUNDED | SHIPPED → REFUNDED (terminal).
   * 
   * The refund is only available after `timeout_ledger` has been reached.
   * A DELIVERED escrow can never be refunded (business rule #3).
   * 
   * # Arguments
   * * `escrow_id` — The escrow to refund.
   */
  claim_refund: ({escrow_id}: {escrow_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_evidence transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * All evidence committed for an escrow, oldest first.
   */
  get_evidence: ({escrow_id}: {escrow_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Array<EvidenceItem>>>

  /**
   * Construct and simulate a create_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a new escrow between buyer and seller.
   * 
   * Does NOT transfer funds — the buyer must call `fund()` separately.
   * This two-step flow allows the frontend to show a preview before locking funds.
   * 
   * # Arguments
   * * `buyer`           — Buyer's Stellar address.
   * * `seller`          — Seller's Stellar address (derived from QRIS merchant ID).
   * * `amount`          — USDC amount in base units (7 decimals). 50 USDC = 500_000_000.
   * * `timeout_ledger`  — Ledger number after which the buyer can claim a refund.
   * Must be at least current_ledger + MIN_TIMEOUT_LEDGERS.
   * 
   * # Returns
   * The new escrow ID.
   */
  create_escrow: ({buyer, seller, amount, timeout_ledger}: {buyer: string, seller: string, amount: i128, timeout_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a update_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the oracle address. Only the admin can call this.
   * 
   * # Arguments
   * * `new_oracle` — New oracle address to authorize for `confirm_delivery`.
   */
  update_oracle: ({new_oracle}: {new_oracle: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a dispute_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Dispute an escrow transaction. Can be called by the buyer, the seller, or the
   * whitelisted oracle (which freezes the escrow when the courier reports a return to
   * sender). The oracle can only move funds INTO dispute; it still cannot release them:
   * only `resolve_dispute` (admin) pays out a disputed escrow.
   * 
   * Transitions: FUNDED | SHIPPED -> DISPUTED.
   */
  dispute_escrow: ({escrow_id, caller}: {escrow_id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_oracle_set transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The configured M-of-N oracle set, or `None` while the contract still uses the single oracle.
   */
  get_oracle_set: (options?: MethodOptions) => Promise<AssembledTransaction<Option<OracleSet>>>

  /**
   * Construct and simulate a resolve_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin resolves a dispute by sending funds to the winner.
   * 
   * Transitions: DISPUTED -> DELIVERED (if seller wins) or REFUNDED (if buyer wins).
   */
  resolve_dispute: ({escrow_id, winner}: {escrow_id: u64, winner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_evidence transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Buyer or seller commits the SHA-256 hash of a piece of evidence (photo, unboxing video) for
   * a disputed escrow. The file stays off-chain; `uri` is an optional pointer (e.g. a CID).
   * Each party may submit at most 10 items. Evidence can only be added while Disputed.
   */
  submit_evidence: ({escrow_id, party, hash, uri}: {escrow_id: u64, party: string, hash: Buffer, uri: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_tracking transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Seller submits a tracking number and courier code.
   * 
   * Transitions: FUNDED → SHIPPED.
   * 
   * # Arguments
   * * `escrow_id`       — The escrow to update.
   * * `tracking_number` — Courier tracking number.
   * * `courier_code`    — Courier identifier (e.g., "jnt", "jne", "sicepat").
   */
  submit_tracking: ({escrow_id, tracking_number, courier_code}: {escrow_id: u64, tracking_number: string, courier_code: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a approve_delivery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One oracle of the configured set approves delivery. When `threshold` distinct, currently
   * listed oracles have approved, the funds are released to the seller.
   * 
   * Returns `true` if this call released the funds. Calling again with an oracle that has
   * already approved is allowed and only re-evaluates (it never counts twice), which also
   * completes a delivery whose threshold was lowered after the approvals were collected.
   * 
   * Transitions: SHIPPED -> DELIVERED (terminal) once the threshold is met.
   */
  approve_delivery: ({escrow_id, oracle}: {escrow_id: u64, oracle: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>

  /**
   * Construct and simulate a confirm_delivery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Oracle confirms delivery — releases USDC to the seller.
   * 
   * Transitions: SHIPPED → DELIVERED (terminal).
   * 
   * Only the oracle address stored in Config can call this function.
   * The contract will reject any other invoker.
   * 
   * # Arguments
   * * `escrow_id` — The escrow to confirm.
   */
  confirm_delivery: ({escrow_id}: {escrow_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a resolve_dispute_split transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin resolves a dispute with a proportional split, e.g. `buyer_bps = 7000` refunds 70% to
   * the buyer and pays 30% to the seller.
   * 
   * The buyer's share is rounded down and the seller receives the remainder, so the two
   * payouts always add up to exactly the locked amount. Transitions: DISPUTED -> REFUNDED when
   * the buyer gets everything (`buyer_bps = 10_000`), otherwise DISPUTED -> DELIVERED.
   */
  resolve_dispute_split: ({escrow_id, buyer_bps}: {escrow_id: u64, buyer_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_delivery_approvals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Oracles that have approved delivery of this escrow so far.
   */
  get_delivery_approvals: ({escrow_id}: {escrow_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAB5HbG9iYWwgY29udHJhY3QgY29uZmlndXJhdGlvbi4AAAAAAAAAAAAGQ29uZmlnAAAAAAAEAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADm5leHRfZXNjcm93X2lkAAAAAAAGAAAAAAAAAAZvcmFjbGUAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAQAAACNDb3JlIGVzY3JvdyByZWNvcmQgc3RvcmVkIG9uLWNoYWluLgAAAAAAAAAABkVzY3JvdwAAAAAACQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAVidXllcgAAAAAAABMAAAAtQ291cmllciBjb2RlIChlLmcuLCAiam50IiwgImpuZSIsICJzaWNlcGF0IikuAAAAAAAADGNvdXJpZXJfY29kZQAAABAAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADEVzY3Jvd1N0YXR1cwAAAEBMZWRnZXIgc2VxdWVuY2UgbnVtYmVyIGFmdGVyIHdoaWNoIHRoZSBidXllciBjYW4gY2xhaW0gYSByZWZ1bmQuAAAADnRpbWVvdXRfbGVkZ2VyAAAAAAAEAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAoVHJhY2tpbmcgbnVtYmVyIHN1Ym1pdHRlZCBieSB0aGUgc2VsbGVyLgAAAA90cmFja2luZ19udW1iZXIAAAAAEA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAQAAAAAAAAAGRXNjcm93AAAAAAABAAAABgAAAAAAAAA7T3B0aW9uYWwgTS1vZi1OIG9yYWNsZSBzZXQgKGFic2VudCA9IGxlZ2FjeSBzaW5nbGUgb3JhY2xlKS4AAAAACU9yYWNsZVNldAAAAAAAAAEAAAAsT3JhY2xlcyB0aGF0IGFwcHJvdmVkIGRlbGl2ZXJ5IG9mIGFuIGVzY3Jvdy4AAAAJQXBwcm92YWxzAAAAAAAAAQAAAAYAAAABAAAAKUV2aWRlbmNlIGNvbW1pdHRlZCBmb3IgYSBkaXNwdXRlZCBlc2Nyb3cuAAAAAAAACEV2aWRlbmNlAAAAAQAAAAY=",
        "AAAAAQAAAKRNLW9mLU4gb3JhY2xlIHNldC4gV2hlbiBwcmVzZW50IGl0IHJlcGxhY2VzIHRoZSBzaW5nbGUgYENvbmZpZy5vcmFjbGVgOiBkZWxpdmVyeSBpcyByZWxlYXNlZApvbmx5IG9uY2UgYHRocmVzaG9sZGAgZGlzdGluY3Qgb3JhY2xlcyBmcm9tIGBvcmFjbGVzYCBoYXZlIGFwcHJvdmVkIGl0LgAAAAAAAAAJT3JhY2xlU2V0AAAAAAAAAgAAAAAAAAAHb3JhY2xlcwAAAAPqAAAAEwAAAAAAAAAJdGhyZXNob2xkAAAAAAAABA==",
        "AAAABAAAAAAAAAAAAAAAC0VzY3Jvd0Vycm9yAAAAAAwAAAAmQ29udHJhY3QgaGFzIGFscmVhZHkgYmVlbiBpbml0aWFsaXplZC4AAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAmQ29udHJhY3QgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkIHlldC4AAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAACxDYWxsZXIgaXMgbm90IGF1dGhvcml6ZWQgZm9yIHRoaXMgb3BlcmF0aW9uLgAAAAxVbmF1dGhvcml6ZWQAAAADAAAAPFRoZSBlc2Nyb3cgaXMgbm90IGluIHRoZSBleHBlY3RlZCBzdGF0dXMgZm9yIHRoaXMgb3BlcmF0aW9uLgAAAA1JbnZhbGlkU3RhdHVzAAAAAAAABAAAACVUaGUgYW1vdW50IG11c3QgYmUgZ3JlYXRlciB0aGFuIHplcm8uAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAAFAAAANFRpbWVvdXQgbXVzdCBiZSBhdCBsZWFzdCAxMDAwIGxlZGdlcnMgaW4gdGhlIGZ1dHVyZS4AAAAOSW52YWxpZFRpbWVvdXQAAAAAAAYAAAAnVGhlIHNwZWNpZmllZCBlc2Nyb3cgSUQgZG9lcyBub3QgZXhpc3QuAAAAAA5Fc2Nyb3dOb3RGb3VuZAAAAAAABwAAADBUaW1lb3V0IGhhcyBub3QgeWV0IGJlZW4gcmVhY2hlZDsgY2Fubm90IHJlZnVuZC4AAAARVGltZW91dE5vdFJlYWNoZWQAAAAAAAAIAAAAK0J1eWVyIGNhbm5vdCBiZSB0aGUgc2FtZSBhZGRyZXNzIGFzIHNlbGxlci4AAAAADUJ1eWVySXNTZWxsZXIAAAAAAAAJAAAAUU9yYWNsZSBzZXQgaXMgZW1wdHksIHRvbyBsYXJnZSwgaGFzIGR1cGxpY2F0ZXMsIG9yIHRoZSB0aHJlc2hvbGQgaXMgb3V0IG9mIHJhbmdlLgAAAAAAABBJbnZhbGlkT3JhY2xlU2V0AAAACgAAACpCYXNpcyBwb2ludHMgbXVzdCBiZSBiZXR3ZWVuIDAgYW5kIDEwXzAwMC4AAAAAAApJbnZhbGlkQnBzAAAAAAALAAAAO0V2aWRlbmNlIGxpbWl0IHJlYWNoZWQgb3IgdGhlIGV2aWRlbmNlIHBvaW50ZXIgaXMgdG9vIGxvbmcuAAAAAA1FdmlkZW5jZUxpbWl0AAAAAAAADA==",
        "AAAAAgAAAEdFc2Nyb3cgbGlmZWN5Y2xlIHN0YXRlcyDigJQgdGVybWluYWwgc3RhdGVzIGFyZSBERUxJVkVSRUQgYW5kIFJFRlVOREVELgAAAAAAAAAADEVzY3Jvd1N0YXR1cwAAAAYAAAAAAAAAI0NyZWF0ZWQgYnV0IG5vdCB5ZXQgZnVuZGVkIGJ5IGJ1eWVyAAAAAAdQZW5kaW5nAAAAAAAAAAAqQnV5ZXIgaGFzIGRlcG9zaXRlZCBVU0RDIGludG8gdGhlIGNvbnRyYWN0AAAAAAAGRnVuZGVkAAAAAAAAAAAAJlNlbGxlciBoYXMgc3VibWl0dGVkIGEgdHJhY2tpbmcgbnVtYmVyAAAAAAAHU2hpcHBlZAAAAAAAAAAAQE9yYWNsZSBjb25maXJtZWQgZGVsaXZlcnkg4oCUIFVTREMgcmVsZWFzZWQgdG8gc2VsbGVyICh0ZXJtaW5hbCkAAAAJRGVsaXZlcmVkAAAAAAAAAAAAAC1CdXllciBjbGFpbWVkIHJlZnVuZCBhZnRlciB0aW1lb3V0ICh0ZXJtaW5hbCkAAAAAAAAIUmVmdW5kZWQAAAAAAAAAP1RyYW5zYWN0aW9uIGlzIGRpc3B1dGVkICh2MS4xIGdyYWNlIHBlcmlvZCAvIGFkbWluIGFyYml0cmF0aW9uKQAAAAAIRGlzcHV0ZWQ=",
        "AAAAAQAAAJlPbmUgcGllY2Ugb2YgZGlzcHV0ZSBldmlkZW5jZTogYSBTSEEtMjU2IGhhc2ggb2YgdGhlIGZpbGUgcGx1cyBhbiBvcHRpb25hbCBwb2ludGVyIChlLmcuIGFuCklQRlMgQ0lEIG9yIGEgVVJMKS4gVGhlIGZpbGUgaXRzZWxmIGlzIG5ldmVyIHN0b3JlZCBvbi1jaGFpbi4AAAAAAAAAAAAADEV2aWRlbmNlSXRlbQAAAAQAAAAAAAAABGhhc2gAAAPuAAAAIAAAAAAAAAAGbGVkZ2VyAAAAAAAEAAAAAAAAAAlzdWJtaXR0ZXIAAAAAAAATAAAAAAAAAAN1cmkAAAAAEA==",
        "AAAAAAAAAO5GdW5kIGFuIGVzY3JvdyBieSB0cmFuc2ZlcnJpbmcgVVNEQyBmcm9tIHRoZSBidXllciB0byB0aGlzIGNvbnRyYWN0LgoKVHJhbnNpdGlvbnM6IFBFTkRJTkcg4oaSIEZVTkRFRC4KClRoZSBidXllciBtdXN0IGhhdmUgYXBwcm92ZWQgb3IgaGF2ZSBzdWZmaWNpZW50IGJhbGFuY2UgZm9yIHRoZSBTQUMgdG9rZW4gdHJhbnNmZXIuCgojIEFyZ3VtZW50cwoqIGBlc2Nyb3dfaWRgIOKAlCBUaGUgZXNjcm93IHRvIGZ1bmQuAAAAAAAEZnVuZAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAAC0VzY3Jvd0Vycm9yAA==",
        "AAAAAAAAACdHZXQgdGhlIGN1cnJlbnQgY29udHJhY3QgY29uZmlndXJhdGlvbi4AAAAACmdldF9jb25maWcAAAAAAAAAAAABAAAD6QAAB9AAAAAGQ29uZmlnAAAAAAfQAAAAC0VzY3Jvd0Vycm9yAA==",
        "AAAAAAAAAC9HZXQgYW4gZXNjcm93IGJ5IElELiBSZXR1cm5zIE5vbmUgaWYgbm90IGZvdW5kLgAAAAAKZ2V0X2VzY3JvdwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAAZFc2Nyb3cAAAAAB9AAAAALRXNjcm93RXJyb3IA",
        "AAAAAAAAAWlJbml0aWFsaXplIHRoZSBjb250cmFjdCB3aXRoIGFkbWluLCBvcmFjbGUsIGFuZCBVU0RDIHRva2VuIGFkZHJlc3Nlcy4KCk11c3QgYmUgY2FsbGVkIGV4YWN0bHkgb25jZSBiZWZvcmUgYW55IG90aGVyIGZ1bmN0aW9uLgoKIyBBcmd1bWVudHMKKiBgYWRtaW5gICDigJQgQWRtaW5pc3RyYXRvciBhZGRyZXNzIChjYW4gdXBkYXRlIG9yYWNsZSwgcGF1c2UgY29udHJhY3QgaW4gdjEuMSkuCiogYG9yYWNsZWAg4oCUIENvdXJpZXIgb3JhY2xlIGFkZHJlc3MgKG9ubHkgYWRkcmVzcyBhbGxvd2VkIHRvIGNhbGwgYGNvbmZpcm1fZGVsaXZlcnlgKS4KKiBgdG9rZW5gICDigJQgU0FDIHRva2VuIGNvbnRyYWN0IGFkZHJlc3MgZm9yIFVTREMuAAAAAAAACmluaXRpYWxpemUAAAAAAAMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAGb3JhY2xlAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAC0VzY3Jvd0Vycm9yAA==",
        "AAAAAAAAAMJSZXBsYWNlIHRoZSBvcmFjbGUgc2V0LiBBZG1pbiBvbmx5LiBgdGhyZXNob2xkYCBvZiB0aGUgYG9yYWNsZXNgIG11c3QgYXBwcm92ZSBhIGRlbGl2ZXJ5LgpBcHByb3ZhbHMgYWxyZWFkeSBjb2xsZWN0ZWQgc3RheSBzdG9yZWQsIGJ1dCBvbmx5IHRob3NlIGZyb20gb3JhY2xlcyB0aGF0IHJlbWFpbiBpbiB0aGUKc2V0IGFyZSBjb3VudGVkLgAAAAAAC3NldF9vcmFjbGVzAAAAAAIAAAAAAAAAB29yYWNsZXMAAAAD6gAAABMAAAAAAAAACXRocmVzaG9sZAAAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAAC0VzY3Jvd0Vycm9yAA==",
        "AAAAAAAAASRCdXllciBjbGFpbXMgYSByZWZ1bmQgYWZ0ZXIgdGhlIHRpbWVvdXQgaGFzIHBhc3NlZC4KClRyYW5zaXRpb25zOiBGVU5ERUQgfCBTSElQUEVEIOKGkiBSRUZVTkRFRCAodGVybWluYWwpLgoKVGhlIHJlZnVuZCBpcyBvbmx5IGF2YWlsYWJsZSBhZnRlciBgdGltZW91dF9sZWRnZXJgIGhhcyBiZWVuIHJlYWNoZWQuCkEgREVMSVZFUkVEIGVzY3JvdyBjYW4gbmV2ZXIgYmUgcmVmdW5kZWQgKGJ1c2luZXNzIHJ1bGUgIzMpLgoKIyBBcmd1bWVudHMKKiBgZXNjcm93X2lkYCDigJQgVGhlIGVzY3JvdyB0byByZWZ1bmQuAAAADGNsYWltX3JlZnVuZAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAAC0VzY3Jvd0Vycm9yAA==",
        "AAAAAAAAADNBbGwgZXZpZGVuY2UgY29tbWl0dGVkIGZvciBhbiBlc2Nyb3csIG9sZGVzdCBmaXJzdC4AAAAADGdldF9ldmlkZW5jZQAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6gAAB9AAAAAMRXZpZGVuY2VJdGVt",
        "AAAAAAAAAk5DcmVhdGUgYSBuZXcgZXNjcm93IGJldHdlZW4gYnV5ZXIgYW5kIHNlbGxlci4KCkRvZXMgTk9UIHRyYW5zZmVyIGZ1bmRzIOKAlCB0aGUgYnV5ZXIgbXVzdCBjYWxsIGBmdW5kKClgIHNlcGFyYXRlbHkuClRoaXMgdHdvLXN0ZXAgZmxvdyBhbGxvd3MgdGhlIGZyb250ZW5kIHRvIHNob3cgYSBwcmV2aWV3IGJlZm9yZSBsb2NraW5nIGZ1bmRzLgoKIyBBcmd1bWVudHMKKiBgYnV5ZXJgICAgICAgICAgICDigJQgQnV5ZXIncyBTdGVsbGFyIGFkZHJlc3MuCiogYHNlbGxlcmAgICAgICAgICAg4oCUIFNlbGxlcidzIFN0ZWxsYXIgYWRkcmVzcyAoZGVyaXZlZCBmcm9tIFFSSVMgbWVyY2hhbnQgSUQpLgoqIGBhbW91bnRgICAgICAgICAgIOKAlCBVU0RDIGFtb3VudCBpbiBiYXNlIHVuaXRzICg3IGRlY2ltYWxzKS4gNTAgVVNEQyA9IDUwMF8wMDBfMDAwLgoqIGB0aW1lb3V0X2xlZGdlcmAgIOKAlCBMZWRnZXIgbnVtYmVyIGFmdGVyIHdoaWNoIHRoZSBidXllciBjYW4gY2xhaW0gYSByZWZ1bmQuCk11c3QgYmUgYXQgbGVhc3QgY3VycmVudF9sZWRnZXIgKyBNSU5fVElNRU9VVF9MRURHRVJTLgoKIyBSZXR1cm5zClRoZSBuZXcgZXNjcm93IElELgAAAAAADWNyZWF0ZV9lc2Nyb3cAAAAAAAAEAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAA50aW1lb3V0X2xlZGdlcgAAAAAABAAAAAEAAAPpAAAABgAAB9AAAAALRXNjcm93RXJyb3IA",
        "AAAAAAAAAJBVcGRhdGUgdGhlIG9yYWNsZSBhZGRyZXNzLiBPbmx5IHRoZSBhZG1pbiBjYW4gY2FsbCB0aGlzLgoKIyBBcmd1bWVudHMKKiBgbmV3X29yYWNsZWAg4oCUIE5ldyBvcmFjbGUgYWRkcmVzcyB0byBhdXRob3JpemUgZm9yIGBjb25maXJtX2RlbGl2ZXJ5YC4AAAANdXBkYXRlX29yYWNsZQAAAAAAAAEAAAAAAAAACm5ld19vcmFjbGUAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAC0VzY3Jvd0Vycm9yAA==",
        "AAAAAAAAAVpEaXNwdXRlIGFuIGVzY3JvdyB0cmFuc2FjdGlvbi4gQ2FuIGJlIGNhbGxlZCBieSB0aGUgYnV5ZXIsIHRoZSBzZWxsZXIsIG9yIHRoZQp3aGl0ZWxpc3RlZCBvcmFjbGUgKHdoaWNoIGZyZWV6ZXMgdGhlIGVzY3JvdyB3aGVuIHRoZSBjb3VyaWVyIHJlcG9ydHMgYSByZXR1cm4gdG8Kc2VuZGVyKS4gVGhlIG9yYWNsZSBjYW4gb25seSBtb3ZlIGZ1bmRzIElOVE8gZGlzcHV0ZTsgaXQgc3RpbGwgY2Fubm90IHJlbGVhc2UgdGhlbToKb25seSBgcmVzb2x2ZV9kaXNwdXRlYCAoYWRtaW4pIHBheXMgb3V0IGEgZGlzcHV0ZWQgZXNjcm93LgoKVHJhbnNpdGlvbnM6IEZVTkRFRCB8IFNISVBQRUQgLT4gRElTUFVURUQuAAAAAAAOZGlzcHV0ZV9lc2Nyb3cAAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAALRXNjcm93RXJyb3IA",
        "AAAAAAAAAFxUaGUgY29uZmlndXJlZCBNLW9mLU4gb3JhY2xlIHNldCwgb3IgYE5vbmVgIHdoaWxlIHRoZSBjb250cmFjdCBzdGlsbCB1c2VzIHRoZSBzaW5nbGUgb3JhY2xlLgAAAA5nZXRfb3JhY2xlX3NldAAAAAAAAAAAAAEAAAPoAAAH0AAAAAlPcmFjbGVTZXQAAAA=",
        "AAAAAAAAAIpBZG1pbiByZXNvbHZlcyBhIGRpc3B1dGUgYnkgc2VuZGluZyBmdW5kcyB0byB0aGUgd2lubmVyLgoKVHJhbnNpdGlvbnM6IERJU1BVVEVEIC0+IERFTElWRVJFRCAoaWYgc2VsbGVyIHdpbnMpIG9yIFJFRlVOREVEIChpZiBidXllciB3aW5zKS4AAAAAAA9yZXNvbHZlX2Rpc3B1dGUAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAGd2lubmVyAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=",
        "AAAAAAAAAQZCdXllciBvciBzZWxsZXIgY29tbWl0cyB0aGUgU0hBLTI1NiBoYXNoIG9mIGEgcGllY2Ugb2YgZXZpZGVuY2UgKHBob3RvLCB1bmJveGluZyB2aWRlbykgZm9yCmEgZGlzcHV0ZWQgZXNjcm93LiBUaGUgZmlsZSBzdGF5cyBvZmYtY2hhaW47IGB1cmlgIGlzIGFuIG9wdGlvbmFsIHBvaW50ZXIgKGUuZy4gYSBDSUQpLgpFYWNoIHBhcnR5IG1heSBzdWJtaXQgYXQgbW9zdCAxMCBpdGVtcy4gRXZpZGVuY2UgY2FuIG9ubHkgYmUgYWRkZWQgd2hpbGUgRGlzcHV0ZWQuAAAAAAAPc3VibWl0X2V2aWRlbmNlAAAAAAQAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAABXBhcnR5AAAAAAAAEwAAAAAAAAAEaGFzaAAAA+4AAAAgAAAAAAAAAAN1cmkAAAAAEAAAAAEAAAPpAAAAAgAAB9AAAAALRXNjcm93RXJyb3IA",
        "AAAAAAAAAQxTZWxsZXIgc3VibWl0cyBhIHRyYWNraW5nIG51bWJlciBhbmQgY291cmllciBjb2RlLgoKVHJhbnNpdGlvbnM6IEZVTkRFRCDihpIgU0hJUFBFRC4KCiMgQXJndW1lbnRzCiogYGVzY3Jvd19pZGAgICAgICAg4oCUIFRoZSBlc2Nyb3cgdG8gdXBkYXRlLgoqIGB0cmFja2luZ19udW1iZXJgIOKAlCBDb3VyaWVyIHRyYWNraW5nIG51bWJlci4KKiBgY291cmllcl9jb2RlYCAgICDigJQgQ291cmllciBpZGVudGlmaWVyIChlLmcuLCAiam50IiwgImpuZSIsICJzaWNlcGF0IikuAAAAD3N1Ym1pdF90cmFja2luZwAAAAADAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAGAAAAAAAAAA90cmFja2luZ19udW1iZXIAAAAAEAAAAAAAAAAMY291cmllcl9jb2RlAAAAEAAAAAEAAAPpAAAAAgAAB9AAAAALRXNjcm93RXJyb3IA",
        "AAAAAAAAAedPbmUgb3JhY2xlIG9mIHRoZSBjb25maWd1cmVkIHNldCBhcHByb3ZlcyBkZWxpdmVyeS4gV2hlbiBgdGhyZXNob2xkYCBkaXN0aW5jdCwgY3VycmVudGx5Cmxpc3RlZCBvcmFjbGVzIGhhdmUgYXBwcm92ZWQsIHRoZSBmdW5kcyBhcmUgcmVsZWFzZWQgdG8gdGhlIHNlbGxlci4KClJldHVybnMgYHRydWVgIGlmIHRoaXMgY2FsbCByZWxlYXNlZCB0aGUgZnVuZHMuIENhbGxpbmcgYWdhaW4gd2l0aCBhbiBvcmFjbGUgdGhhdCBoYXMKYWxyZWFkeSBhcHByb3ZlZCBpcyBhbGxvd2VkIGFuZCBvbmx5IHJlLWV2YWx1YXRlcyAoaXQgbmV2ZXIgY291bnRzIHR3aWNlKSwgd2hpY2ggYWxzbwpjb21wbGV0ZXMgYSBkZWxpdmVyeSB3aG9zZSB0aHJlc2hvbGQgd2FzIGxvd2VyZWQgYWZ0ZXIgdGhlIGFwcHJvdmFscyB3ZXJlIGNvbGxlY3RlZC4KClRyYW5zaXRpb25zOiBTSElQUEVEIC0+IERFTElWRVJFRCAodGVybWluYWwpIG9uY2UgdGhlIHRocmVzaG9sZCBpcyBtZXQuAAAAABBhcHByb3ZlX2RlbGl2ZXJ5AAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAGb3JhY2xlAAAAAAATAAAAAQAAA+kAAAABAAAH0AAAAAtFc2Nyb3dFcnJvcgA=",
        "AAAAAAAAAQ1PcmFjbGUgY29uZmlybXMgZGVsaXZlcnkg4oCUIHJlbGVhc2VzIFVTREMgdG8gdGhlIHNlbGxlci4KClRyYW5zaXRpb25zOiBTSElQUEVEIOKGkiBERUxJVkVSRUQgKHRlcm1pbmFsKS4KCk9ubHkgdGhlIG9yYWNsZSBhZGRyZXNzIHN0b3JlZCBpbiBDb25maWcgY2FuIGNhbGwgdGhpcyBmdW5jdGlvbi4KVGhlIGNvbnRyYWN0IHdpbGwgcmVqZWN0IGFueSBvdGhlciBpbnZva2VyLgoKIyBBcmd1bWVudHMKKiBgZXNjcm93X2lkYCDigJQgVGhlIGVzY3JvdyB0byBjb25maXJtLgAAAAAAABBjb25maXJtX2RlbGl2ZXJ5AAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAAAgAAB9AAAAALRXNjcm93RXJyb3IA",
        "AAAAAAAAAYNBZG1pbiByZXNvbHZlcyBhIGRpc3B1dGUgd2l0aCBhIHByb3BvcnRpb25hbCBzcGxpdCwgZS5nLiBgYnV5ZXJfYnBzID0gNzAwMGAgcmVmdW5kcyA3MCUgdG8KdGhlIGJ1eWVyIGFuZCBwYXlzIDMwJSB0byB0aGUgc2VsbGVyLgoKVGhlIGJ1eWVyJ3Mgc2hhcmUgaXMgcm91bmRlZCBkb3duIGFuZCB0aGUgc2VsbGVyIHJlY2VpdmVzIHRoZSByZW1haW5kZXIsIHNvIHRoZSB0d28KcGF5b3V0cyBhbHdheXMgYWRkIHVwIHRvIGV4YWN0bHkgdGhlIGxvY2tlZCBhbW91bnQuIFRyYW5zaXRpb25zOiBESVNQVVRFRCAtPiBSRUZVTkRFRCB3aGVuCnRoZSBidXllciBnZXRzIGV2ZXJ5dGhpbmcgKGBidXllcl9icHMgPSAxMF8wMDBgKSwgb3RoZXJ3aXNlIERJU1BVVEVEIC0+IERFTElWRVJFRC4AAAAAFXJlc29sdmVfZGlzcHV0ZV9zcGxpdAAAAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAACWJ1eWVyX2JwcwAAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAAC0VzY3Jvd0Vycm9yAA==",
        "AAAAAAAAADpPcmFjbGVzIHRoYXQgaGF2ZSBhcHByb3ZlZCBkZWxpdmVyeSBvZiB0aGlzIGVzY3JvdyBzbyBmYXIuAAAAAAAWZ2V0X2RlbGl2ZXJ5X2FwcHJvdmFscwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPqAAAAEw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    fund: this.txFromJSON<Result<void>>,
        get_config: this.txFromJSON<Result<Config>>,
        get_escrow: this.txFromJSON<Result<Escrow>>,
        initialize: this.txFromJSON<Result<void>>,
        set_oracles: this.txFromJSON<Result<void>>,
        claim_refund: this.txFromJSON<Result<void>>,
        get_evidence: this.txFromJSON<Array<EvidenceItem>>,
        create_escrow: this.txFromJSON<Result<u64>>,
        update_oracle: this.txFromJSON<Result<void>>,
        dispute_escrow: this.txFromJSON<Result<void>>,
        get_oracle_set: this.txFromJSON<Option<OracleSet>>,
        resolve_dispute: this.txFromJSON<Result<void>>,
        submit_evidence: this.txFromJSON<Result<void>>,
        submit_tracking: this.txFromJSON<Result<void>>,
        approve_delivery: this.txFromJSON<Result<boolean>>,
        confirm_delivery: this.txFromJSON<Result<void>>,
        resolve_dispute_split: this.txFromJSON<Result<void>>,
        get_delivery_approvals: this.txFromJSON<Array<string>>
  }
}