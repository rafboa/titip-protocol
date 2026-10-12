-- AlterTable
ALTER TABLE "escrows" ADD COLUMN     "resolution_buyer_bps" INTEGER,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "resolved_by" TEXT;
