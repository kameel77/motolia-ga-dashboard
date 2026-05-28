-- CreateTable
CREATE TABLE "import_logs" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id")
);
