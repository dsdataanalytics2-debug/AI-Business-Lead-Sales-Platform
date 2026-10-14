-- AlterTable
ALTER TABLE "sales_mission_buyers" ADD COLUMN "source_evidences" JSONB;
ALTER TABLE "sales_mission_buyers" ADD COLUMN "enriched_contacts" JSONB;
ALTER TABLE "sales_mission_buyers" ADD COLUMN "source_confidence" TEXT DEFAULT 'MEDIUM';
ALTER TABLE "sales_mission_buyers" ADD COLUMN "whatsapp_status" TEXT DEFAULT 'NOT_VERIFIED';
