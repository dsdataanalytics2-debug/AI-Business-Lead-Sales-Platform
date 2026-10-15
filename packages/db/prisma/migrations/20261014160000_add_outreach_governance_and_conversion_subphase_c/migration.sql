-- AlterTable
ALTER TABLE "sales_mission_buyers" ADD COLUMN     "conversion_lost_at" TIMESTAMP(3),
ADD COLUMN     "conversion_lost_reason" TEXT,
ADD COLUMN     "conversion_stage" TEXT NOT NULL DEFAULT 'DISCOVERED',
ADD COLUMN     "conversion_won_evidence" JSONB;

-- CreateTable
CREATE TABLE "outreach_drafts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sales_mission_buyer_id" TEXT NOT NULL,
    "sales_mission_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'EN',
    "ai_context_snapshot" JSONB,
    "edit_history" JSONB,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by_user_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_interactions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sales_mission_buyer_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "raw_payload" JSONB,
    "classification" TEXT,
    "classification_confidence" DOUBLE PRECISION,
    "classification_signals" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'UNSUBSCRIBE',
    "source" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "domain" TEXT,
    "sales_mission_buyer_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppression_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sales_mission_buyer_id" TEXT NOT NULL,
    "from_stage" TEXT NOT NULL,
    "to_stage" TEXT NOT NULL,
    "evidence" JSONB,
    "user_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outreach_drafts_organization_id_sales_mission_buyer_id_idx" ON "outreach_drafts"("organization_id", "sales_mission_buyer_id");

-- CreateIndex
CREATE INDEX "outreach_drafts_organization_id_status_idx" ON "outreach_drafts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_drafts_id_organization_id_key" ON "outreach_drafts"("id", "organization_id");

-- CreateIndex
CREATE INDEX "buyer_interactions_organization_id_sales_mission_buyer_id_idx" ON "buyer_interactions"("organization_id", "sales_mission_buyer_id");

-- CreateIndex
CREATE INDEX "buyer_interactions_organization_id_classification_idx" ON "buyer_interactions"("organization_id", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_interactions_id_organization_id_key" ON "buyer_interactions"("id", "organization_id");

-- CreateIndex
CREATE INDEX "suppression_records_organization_id_phone_idx" ON "suppression_records"("organization_id", "phone");

-- CreateIndex
CREATE INDEX "suppression_records_organization_id_email_idx" ON "suppression_records"("organization_id", "email");

-- CreateIndex
CREATE INDEX "suppression_records_organization_id_domain_idx" ON "suppression_records"("organization_id", "domain");

-- CreateIndex
CREATE INDEX "suppression_records_organization_id_sales_mission_buyer_id_idx" ON "suppression_records"("organization_id", "sales_mission_buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_records_id_organization_id_key" ON "suppression_records"("id", "organization_id");

-- CreateIndex
CREATE INDEX "conversion_events_organization_id_sales_mission_buyer_id_cr_idx" ON "conversion_events"("organization_id", "sales_mission_buyer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_events_id_organization_id_key" ON "conversion_events"("id", "organization_id");

-- CreateIndex
CREATE INDEX "sales_mission_buyers_organization_id_conversion_stage_idx" ON "sales_mission_buyers"("organization_id", "conversion_stage");

-- AddForeignKey
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_sales_mission_buyer_id_organization_id_fkey" FOREIGN KEY ("sales_mission_buyer_id", "organization_id") REFERENCES "sales_mission_buyers"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_approved_by_user_id_organization_id_fkey" FOREIGN KEY ("approved_by_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_rejected_by_user_id_organization_id_fkey" FOREIGN KEY ("rejected_by_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_interactions" ADD CONSTRAINT "buyer_interactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_interactions" ADD CONSTRAINT "buyer_interactions_sales_mission_buyer_id_organization_id_fkey" FOREIGN KEY ("sales_mission_buyer_id", "organization_id") REFERENCES "sales_mission_buyers"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression_records" ADD CONSTRAINT "suppression_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression_records" ADD CONSTRAINT "suppression_records_sales_mission_buyer_id_organization_id_fkey" FOREIGN KEY ("sales_mission_buyer_id", "organization_id") REFERENCES "sales_mission_buyers"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_sales_mission_buyer_id_organization_id_fkey" FOREIGN KEY ("sales_mission_buyer_id", "organization_id") REFERENCES "sales_mission_buyers"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_user_id_organization_id_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
