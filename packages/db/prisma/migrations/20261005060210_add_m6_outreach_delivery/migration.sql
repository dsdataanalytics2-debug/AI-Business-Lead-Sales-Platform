-- CreateEnum
CREATE TYPE "OutreachChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "OutreachDeliveryStatus" AS ENUM ('REQUESTED', 'QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "outreach_deliveries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "channel" "OutreachChannel" NOT NULL,
    "status" "OutreachDeliveryStatus" NOT NULL DEFAULT 'REQUESTED',
    "recipient_contact_id" TEXT,
    "recipient_normalized" TEXT NOT NULL,
    "snapshot_subject" TEXT,
    "snapshot_body" TEXT,
    "snapshot_content" TEXT,
    "approved_draft_snapshot_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "provider_name" TEXT,
    "provider_message_id" TEXT,
    "last_error_code" TEXT,
    "safe_last_error_message" TEXT,
    "requested_by_user_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queued_at" TIMESTAMP(3),
    "processing_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outreach_deliveries_organization_id_lead_id_created_at_idx" ON "outreach_deliveries"("organization_id", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "outreach_deliveries_organization_id_status_created_at_idx" ON "outreach_deliveries"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "outreach_deliveries_organization_id_channel_status_idx" ON "outreach_deliveries"("organization_id", "channel", "status");

-- CreateIndex
CREATE INDEX "outreach_deliveries_provider_name_provider_message_id_idx" ON "outreach_deliveries"("provider_name", "provider_message_id");

-- CreateIndex
CREATE INDEX "outreach_deliveries_draft_id_idx" ON "outreach_deliveries"("draft_id");

-- CreateIndex
CREATE INDEX "outreach_deliveries_requested_by_user_id_idx" ON "outreach_deliveries"("requested_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_deliveries_organization_id_idempotency_key_key" ON "outreach_deliveries"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_deliveries_id_organization_id_key" ON "outreach_deliveries"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "outreach_deliveries" ADD CONSTRAINT "outreach_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_deliveries" ADD CONSTRAINT "outreach_deliveries_lead_id_organization_id_fkey" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_deliveries" ADD CONSTRAINT "outreach_deliveries_draft_id_organization_id_fkey" FOREIGN KEY ("draft_id", "organization_id") REFERENCES "sales_assistant_drafts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_deliveries" ADD CONSTRAINT "outreach_deliveries_requested_by_user_id_organization_id_fkey" FOREIGN KEY ("requested_by_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
