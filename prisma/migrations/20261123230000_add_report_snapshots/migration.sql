-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "ReportGranularity" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_snapshots" (
    "id" SERIAL NOT NULL,
    "granularity" "ReportGranularity" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "report_snapshots_granularity_periodKey_key" ON "report_snapshots"("granularity", "periodKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_snapshots_granularity_startDate_idx" ON "report_snapshots"("granularity", "startDate");
