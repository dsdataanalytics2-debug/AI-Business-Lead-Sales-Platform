-- AlterTable
ALTER TABLE "sales_mission_buyers" ADD COLUMN "priority" TEXT DEFAULT 'WARM',
ADD COLUMN "wholesale_intent" TEXT DEFAULT 'NONE',
ADD COLUMN "wholesale_intent_signals" JSONB,
ADD COLUMN "suggested_related_needs" JSONB;

-- CreateIndex
CREATE INDEX "sales_mission_buyers_organization_id_priority_idx" ON "sales_mission_buyers"("organization_id", "priority");
