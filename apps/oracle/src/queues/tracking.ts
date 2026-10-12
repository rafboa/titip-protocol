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

/** Job that handles one persisted webhook_events row (courier webhook). */
export type WebhookJobData = {
  webhookEventId: string
}

/** Everything that can sit on the tracking queue */
export type TrackingQueueData = TrackingJobData | WebhookJobData

/**
 * Name of this node's BullMQ queue. One queue per node: a job runs on exactly one worker of its
 * queue, so with a shared queue only one node would ever evaluate an escrow and the M-of-N quorum
 * would depend on which worker happens to pick up later re-enqueued jobs.
 */
export const TRACKING_QUEUE_NAME = `tracking-${config.ORACLE_NODE_ID}`

/** This node's BullMQ queue — used by the poller to enqueue jobs for its own worker */
export const trackingQueue = new Queue<TrackingQueueData>(TRACKING_QUEUE_NAME, {
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
