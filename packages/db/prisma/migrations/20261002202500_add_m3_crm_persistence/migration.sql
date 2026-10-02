-- CreateEnum
CREATE TYPE "CrmStage" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('LEAD_ASSIGNED', 'LEAD_UNASSIGNED', 'LEAD_REASSIGNED', 'STAGE_CHANGED', 'NOTE_ADDED');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "assigned_at" TIMESTAMP(3),
ADD COLUMN     "assigned_user_id" TEXT,
ADD COLUMN     "crm_stage" "CrmStage" NOT NULL DEFAULT 'NEW';

-- CreateTable
CREATE TABLE "crm_notes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "type" "CrmActivityType" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_notes_organization_id_lead_id_created_at_idx" ON "crm_notes"("organization_id", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_notes_organization_id_user_id_idx" ON "crm_notes"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "crm_activities_organization_id_lead_id_created_at_idx" ON "crm_activities"("organization_id", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_activities_organization_id_actor_user_id_idx" ON "crm_activities"("organization_id", "actor_user_id");

-- CreateIndex
CREATE INDEX "leads_organization_id_crm_stage_idx" ON "leads"("organization_id", "crm_stage");

-- CreateIndex
CREATE INDEX "leads_organization_id_assigned_user_id_idx" ON "leads"("organization_id", "assigned_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_organization_id_key" ON "users"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_user_id_organization_id_fkey" FOREIGN KEY ("assigned_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_lead_id_organization_id_fkey" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_user_id_organization_id_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_lead_id_organization_id_fkey" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_actor_user_id_organization_id_fkey" FOREIGN KEY ("actor_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
