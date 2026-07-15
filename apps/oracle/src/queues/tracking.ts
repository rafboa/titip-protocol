// apps/oracle/src/queues/tracking.ts
// BullMQ queue definition for courier tracking jobs.
// Both the producer (poller) and consumer (worker) import from this file.

import { Queue } from 'bullmq'
import { config } from '../config.js'

/** Data attached to each tracking job */
export type TrackingJobData = {
  /** Internal DB id of the Escrow record */
  escrowId: string
  /** Tracking number provided by the seller */
  trackingNumber: string
  /** Courier code — must match CourierCode enum */
  courierCode: string
}

/** Name of the BullMQ queue */
export const TRACKING_QUEUE_NAME = 'tracking'

/** Shared BullMQ queue instance — used by poller to enqueue jobs */
export const trackingQueue = new Queue<TrackingJobData>(TRACKING_QUEUE_NAME, {
  connection: {
    url: config.REDIS_URL,
  },
  defaultJobOptions: {
    // Retry 3 times: 1min, 5min, 15min delays (claude.md spec)
    attempts: 3,
    backoff: {
      type: 'custom',
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
})
