-- CreateEnum
CREATE TYPE "SalesAssistantDraftType" AS ENUM ('WHATSAPP', 'EMAIL', 'CALL_SCRIPT', 'PROPOSAL', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "SalesAssistantLanguage" AS ENUM ('BANGLA', 'ENGLISH', 'MIXED');

-- CreateEnum
CREATE TYPE "SalesAssistantTone" AS ENUM ('PROFESSIONAL', 'FRIENDLY', 'CONCISE', 'PERSUASIVE');

-- CreateEnum
CREATE TYPE "SalesAssistantDraftStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SalesAssistantWarning" AS ENUM ('MISSING_PRODUCT_CONTEXT', 'MISSING_PRICE_CONTEXT', 'UNVERIFIED_WHATSAPP', 'UNSUPPORTED_CLAIM_REMOVED', 'LIMITED_LEAD_CONTEXT');

-- CreateTable
CREATE TABLE "sales_assistant_drafts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "type" "SalesAssistantDraftType" NOT NULL,
    "language" "SalesAssistantLanguage" NOT NULL,
    "tone" "SalesAssistantTone" NOT NULL,
    "status" "SalesAssistantDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "objective" TEXT,
    "custom_instruction" TEXT,
    "content" TEXT,
    "email_subject" TEXT,
    "email_body" TEXT,
    "warnings" "SalesAssistantWarning"[] DEFAULT ARRAY[]::"SalesAssistantWarning"[],
    "approved_at" TIMESTAMP(3),
    "approved_by_user_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejected_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_assistant_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_assistant_drafts_organization_id_lead_id_created_at_idx" ON "sales_assistant_drafts"("organization_id", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_assistant_drafts_organization_id_status_created_at_idx" ON "sales_assistant_drafts"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "sales_assistant_drafts_organization_id_created_by_user_id_c_idx" ON "sales_assistant_drafts"("organization_id", "created_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_assistant_drafts_organization_id_type_created_at_idx" ON "sales_assistant_drafts"("organization_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_assistant_drafts_id_organization_id_key" ON "sales_assistant_drafts"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "sales_assistant_drafts" ADD CONSTRAINT "sales_assistant_drafts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_assistant_drafts" ADD CONSTRAINT "sales_assistant_drafts_lead_id_organization_id_fkey" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_assistant_drafts" ADD CONSTRAINT "sales_assistant_drafts_created_by_user_id_organization_id_fkey" FOREIGN KEY ("created_by_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_assistant_drafts" ADD CONSTRAINT "sales_assistant_drafts_approved_by_user_id_organization_id_fkey" FOREIGN KEY ("approved_by_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_assistant_drafts" ADD CONSTRAINT "sales_assistant_drafts_rejected_by_user_id_organization_id_fkey" FOREIGN KEY ("rejected_by_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
