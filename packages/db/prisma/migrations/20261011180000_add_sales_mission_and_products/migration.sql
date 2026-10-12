-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'MANUAL',
    "source_provider" TEXT,
    "external_product_id" TEXT,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "selling_price" DECIMAL(12,2),
    "cost_price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "minimum_order_quantity" INTEGER,
    "brand" TEXT,
    "image_url" TEXT,
    "product_url" TEXT,
    "imported_from" TEXT,
    "target_market" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sales_priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_missions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "product_id" TEXT,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT 'WHOLESALE',
    "target_market" TEXT NOT NULL,
    "buyer_type" TEXT NOT NULL DEFAULT 'AI_DECIDE',
    "result_target" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "product_analysis_snapshot" JSONB,
    "selected_buyer_targets" JSONB,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_mission_buyers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sales_mission_id" TEXT NOT NULL,
    "external_business_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "category" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "website" TEXT,
    "phone" TEXT,
    "matched_buyer_category" TEXT,
    "search_target_used" TEXT,
    "source_data" JSONB,
    "lead_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POTENTIAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_mission_buyers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_organization_id_created_at_idx" ON "products"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "products_organization_id_name_idx" ON "products"("organization_id", "name");

-- CreateIndex
CREATE INDEX "products_organization_id_status_idx" ON "products"("organization_id", "status");

-- CreateIndex
CREATE INDEX "products_organization_id_category_idx" ON "products"("organization_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_organization_id_key" ON "products"("id", "organization_id");

-- CreateIndex
CREATE INDEX "sales_missions_organization_id_created_at_idx" ON "sales_missions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_missions_organization_id_product_id_idx" ON "sales_missions"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "sales_missions_organization_id_status_idx" ON "sales_missions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_missions_id_organization_id_key" ON "sales_missions"("id", "organization_id");

-- CreateIndex
CREATE INDEX "sales_mission_buyers_organization_id_sales_mission_id_idx" ON "sales_mission_buyers"("organization_id", "sales_mission_id");

-- CreateIndex
CREATE INDEX "sales_mission_buyers_organization_id_status_idx" ON "sales_mission_buyers"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_mission_buyers_id_organization_id_key" ON "sales_mission_buyers"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_mission_buyers_sales_mission_id_provider_external_bus_key" ON "sales_mission_buyers"("sales_mission_id", "provider", "external_business_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_missions" ADD CONSTRAINT "sales_missions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_missions" ADD CONSTRAINT "sales_missions_created_by_user_id_organization_id_fkey" FOREIGN KEY ("created_by_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_missions" ADD CONSTRAINT "sales_missions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_mission_buyers" ADD CONSTRAINT "sales_mission_buyers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_mission_buyers" ADD CONSTRAINT "sales_mission_buyers_sales_mission_id_organization_id_fkey" FOREIGN KEY ("sales_mission_id", "organization_id") REFERENCES "sales_missions"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_mission_buyers" ADD CONSTRAINT "sales_mission_buyers_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
