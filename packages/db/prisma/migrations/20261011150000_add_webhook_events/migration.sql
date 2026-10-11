-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "courier" "CourierCode" NOT NULL,
    "event_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_processed_at_idx" ON "webhook_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_courier_event_id_key" ON "webhook_events"("courier", "event_id");

