-- CreateTable
CREATE TABLE IF NOT EXISTS "report_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_settings_pkey" PRIMARY KEY ("key")
);
