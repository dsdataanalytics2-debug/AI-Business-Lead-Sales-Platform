-- CreateIndex
CREATE INDEX "leads_organization_id_assigned_user_id_crm_stage_idx" ON "leads"("organization_id", "assigned_user_id", "crm_stage");

-- CreateIndex
CREATE INDEX "users_organization_id_created_at_idx" ON "users"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "users_organization_id_role_idx" ON "users"("organization_id", "role");
