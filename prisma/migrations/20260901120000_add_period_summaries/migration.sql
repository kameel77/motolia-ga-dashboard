-- CreateTable
CREATE TABLE "period_summaries" (
    "id" SERIAL NOT NULL,
    "period" TEXT NOT NULL,
    "windowOffset" INTEGER NOT NULL DEFAULT 0,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "avgSessionDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "period_summaries_period_windowOffset_key" ON "period_summaries"("period", "windowOffset");
