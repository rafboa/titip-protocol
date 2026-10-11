// apps/oracle/src/workers/tracking-worker.ts
// BullMQ worker that processes courier tracking jobs.
//
// For each job it:
//  1. Picks the right courier adapter (JNT, JNE, SiCepat)
//  2. Calls the courier's tracking API with a 10s timeout
//  3. Logs the result to oracle_events regardless of outcome (claude.md spec)
//  4. If delivered → signs confirm_delivery on-chain, then POSTs /api/oracle/confirm
//  5. If not delivered → job is "done" (BullMQ will re-schedule via the poller)

import { Worker, type Job, type WorkerOptions } from 'bullmq'
import { PrismaClient, type CourierCode, type Prisma } from '@prisma/client'
import { TRACKING_QUEUE_NAME, type TrackingJobData, type TrackingQueueData } from '../queues/tracking.js'
import { jntAdapter } from '../couriers/jnt.js'
import { jneAdapter } from '../couriers/jne.js'
import { sicepatAdapter } from '../couriers/sicepat.js'
import { mockAdapter } from '../couriers/mock.js'
import { confirmDelivery, submitConfirmDeliveryOnChain, submitDisputeOnChain } from '../stellar/submit.js'
import { config } from '../config.js'
import type { CourierAdapter } from '../couriers/types.js'
import { handleWebhookEvent, type WebhookDeps } from './webhook-handler.js'

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Courier registry — add new adapters here.
// Falls back to mockAdapter when the real API key is absent (testnet/demo).
// TODO(mainnet): Remove mock fallbacks — require all API keys.
// ---------------------------------------------------------------------------
function resolveAdapter(code: string): CourierAdapter {
  const upper = code.toUpperCase()
  if (upper === 'JNT')     return config.JNT_API_KEY     ? jntAdapter     : mockAdapter
  if (upper === 'JNE')     return config.JNE_API_KEY     ? jneAdapter     : mockAdapter
  if (upper === 'SICEPAT') return config.SICEPAT_API_KEY ? sicepatAdapter : mockAdapter
  return mockAdapter // Unknown courier → mock for safety on testnet
}

// ---------------------------------------------------------------------------
// Custom backoff: 1min → 5min → 15min (claude.md spec)
// ---------------------------------------------------------------------------
const BACKOFF_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000]

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------
async function processTrackingJob(job: Job<TrackingJobData>): Promise<void> {
  const { escrowId, trackingNumber, courierCode } = job.data

  console.log(
    `[worker] Processing job ${job.id} — escrow=${escrowId} courier=${courierCode} tracking=${trackingNumber}`
  )

  const adapter = resolveAdapter(courierCode)
  if (adapter === mockAdapter && !config.JNT_API_KEY && !config.JNE_API_KEY && !config.SICEPAT_API_KEY) {
    console.warn(`[worker] No API key for ${courierCode} — using mock adapter (testnet only)`)
  }

  let trackingResult: Awaited<ReturnType<CourierAdapter['fetchStatus']>>

  try {
    trackingResult = await adapter.fetchStatus(trackingNumber)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[worker] Courier fetch failed for job ${job.id}: ${errorMessage}`)

    // Log the failure — we still log every oracle event (claude.md spec)
    await logOracleEvent(escrowId, 'POLL_ERROR', { error: errorMessage })

    // Re-throw so BullMQ retries with backoff
    throw err
  }

  // Always log the poll result
  await logOracleEvent(
    escrowId,
    trackingResult.delivered ? 'DELIVERY_CONFIRMED' : 'POLL_NO_UPDATE',
    trackingResult.raw
  )

  if (!trackingResult.delivered) {
    console.log(
      `[worker] Job ${job.id} — not delivered yet. Status: "${trackingResult.statusText}"`
    )
    return // Job complete; poller will re-enqueue on next cycle
  }

  // Multi-leg shipments: the primary tracking number being delivered is not the end of the
  // journey. Release is decided per leg by handleWebhookEvent (webhook path) only.
  // TODO(mainnet): poll the active leg too once courier APIs for the extra legs exist.
  const legCount = await prisma.shipmentLeg.count({
    where: { escrowId, status: { in: ['APPROVED', 'PROPOSED'] } },
  })
  if (legCount > 0) {
    console.log(`[worker] Job ${job.id} — primary delivered but escrow ${escrowId} has ${legCount} extra leg(s); not releasing`)
    return
  }

  // Delivery confirmed — release funds on-chain with the oracle key, then sync the web app
  console.log(`[worker] Job ${job.id} — DELIVERED! Submitting confirm_delivery on-chain...`)

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
    select: { contractAddress: true, contractEscrowId: true },
  })
  if (!escrow) throw new Error(`Escrow ${escrowId} not found in DB`)

  const { txHash } = await submitConfirmDeliveryOnChain(escrow.contractAddress, escrow.contractEscrowId)
  await confirmDelivery(escrowId, trackingResult.raw, txHash)

  console.log(`[worker] Job ${job.id} — escrow ${escrowId} confirmed and released ✓`)
}

// ---------------------------------------------------------------------------
// Helper: log oracle event
// ---------------------------------------------------------------------------
async function logOracleEvent(
  escrowId: string,
  eventType: string,
  courierResponse: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.oracleEvent.create({
      data: {
        escrowId,
        eventType,
        courierResponse: courierResponse as Prisma.InputJsonValue,
        oracleNodeId: config.ORACLE_NODE_ID,
      },
    })
  } catch (err) {
    // Don't let a DB error abort the tracking job — just log
    console.error('[worker] Failed to log oracle event:', err)
  }
}

// ---------------------------------------------------------------------------
// Webhook events (persisted by the web app's signed-webhook route)
// ---------------------------------------------------------------------------
const webhookDeps: WebhookDeps = {
  getEvent: (id) => prisma.webhookEvent.findUnique({ where: { id } }),
  resolveShipment: async (courier, trackingNumber) => {
    const courierCode = courier as CourierCode
    const escrowSelect = {
      id: true,
      status: true,
      contractAddress: true,
      contractEscrowId: true,
      buyerAddress: true,
      sellerAddress: true,
      legs: { select: { seq: true, status: true } },
    } as const

    const primary = await prisma.escrow.findFirst({
      where: { courierCode, trackingNumber },
      orderBy: { createdAt: 'desc' },
      select: escrowSelect,
    })
    if (primary) {
      const { legs, ...escrow } = primary
      return {
        escrow,
        kind: 'PRIMARY',
        legId: null,
        legStatus: null,
        // With approved legs the primary is only the first hop.
        isFinal: !legs.some((l) => l.status === 'APPROVED'),
        hasPendingProposal: legs.some((l) => l.status === 'PROPOSED'),
      }
    }

    const leg = await prisma.shipmentLeg.findFirst({
      where: { courier: courierCode, trackingNumber },
      orderBy: { createdAt: 'desc' },
      include: { escrow: { select: escrowSelect } },
    })
    if (!leg) return null
    const { legs, ...escrow } = leg.escrow
    const lastApprovedSeq = legs.filter((l) => l.status === 'APPROVED').reduce((max, l) => Math.max(max, l.seq), 0)
    return {
      escrow,
      kind: 'LEG',
      legId: leg.id,
      legStatus: leg.status,
      isFinal: leg.status === 'APPROVED' && leg.seq === lastApprovedSeq,
      hasPendingProposal: legs.some((l) => l.status === 'PROPOSED'),
    }
  },
  recordLegStage: async (legId, stage) => {
    await prisma.shipmentLeg.update({
      where: { id: legId },
      data: { stage, ...(stage === 'DELIVERED' ? { deliveredAt: new Date() } : {}) },
    })
  },
  markProcessed: async (id) => {
    await prisma.webhookEvent.update({ where: { id }, data: { processedAt: new Date() } })
  },
  logOracleEvent: (escrowId, eventType, payload) => logOracleEvent(escrowId, eventType, payload),
  notify: async (userAddress, type, message) => {
    await prisma.notification.create({ data: { userAddress, type, message } })
  },
  submitConfirmDelivery: submitConfirmDeliveryOnChain,
  syncDelivery: async (escrowId, payload, txHash) => {
    await confirmDelivery(escrowId, payload, txHash)
  },
  // Needs the contract version where dispute_escrow accepts the oracle as caller.
  // The chain is the source of truth, so the DB status follows only after the tx succeeds.
  openDispute: async (escrow) => {
    await submitDisputeOnChain(escrow.contractAddress, escrow.contractEscrowId)
    await prisma.escrow.update({ where: { id: escrow.id }, data: { status: 'DISPUTED' } })
  },
}

async function processQueueJob(job: Job<TrackingQueueData>): Promise<void> {
  if ('webhookEventId' in job.data) {
    const outcome = await handleWebhookEvent(job.data.webhookEventId, webhookDeps)
    console.log(`[worker] Job ${job.id} - webhook event ${job.data.webhookEventId}: ${outcome}`)
    return
  }
  return processTrackingJob(job as Job<TrackingJobData>)
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------
export function createTrackingWorker(): Worker<TrackingQueueData> {
  const workerOptions: WorkerOptions = {
    connection: {
      url: config.REDIS_URL,
    },
    concurrency: config.MAX_CONCURRENCY,
    // Custom backoff function: index maps to BACKOFF_DELAYS_MS
    settings: {
      backoffStrategy: (attemptsMade: number) => {
        const index = Math.min(attemptsMade - 1, BACKOFF_DELAYS_MS.length - 1)
        return BACKOFF_DELAYS_MS[index] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1] ?? 60_000
      },
    },
  }

  const worker = new Worker<TrackingQueueData>(
    TRACKING_QUEUE_NAME,
    processQueueJob,
    workerOptions
  )

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message)
  })

  worker.on('error', (err) => {
    console.error('[worker] Worker error:', err)
  })

  return worker
}
