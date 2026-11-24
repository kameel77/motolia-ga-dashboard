-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_daily_work" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "agentLogin" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "loginSec" INTEGER NOT NULL DEFAULT 0,
    "pauseSec" INTEGER NOT NULL DEFAULT 0,
    "inboundCount" INTEGER NOT NULL DEFAULT 0,
    "inboundAnswered" INTEGER NOT NULL DEFAULT 0,
    "inboundNotAnswered" INTEGER NOT NULL DEFAULT 0,
    "inboundTalkSec" INTEGER NOT NULL DEFAULT 0,
    "outboundAboveCount" INTEGER NOT NULL DEFAULT 0,
    "outboundBelowCount" INTEGER NOT NULL DEFAULT 0,
    "outboundTalkSec" INTEGER NOT NULL DEFAULT 0,
    "ticketsResponded" INTEGER NOT NULL DEFAULT 0,
    "ticketsClosed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_daily_work_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_daily_work_date_agentLogin_key" ON "agent_daily_work"("date", "agentLogin");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_daily_work_date_idx" ON "agent_daily_work"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_daily_work_agentLogin_idx" ON "agent_daily_work"("agentLogin");
