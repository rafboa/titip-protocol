-- CreateTable
CREATE TABLE "evidence_files" (
    "id" TEXT NOT NULL,
    "escrow_id" TEXT NOT NULL,
    "submitter" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),
    "tx_hash" TEXT,

    CONSTRAINT "evidence_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_blobs" (
    "evidence_id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "evidence_blobs_pkey" PRIMARY KEY ("evidence_id")
);

-- CreateIndex
CREATE INDEX "evidence_files_escrow_id_idx" ON "evidence_files"("escrow_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_files_escrow_id_submitter_sha256_key" ON "evidence_files"("escrow_id", "submitter", "sha256");

-- AddForeignKey
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_blobs" ADD CONSTRAINT "evidence_blobs_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
