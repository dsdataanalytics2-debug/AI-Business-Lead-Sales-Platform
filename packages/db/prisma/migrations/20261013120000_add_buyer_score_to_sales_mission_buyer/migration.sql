-- AlterTable
ALTER TABLE "sales_mission_buyers" ADD COLUMN "buyer_score" INTEGER,
ADD COLUMN "score_breakdown" JSONB;

-- CreateIndex
CREATE INDEX "sales_mission_buyers_organization_id_buyer_score_idx" ON "sales_mission_buyers"("organization_id", "buyer_score");
