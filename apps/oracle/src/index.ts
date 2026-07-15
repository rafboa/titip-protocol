// apps/oracle/src/index.ts
// Oracle service entry point.
//
// Responsibilities:
//  1. Start the BullMQ tracking worker (processes jobs as they arrive)
//  2. Run a periodic poller that scans the DB for SHIPPED escrows and
//     enqueues a tracking job for each one (idempotent via jobId)

import { PrismaClient } from '@prisma/client'
import { config } from './config.js'
import { trackingQueue } from './queues/tracking.js'
import { createTrackingWorker } from './workers/tracking-worker.js'

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Poller: scan DB for SHIPPED escrows and enqueue tracking jobs
// ---------------------------------------------------------------------------
async function pollShippedEscrows(): Promise<void> {
  console.log('[poller] Scanning for SHIPPED escrows...')

  let escrows: Array<{
    id: string
    trackingNumber: string | null
    courierCode: string | null
  }>

  try {
    escrows = await prisma.escrow.findMany({
      where: {
        status: 'SHIPPED',
        trackingNumber: { not: null },
        courierCode: { not: null },
      },
      select: {
        id: true,
        trackingNumber: true,
        courierCode: true,
      },
    })
  } catch (err) {
    console.error('[poller] DB query failed:', err)
    return // Skip this cycle; will retry on next interval
  }

  console.log(`[poller] Found ${escrows.length} SHIPPED escrow(s) to track`)

  for (const escrow of escrows) {
    if (!escrow.trackingNumber || !escrow.courierCode) continue

    // Use a timestamp in jobId so if a previous job failed permanently, 
    // we can still re-enqueue it while the escrow remains SHIPPED.
    await trackingQueue.add(
      'check-delivery',
      {
        escrowId: escrow.id,
        trackingNumber: escrow.trackingNumber,
        courierCode: escrow.courierCode,
      },
      {
        jobId: `track-${escrow.id}-${Date.now()}`, 
      }
    )
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(worker: ReturnType<typeof createTrackingWorker>): Promise<void> {
  console.log('\n[oracle] Shutting down gracefully...')
  clearInterval(pollInterval)
  await worker.close()
  await trackingQueue.close()
  await prisma.$disconnect()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('🚀 Titip Protocol Oracle Service starting...')
console.log(`   Environment: ${config.STELLAR_NETWORK}`)
console.log(`   Node ID: ${config.ORACLE_NODE_ID}`)
console.log(`   Poll interval: ${config.POLL_INTERVAL_MS}ms`)
console.log(`   App URL: ${config.APP_INTERNAL_API_URL}`)
console.log('')

// Start the BullMQ worker
const worker = createTrackingWorker()
console.log('[oracle] Tracking worker started ✓')

// Run the first poll immediately on startup, then on interval
await pollShippedEscrows()
const pollInterval = setInterval(pollShippedEscrows, config.POLL_INTERVAL_MS)
console.log(`[oracle] Poller running every ${config.POLL_INTERVAL_MS / 1000}s ✓`)

// Graceful shutdown on SIGINT / SIGTERM
const shutdownHandler = () => void shutdown(worker)
process.on('SIGINT', shutdownHandler)
process.on('SIGTERM', shutdownHandler)

console.log('\n✅ Oracle service is running. Press Ctrl+C to stop.\n')
