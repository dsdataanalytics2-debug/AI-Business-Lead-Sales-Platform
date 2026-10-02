-- CreateEnum
CREATE TYPE "AnalysisWebsiteStatus" AS ENUM ('NOT_APPLICABLE', 'REACHABLE', 'UNREACHABLE', 'TIMEOUT', 'ACCESS_RESTRICTED', 'BLOCKED_SSRF', 'INVALID_URL', 'NON_HTML');

-- CreateTable
CREATE TABLE "lead_online_presence_analyses" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "website_url" TEXT,
    "website_status" "AnalysisWebsiteStatus" NOT NULL,
    "http_status_code" INTEGER,
    "is_https" BOOLEAN NOT NULL DEFAULT false,
    "is_redirected" BOOLEAN NOT NULL DEFAULT false,
    "final_url" TEXT,
    "response_time_ms" INTEGER,
    "page_title" TEXT,
    "meta_description" TEXT,
    "has_website" BOOLEAN NOT NULL DEFAULT false,
    "has_facebook" BOOLEAN NOT NULL DEFAULT false,
    "has_instagram" BOOLEAN NOT NULL DEFAULT false,
    "has_marketplace" BOOLEAN NOT NULL DEFAULT false,
    "campaign_scores" JSONB NOT NULL,
    "analyzer_version" TEXT NOT NULL DEFAULT 'v1',
    "score_version" TEXT NOT NULL DEFAULT 'v1',
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_online_presence_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_online_presence_analyses_lead_id_organization_id_key" ON "lead_online_presence_analyses"("lead_id", "organization_id");

-- AddForeignKey
ALTER TABLE "lead_online_presence_analyses" ADD CONSTRAINT "lead_online_presence_analyses_lead_id_organization_id_fkey" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_online_presence_analyses" ADD CONSTRAINT "lead_online_presence_analyses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
