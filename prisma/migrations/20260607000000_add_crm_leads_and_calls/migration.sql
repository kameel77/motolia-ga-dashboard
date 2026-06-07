-- CreateEnum
CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'OFFER', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmLeadSource" AS ENUM ('PHONE', 'EMAIL', 'WEB_FORM');

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" TEXT NOT NULL,
    "clientName" TEXT NOT NULL DEFAULT 'Klient Anonimowy',
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "source" "CrmLeadSource" NOT NULL,
    "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
    "thuliumStatus" TEXT NOT NULL,
    "queueName" TEXT,
    "subject" TEXT,
    "agentName" TEXT,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "url" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "thuliumCreatedAt" TIMESTAMP(3) NOT NULL,
    "thuliumUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_calls" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "billsec" INTEGER NOT NULL,
    "agentName" TEXT,
    "queueName" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_leads_status_idx" ON "crm_leads"("status");

-- CreateIndex
CREATE INDEX "crm_leads_thuliumCreatedAt_idx" ON "crm_leads"("thuliumCreatedAt");

-- CreateIndex
CREATE INDEX "crm_calls_timestamp_idx" ON "crm_calls"("timestamp");
