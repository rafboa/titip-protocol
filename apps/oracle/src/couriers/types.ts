// apps/oracle/src/couriers/types.ts
// Shared interface all courier adapters must implement.

/** Lifecycle stage of a shipment, normalised across couriers */
export type TrackingStage =
  | 'PICKUP'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'RETURN_TO_SENDER'

/** Standardised delivery status returned by every courier adapter */
export type TrackingStatus = {
  /** Normalised lifecycle stage. Polling adapters that cannot tell stages apart use IN_TRANSIT. */
  stage: TrackingStage
  /** Whether the package has been delivered to the recipient (always equals stage === 'DELIVERED') */
  delivered: boolean
  /** Human-readable status text from the courier (English or Bahasa) */
  statusText: string
  /** Raw response object from the courier API — stored in oracle_events for audit */
  raw: Record<string, unknown>
}

/** Every courier adapter must implement this interface */
export interface CourierAdapter {
  /** Courier code — matches the CourierCode enum in schema.prisma */
  readonly code: string

  /**
   * Fetch the current tracking status for a shipment.
   * Must:
   *  - Timeout after 10 seconds (AbortSignal.timeout)
   *  - Throw on network errors or API errors
   *  - Never return null; throw instead
   */
  fetchStatus(trackingNumber: string): Promise<TrackingStatus>
}
