// apps/oracle/src/couriers/types.ts
// Shared interface all courier adapters must implement.

/** Standardised delivery status returned by every courier adapter */
export type TrackingStatus = {
  /** Whether the package has been delivered to the recipient */
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
