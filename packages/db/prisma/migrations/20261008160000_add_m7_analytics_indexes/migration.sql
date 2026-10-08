-- CreateIndex
CREATE INDEX "leads_organization_id_created_at_idx" ON "leads"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_organization_id_assigned_user_id_created_at_idx" ON "leads"("organization_id", "assigned_user_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_organization_id_primary_source_idx" ON "leads"("organization_id", "primary_source");

-- CreateIndex
CREATE INDEX "follow_up_tasks_organization_id_status_completed_at_idx" ON "follow_up_tasks"("organization_id", "status", "completed_at");

-- CreateIndex
CREATE INDEX "outreach_deliveries_organization_id_sent_at_idx" ON "outreach_deliveries"("organization_id", "sent_at");
