-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('PENDING', 'FUNDED', 'SHIPPED', 'DELIVERED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "CourierCode" AS ENUM ('JNT', 'JNE', 'SICEPAT', 'ANTERAJA', 'POS_INDONESIA');

-- CreateTable
CREATE TABLE "users" (
    "stellar_address" TEXT NOT NULL,
    "display_name" TEXT,
    "wallet_type" TEXT NOT NULL DEFAULT 'freighter',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("stellar_address")
);

-- CreateTable
CREATE TABLE "escrows" (
    "id" TEXT NOT NULL,
    "contract_escrow_id" BIGINT NOT NULL,
    "contract_address" TEXT NOT NULL,
    "buyer_address" TEXT NOT NULL,
    "seller_address" TEXT NOT NULL,
    "amount_usdc" DECIMAL(20,7) NOT NULL,
    "status" "EscrowStatus" NOT NULL DEFAULT 'PENDING',
    "tracking_number" TEXT,
    "courier_code" "CourierCode",
    "qris_merchant_id" TEXT,
    "qris_merchant_name" TEXT,
    "qris_category_code" TEXT,
    "qris_payload_raw" TEXT,
    "timeout_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "funded_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "tx_hash_fund" TEXT,
    "tx_hash_release" TEXT,

    CONSTRAINT "escrows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_events" (
    "id" TEXT NOT NULL,
    "escrow_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "courier_response" JSONB,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oracle_node_id" TEXT NOT NULL,

    CONSTRAINT "oracle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qris_sessions" (
    "id" TEXT NOT NULL,
    "payload_raw" TEXT NOT NULL,
    "merchant_id" TEXT,
    "merchant_name" TEXT,
    "cat_code" TEXT,
    "amount" DECIMAL(20,2),
    "parsed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escrow_id" TEXT,

    CONSTRAINT "qris_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_address" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escrows_buyer_address_idx" ON "escrows"("buyer_address");

-- CreateIndex
CREATE INDEX "escrows_seller_address_idx" ON "escrows"("seller_address");

-- CreateIndex
CREATE INDEX "escrows_status_idx" ON "escrows"("status");

-- CreateIndex
CREATE INDEX "escrows_contract_escrow_id_contract_address_idx" ON "escrows"("contract_escrow_id", "contract_address");

-- CreateIndex
CREATE INDEX "oracle_events_escrow_id_idx" ON "oracle_events"("escrow_id");

-- CreateIndex
CREATE UNIQUE INDEX "qris_sessions_escrow_id_key" ON "qris_sessions"("escrow_id");

-- CreateIndex
CREATE INDEX "notifications_user_address_read_idx" ON "notifications"("user_address", "read");

-- AddForeignKey
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_buyer_address_fkey" FOREIGN KEY ("buyer_address") REFERENCES "users"("stellar_address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_seller_address_fkey" FOREIGN KEY ("seller_address") REFERENCES "users"("stellar_address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_events" ADD CONSTRAINT "oracle_events_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_address_fkey" FOREIGN KEY ("user_address") REFERENCES "users"("stellar_address") ON DELETE RESTRICT ON UPDATE CASCADE;

