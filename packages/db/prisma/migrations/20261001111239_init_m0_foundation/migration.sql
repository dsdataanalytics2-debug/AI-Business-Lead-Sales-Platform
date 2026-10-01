-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_EXECUTIVE', 'VIEWER');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('PENDING', 'APPROVED', 'RESTRICTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DataSourceRole" AS ENUM ('DISCOVERY', 'ENRICHMENT', 'BOTH');

-- CreateEnum
CREATE TYPE "SuppressionType" AS ENUM ('PHONE', 'WHATSAPP', 'EMAIL', 'DOMAIN', 'BUSINESS');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('OPT_OUT', 'DO_NOT_CONTACT', 'COMPLAINT', 'INVALID', 'LEGAL', 'INTERNAL_POLICY');

-- CreateEnum
CREATE TYPE "ChannelScope" AS ENUM ('ALL', 'CALL', 'WHATSAPP', 'EMAIL');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "workingDays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4]::INTEGER[],
    "workStart" TEXT NOT NULL DEFAULT '10:00',
    "workEnd" TEXT NOT NULL DEFAULT '18:00',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_source_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "DataSourceRole" NOT NULL DEFAULT 'BOTH',
    "status" "DataSourceStatus" NOT NULL DEFAULT 'PENDING',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "terms_url" TEXT,
    "terms_verified_at" TIMESTAMP(3),
    "terms_verified_by" TEXT,
    "persistence_policy" JSONB NOT NULL DEFAULT '{}',
    "refresh_policy" JSONB NOT NULL DEFAULT '{}',
    "rate_limit_config" JSONB NOT NULL DEFAULT '{}',
    "pricing" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_source_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_lists" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "SuppressionType" NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "channel_scope" "ChannelScope" NOT NULL DEFAULT 'ALL',
    "reason" "SuppressionReason" NOT NULL,
    "source_note" TEXT,
    "added_by" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "suppression_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_ledgers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "campaign_id" TEXT,
    "lead_id" TEXT,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "unit_type" TEXT NOT NULL,
    "cost_amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "exchange_rate_to_bdt" DOUBLE PRECISION,
    "is_estimate" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_token_hash_idx" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_idx" ON "audit_logs"("organization_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_read_at_idx" ON "notifications"("read_at");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_configs_name_key" ON "data_source_configs"("name");

-- CreateIndex
CREATE INDEX "suppression_lists_organization_id_idx" ON "suppression_lists"("organization_id");

-- CreateIndex
CREATE INDEX "suppression_lists_normalized_value_idx" ON "suppression_lists"("normalized_value");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_lists_organization_id_type_normalized_value_cha_key" ON "suppression_lists"("organization_id", "type", "normalized_value", "channel_scope");

-- CreateIndex
CREATE INDEX "usage_ledgers_organization_id_idx" ON "usage_ledgers"("organization_id");

-- CreateIndex
CREATE INDEX "usage_ledgers_campaign_id_idx" ON "usage_ledgers"("campaign_id");

-- CreateIndex
CREATE INDEX "usage_ledgers_provider_idx" ON "usage_ledgers"("provider");

-- CreateIndex
CREATE INDEX "usage_ledgers_created_at_idx" ON "usage_ledgers"("created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression_lists" ADD CONSTRAINT "suppression_lists_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_ledgers" ADD CONSTRAINT "usage_ledgers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
