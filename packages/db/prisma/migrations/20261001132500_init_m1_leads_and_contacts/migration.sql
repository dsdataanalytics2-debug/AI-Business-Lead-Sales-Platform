-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('PHONE', 'WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "PhoneType" AS ENUM ('MOBILE', 'LANDLINE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('FOUND', 'INVALID_FORMAT', 'VERIFIED', 'STALE');

-- CreateEnum
CREATE TYPE "WhatsAppStatus" AS ENUM ('UNKNOWN', 'PUBLICLY_LISTED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('WA_ME_LINK', 'LISTING_FIELD', 'OFFICIAL_PAGE_TEXT', 'AUTHORIZED_API', 'MANUAL_CONFIRMED');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('UNKNOWN', 'NONE_DETECTED', 'REACHABLE', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "OnlinePresenceType" AS ENUM ('WEBSITE', 'FACEBOOK_ONLY', 'INSTAGRAM_ONLY', 'MARKETPLACE_ONLY', 'NONE_DETECTED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "locality" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Dhaka',
    "region" TEXT DEFAULT 'Dhaka Division',
    "country" TEXT NOT NULL DEFAULT 'BD',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "primary_phone" TEXT,
    "primary_email" TEXT,
    "website" TEXT,
    "normalized_website" TEXT,
    "website_status" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN',
    "online_presence_type" "OnlinePresenceType" NOT NULL DEFAULT 'UNKNOWN',
    "rating" DOUBLE PRECISION,
    "review_count" INTEGER DEFAULT 0,
    "primary_source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_contacts" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "type" "ContactType" NOT NULL,
    "raw_value" TEXT NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "phone_type" "PhoneType" DEFAULT 'UNKNOWN',
    "status" "ContactStatus" NOT NULL DEFAULT 'FOUND',
    "whatsapp_status" "WhatsAppStatus" NOT NULL DEFAULT 'UNKNOWN',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_evidences" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_url" TEXT,
    "evidence_type" "EvidenceType" NOT NULL,
    "snippet" TEXT,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_evidences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_external_id" TEXT,
    "source_url" TEXT,
    "raw_data" JSONB,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_organization_id_idx" ON "leads"("organization_id");

-- CreateIndex
CREATE INDEX "leads_organization_id_normalized_name_idx" ON "leads"("organization_id", "normalized_name");

-- CreateIndex
CREATE INDEX "leads_organization_id_primary_phone_idx" ON "leads"("organization_id", "primary_phone");

-- CreateIndex
CREATE INDEX "leads_organization_id_normalized_website_idx" ON "leads"("organization_id", "normalized_website");

-- CreateIndex
CREATE INDEX "leads_organization_id_city_idx" ON "leads"("organization_id", "city");

-- CreateIndex
CREATE INDEX "leads_organization_id_category_idx" ON "leads"("organization_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "leads_id_organization_id_key" ON "leads"("id", "organization_id");

-- CreateIndex
CREATE INDEX "lead_contacts_lead_id_idx" ON "lead_contacts"("lead_id");

-- CreateIndex
CREATE INDEX "lead_contacts_normalized_value_idx" ON "lead_contacts"("normalized_value");

-- CreateIndex
CREATE INDEX "lead_contacts_type_normalized_value_idx" ON "lead_contacts"("type", "normalized_value");

-- CreateIndex
CREATE INDEX "contact_evidences_contact_id_idx" ON "contact_evidences"("contact_id");

-- CreateIndex
CREATE INDEX "contact_evidences_source_name_idx" ON "contact_evidences"("source_name");

-- CreateIndex
CREATE INDEX "lead_sources_lead_id_idx" ON "lead_sources"("lead_id");

-- CreateIndex
CREATE INDEX "lead_sources_organization_id_idx" ON "lead_sources"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_organization_id_source_name_source_external_id_key" ON "lead_sources"("organization_id", "source_name", "source_external_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_contacts" ADD CONSTRAINT "lead_contacts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_evidences" ADD CONSTRAINT "contact_evidences_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "lead_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_lead_id_organization_id_fkey" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
