-- CreateTable
CREATE TABLE "ai_provider_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'gemini-3.1-flash-lite',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "encrypted_credential" TEXT,
    "credential_masked" TEXT,
    "credential_last_four" TEXT,
    "last_tested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_provider_configs_organization_id_idx" ON "ai_provider_configs"("organization_id");

-- CreateIndex
CREATE INDEX "ai_provider_configs_organization_id_provider_idx" ON "ai_provider_configs"("organization_id", "provider");

-- CreateIndex
CREATE INDEX "ai_provider_configs_organization_id_is_enabled_idx" ON "ai_provider_configs"("organization_id", "is_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_configs_organization_id_provider_key" ON "ai_provider_configs"("organization_id", "provider");

-- AddForeignKey
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
