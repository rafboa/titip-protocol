-- CreateEnum
CREATE TYPE "LegStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "shipment_legs" (
    "id" TEXT NOT NULL,
    "escrow_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "courier" "CourierCode" NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "status" "LegStatus" NOT NULL DEFAULT 'PROPOSED',
    "stage" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "shipment_legs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_legs_courier_tracking_number_idx" ON "shipment_legs"("courier", "tracking_number");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_legs_escrow_id_seq_key" ON "shipment_legs"("escrow_id", "seq");

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

