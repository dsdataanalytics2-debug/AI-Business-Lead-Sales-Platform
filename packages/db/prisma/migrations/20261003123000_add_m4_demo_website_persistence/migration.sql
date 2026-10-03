-- CreateEnum
CREATE TYPE "DemoWebsiteStatus" AS ENUM ('REQUESTED', 'CREATING', 'READY', 'FAILED', 'EXPIRED', 'REMOVED');

-- CreateEnum
CREATE TYPE "DemoWebsiteProvider" AS ENUM ('STOREMATE', 'MOCK');

-- CreateTable
CREATE TABLE "demo_websites" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "provider" "DemoWebsiteProvider" NOT NULL DEFAULT 'MOCK',
    "provider_site_id" TEXT,
    "status" "DemoWebsiteStatus" NOT NULL DEFAULT 'REQUESTED',
    "demo_url" TEXT,
    "ready_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message_safe" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_websites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "demo_websites_id_organization_id_key" ON "demo_websites"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "demo_websites_lead_id_organization_id_key" ON "demo_websites"("lead_id", "organization_id");

-- CreateIndex
CREATE INDEX "demo_websites_organization_id_status_idx" ON "demo_websites"("organization_id", "status");

-- CreateIndex
CREATE INDEX "demo_websites_organization_id_provider_status_idx" ON "demo_websites"("organization_id", "provider", "status");

-- CreateIndex
CREATE INDEX "demo_websites_expires_at_status_idx" ON "demo_websites"("expires_at", "status");

-- AddForeignKey
ALTER TABLE "demo_websites" ADD CONSTRAINT "demo_websites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_websites" ADD CONSTRAINT "demo_websites_lead_id_organization_id_fkey" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_websites" ADD CONSTRAINT "demo_websites_requested_by_user_id_organization_id_fkey" FOREIGN KEY ("requested_by_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
