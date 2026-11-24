-- AlterEnum
ALTER TYPE "CrmLeadStatus" ADD VALUE IF NOT EXISTS 'EXCLUDED';

-- AlterTable
ALTER TABLE "crm_calls" ADD COLUMN IF NOT EXISTS "waitTime" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "crm_lead_status_history" (
    "id" SERIAL NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStatus" "CrmLeadStatus",
    "toStatus" "CrmLeadStatus" NOT NULL,
    "thuliumStatus" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_lead_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "crm_lead_status_history_leadId_changedAt_idx" ON "crm_lead_status_history"("leadId", "changedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "crm_lead_status_history_toStatus_idx" ON "crm_lead_status_history"("toStatus");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'crm_lead_status_history_leadId_fkey'
    ) THEN
        ALTER TABLE "crm_lead_status_history"
        ADD CONSTRAINT "crm_lead_status_history_leadId_fkey"
        FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
