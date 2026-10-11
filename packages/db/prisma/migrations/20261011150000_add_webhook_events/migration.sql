-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "courier" "CourierCode" NOT NULL,
    "event_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_courier_event_id_key" ON "webhook_events"("courier", "event_id");

