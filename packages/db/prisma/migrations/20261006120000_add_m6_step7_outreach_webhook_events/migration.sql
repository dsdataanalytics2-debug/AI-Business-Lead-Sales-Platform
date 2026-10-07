-- CreateTable
CREATE TABLE "outreach_webhook_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "provider_name" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "processing_status" TEXT NOT NULL DEFAULT 'PENDING',
    "safe_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_webhook_events_provider_name_event_id_key" ON "outreach_webhook_events"("provider_name", "event_id");

-- CreateIndex
CREATE INDEX "outreach_webhook_events_provider_name_provider_message_id_idx" ON "outreach_webhook_events"("provider_name", "provider_message_id");

-- CreateIndex
CREATE INDEX "outreach_webhook_events_organization_id_created_at_idx" ON "outreach_webhook_events"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "outreach_webhook_events" ADD CONSTRAINT "outreach_webhook_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
