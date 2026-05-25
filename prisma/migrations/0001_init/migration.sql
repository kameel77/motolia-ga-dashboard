-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "realtime_snapshots" (
    "id" SERIAL NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "keyEvents" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "topSources" JSONB,
    "topPages" JSONB,
    "topCities" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realtime_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_by_source" (
    "id" SERIAL NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engagementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_by_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_by_hour" (
    "id" SERIAL NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "dateHour" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_by_hour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_by_geo" (
    "id" SERIAL NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_by_geo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_by_device" (
    "id" SERIAL NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "deviceCategory" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_by_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_by_landing_page" (
    "id" SERIAL NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "landingPage" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_by_landing_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_events" (
    "id" SERIAL NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "eventName" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tv_schedule" (
    "id" SERIAL NOT NULL,
    "zlecenie" TEXT,
    "station" TEXT NOT NULL,
    "airDate" TIMESTAMP(3) NOT NULL,
    "program" TEXT,
    "product" TEXT,
    "spotLength" INTEGER,
    "pasmo" TEXT,
    "spotVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tv_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_snapshots" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "avgSessionDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "realtime_snapshots_capturedAt_idx" ON "realtime_snapshots"("capturedAt");

-- CreateIndex
CREATE INDEX "traffic_by_source_capturedAt_idx" ON "traffic_by_source"("capturedAt");

-- CreateIndex
CREATE INDEX "traffic_by_source_source_medium_idx" ON "traffic_by_source"("source", "medium");

-- CreateIndex
CREATE INDEX "traffic_by_hour_capturedAt_idx" ON "traffic_by_hour"("capturedAt");

-- CreateIndex
CREATE INDEX "traffic_by_hour_dateHour_idx" ON "traffic_by_hour"("dateHour");

-- CreateIndex
CREATE INDEX "traffic_by_geo_capturedAt_idx" ON "traffic_by_geo"("capturedAt");

-- CreateIndex
CREATE INDEX "traffic_by_device_capturedAt_idx" ON "traffic_by_device"("capturedAt");

-- CreateIndex
CREATE INDEX "traffic_by_landing_page_capturedAt_idx" ON "traffic_by_landing_page"("capturedAt");

-- CreateIndex
CREATE INDEX "conversion_events_capturedAt_eventName_idx" ON "conversion_events"("capturedAt", "eventName");

-- CreateIndex
CREATE INDEX "tv_schedule_airDate_idx" ON "tv_schedule"("airDate");

-- CreateIndex
CREATE INDEX "tv_schedule_station_idx" ON "tv_schedule"("station");

-- CreateIndex
CREATE INDEX "daily_snapshots_date_idx" ON "daily_snapshots"("date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_snapshots_date_key" ON "daily_snapshots"("date");

