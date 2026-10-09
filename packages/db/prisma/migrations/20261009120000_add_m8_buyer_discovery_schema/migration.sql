-- CreateEnum
CREATE TYPE "SignalConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'ABANDONED');

-- CreateEnum
CREATE TYPE "BuyerIntentSignalType" AS ENUM ('PUBLIC_PROCUREMENT', 'CATALOG_GAP', 'TRADE_CLASSIFICATION', 'HIRING_EXPANSION', 'PROMOTIONAL_ACTIVITY', 'MANUAL_VERIFIED', 'OTHER');

-- CreateEnum
CREATE TYPE "BuyerType" AS ENUM ('RETAILER', 'WHOLESALER', 'DISTRIBUTOR', 'ECOMMERCE_SELLER', 'CORPORATE_BUYER', 'UNKNOWN');

-- DropIndex
DROP INDEX "data_source_configs_name_key";

-- AlterTable
ALTER TABLE "data_source_configs" ADD COLUMN     "credential_last_four" TEXT,
ADD COLUMN     "credential_masked" TEXT,
ADD COLUMN     "encrypted_credential" TEXT,
ADD COLUMN     "last_tested_at" TIMESTAMP(3),
ADD COLUMN     "organization_id" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'mock';

-- AlterTable
ALTER TABLE "lead_contacts" ADD COLUMN     "last_checked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "contact_evidences" ADD COLUMN     "confidence" "SignalConfidence" NOT NULL DEFAULT 'MEDIUM';

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "product_interest" TEXT NOT NULL,
    "buyer_type" "BuyerType" NOT NULL DEFAULT 'UNKNOWN',
    "need" TEXT,
    "intent_score" INTEGER NOT NULL DEFAULT 0,
    "strongest_signal" TEXT,
    "stage" "CrmStage" NOT NULL DEFAULT 'QUALIFIED',
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_intent_signals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "opportunity_id" TEXT,
    "source_name" TEXT NOT NULL,
    "source_url" TEXT,
    "signal_type" "BuyerIntentSignalType" NOT NULL,
    "description" TEXT,
    "confidence" "SignalConfidence" NOT NULL DEFAULT 'MEDIUM',
    "score_contribution" INTEGER NOT NULL DEFAULT 0,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_intent_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunities_organization_id_lead_id_idx" ON "opportunities"("organization_id", "lead_id");

-- CreateIndex
CREATE INDEX "opportunities_organization_id_stage_idx" ON "opportunities"("organization_id", "stage");

-- CreateIndex
CREATE INDEX "opportunities_organization_id_buyer_type_idx" ON "opportunities"("organization_id", "buyer_type");

-- CreateIndex
CREATE INDEX "opportunities_organization_id_intent_score_idx" ON "opportunities"("organization_id", "intent_score");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_id_organization_id_key" ON "opportunities"("id", "organization_id");

-- CreateIndex
CREATE INDEX "buyer_intent_signals_organization_id_lead_id_idx" ON "buyer_intent_signals"("organization_id", "lead_id");

-- CreateIndex
CREATE INDEX "buyer_intent_signals_organization_id_opportunity_id_idx" ON "buyer_intent_signals"("organization_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "buyer_intent_signals_organization_id_signal_type_idx" ON "buyer_intent_signals"("organization_id", "signal_type");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_intent_signals_id_organization_id_key" ON "buyer_intent_signals"("id", "organization_id");

-- CreateIndex
CREATE INDEX "data_source_configs_organization_id_idx" ON "data_source_configs"("organization_id");

-- CreateIndex
CREATE INDEX "data_source_configs_organization_id_provider_idx" ON "data_source_configs"("organization_id", "provider");

-- CreateIndex
CREATE INDEX "data_source_configs_organization_id_is_enabled_idx" ON "data_source_configs"("organization_id", "is_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_configs_organization_id_name_key" ON "data_source_configs"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_configs_global_name_key" ON "data_source_configs"("name") WHERE "organization_id" IS NULL;


-- AddForeignKey
ALTER TABLE "data_source_configs" ADD CONSTRAINT "data_source_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_organization_id_fkey" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_intent_signals" ADD CONSTRAINT "buyer_intent_signals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_intent_signals" ADD CONSTRAINT "buyer_intent_signals_lead_id_organization_id_fkey" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_intent_signals" ADD CONSTRAINT "buyer_intent_signals_opportunity_id_organization_id_fkey" FOREIGN KEY ("opportunity_id", "organization_id") REFERENCES "opportunities"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
