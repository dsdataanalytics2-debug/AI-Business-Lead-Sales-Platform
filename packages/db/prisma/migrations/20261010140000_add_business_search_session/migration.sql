-- CreateTable
CREATE TABLE "business_search_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_query" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "buyer_type" TEXT,
    "category" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'auto',
    "limit" INTEGER NOT NULL DEFAULT 20,
    "selected_ai_buyer_targets" JSONB,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "results_snapshot" JSONB NOT NULL,
    "source_metadata" JSONB,
    "search_status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "last_opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_search_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_search_sessions_organization_id_user_id_last_opened_at_idx" ON "business_search_sessions"("organization_id", "user_id", "last_opened_at");

-- CreateIndex
CREATE INDEX "business_search_sessions_organization_id_user_id_created_at_idx" ON "business_search_sessions"("organization_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "business_search_sessions_id_organization_id_key" ON "business_search_sessions"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "business_search_sessions" ADD CONSTRAINT "business_search_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_search_sessions" ADD CONSTRAINT "business_search_sessions_user_id_organization_id_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
