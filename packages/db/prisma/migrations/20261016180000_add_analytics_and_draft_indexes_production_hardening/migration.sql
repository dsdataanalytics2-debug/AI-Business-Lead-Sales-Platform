-- CreateIndex
CREATE INDEX "sales_mission_buyers_organization_id_provider_idx" ON "sales_mission_buyers"("organization_id", "provider");

-- CreateIndex
CREATE INDEX "sales_mission_buyers_organization_id_created_at_idx" ON "sales_mission_buyers"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "outreach_drafts_organization_id_sales_mission_id_idx" ON "outreach_drafts"("organization_id", "sales_mission_id");
