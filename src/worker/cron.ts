import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { invalidatePattern } from "../lib/redis";
import {
  fetchRealtimeData,
  fetchDailyTrafficBySource,
  fetchDailyTrafficByHour,
  fetchDailyTrafficByGeo,
  fetchDailyTrafficByDevice,
  fetchDailyTrafficByLandingPage,
  fetchDailyConversions,
  fetchDailySummary,
} from "../lib/ga4-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CRON_INTERVAL = parseInt(process.env.CRON_INTERVAL_MINUTES || "5", 10);

function ts(): string {
  return new Date().toISOString();
}

function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Collection routines
// ---------------------------------------------------------------------------

async function collectRealtime(): Promise<void> {
  console.log(`[Cron] ${ts()} Collecting realtime data...`);

  try {
    const data = await fetchRealtimeData();

    // Map GA4 RealtimeData fields to Prisma RealtimeSnapshot schema
    await prisma.realtimeSnapshot.create({
      data: {
        capturedAt: new Date(),
        activeUsers: data.totalActiveUsers,
        eventCount: data.totalEventCount,
        keyEvents: data.totalKeyEvents,
        pageViews: data.totalScreenPageViews,
        topSources: JSON.parse(JSON.stringify(data.events.slice(0, 10))),
        topPages: JSON.parse(JSON.stringify(data.pages.slice(0, 10))),
        topCities: JSON.parse(JSON.stringify(data.geo.slice(0, 10))),
      },
    });

    console.log(
      `[Cron] ${ts()} Realtime snapshot saved: ${data.totalActiveUsers} active users`
    );
  } catch (err) {
    console.error(`[Cron] ${ts()} collectRealtime error:`, err);
  }
}

async function collectDailyTraffic(): Promise<void> {
  const today = todayString();
  const now = new Date();
  console.log(`[Cron] ${ts()} Collecting daily traffic for ${today}...`);

  try {
    const [bySource, byHour, byGeo, byDevice, byLandingPage, conversions] =
      await Promise.all([
        fetchDailyTrafficBySource(today),
        fetchDailyTrafficByHour(today),
        fetchDailyTrafficByGeo(today),
        fetchDailyTrafficByDevice(today),
        fetchDailyTrafficByLandingPage(today),
        fetchDailyConversions(today),
      ]);

    // Delete today's existing rows and re-insert atomically
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      // Delete today's data
      await tx.trafficBySource.deleteMany({ where: { capturedAt: { gte: todayStart, lt: todayEnd } } });
      await tx.trafficByHour.deleteMany({ where: { capturedAt: { gte: todayStart, lt: todayEnd } } });
      await tx.trafficByGeo.deleteMany({ where: { capturedAt: { gte: todayStart, lt: todayEnd } } });
      await tx.trafficByDevice.deleteMany({ where: { capturedAt: { gte: todayStart, lt: todayEnd } } });
      await tx.trafficByLandingPage.deleteMany({ where: { capturedAt: { gte: todayStart, lt: todayEnd } } });
      await tx.conversionEvent.deleteMany({ where: { capturedAt: { gte: todayStart, lt: todayEnd } } });

      // Insert fresh data — map GA4 field names to Prisma field names
      if (bySource.length > 0) {
        await tx.trafficBySource.createMany({
          data: bySource.map((row) => ({
            capturedAt: now,
            source: row.sessionSource,
            medium: row.sessionMedium,
            sessions: row.sessions,
            users: row.totalUsers,
            newUsers: row.newUsers,
            bounceRate: row.bounceRate,
            engagementRate: row.engagementRate,
            conversions: row.conversions,
          })),
        });
      }

      if (byHour.length > 0) {
        await tx.trafficByHour.createMany({
          data: byHour.map((row) => ({
            capturedAt: now,
            dateHour: row.dateHour,
            sessions: row.sessions,
            users: row.totalUsers,
            conversions: row.conversions,
          })),
        });
      }

      if (byGeo.length > 0) {
        await tx.trafficByGeo.createMany({
          data: byGeo.map((row) => ({
            capturedAt: now,
            country: row.country,
            region: row.region,
            city: row.city,
            sessions: row.sessions,
            users: row.totalUsers,
            conversions: row.conversions,
          })),
        });
      }

      if (byDevice.length > 0) {
        await tx.trafficByDevice.createMany({
          data: byDevice.map((row) => ({
            capturedAt: now,
            deviceCategory: row.deviceCategory,
            sessions: row.sessions,
            users: row.totalUsers,
            bounceRate: row.bounceRate,
          })),
        });
      }

      if (byLandingPage.length > 0) {
        await tx.trafficByLandingPage.createMany({
          data: byLandingPage.map((row) => ({
            capturedAt: now,
            landingPage: row.landingPage,
            sessions: row.sessions,
            users: row.totalUsers,
            bounceRate: row.bounceRate,
            conversions: row.conversions,
          })),
        });
      }

      if (conversions.length > 0) {
        await tx.conversionEvent.createMany({
          data: conversions.map((row) => ({
            capturedAt: now,
            eventName: row.eventName,
            source: row.sessionSource,
            medium: row.sessionMedium,
            count: row.eventCount,
          })),
        });
      }
    });

    console.log(
      `[Cron] ${ts()} Daily traffic saved — ` +
        `source: ${bySource.length}, hour: ${byHour.length}, ` +
        `geo: ${byGeo.length}, device: ${byDevice.length}, ` +
        `landing: ${byLandingPage.length}, conversions: ${conversions.length}`
    );
  } catch (err) {
    console.error(`[Cron] ${ts()} collectDailyTraffic error:`, err);
  }
}

async function collectDailySummary(): Promise<void> {
  const today = todayString();
  console.log(`[Cron] ${ts()} Collecting daily summary for ${today}...`);

  try {
    const rows = await fetchDailySummary(today, today);

    for (const row of rows) {
      // GA4 returns date as "YYYYMMDD" string — parse it
      const dateStr = row.date;
      const year = parseInt(dateStr.slice(0, 4));
      const month = parseInt(dateStr.slice(4, 6)) - 1;
      const day = parseInt(dateStr.slice(6, 8));
      const dateObj = new Date(year, month, day);

      await prisma.dailySnapshot.upsert({
        where: { date: dateObj },
        update: {
          sessions: row.sessions,
          users: row.totalUsers,
          newUsers: row.newUsers,
          bounceRate: row.bounceRate,
          conversions: row.conversions,
          avgSessionDuration: row.averageSessionDuration,
        },
        create: {
          date: dateObj,
          sessions: row.sessions,
          users: row.totalUsers,
          newUsers: row.newUsers,
          bounceRate: row.bounceRate,
          conversions: row.conversions,
          avgSessionDuration: row.averageSessionDuration,
        },
      });
    }

    console.log(`[Cron] ${ts()} Daily summary saved: ${rows.length} row(s)`);
  } catch (err) {
    console.error(`[Cron] ${ts()} collectDailySummary error:`, err);
  }
}

async function invalidateCache(): Promise<void> {
  try {
    await invalidatePattern("realtime:*");
    await invalidatePattern("overview:*");
    await invalidatePattern("channels:*");
    await invalidatePattern("hourly:*");
    await invalidatePattern("geography:*");
    await invalidatePattern("devices:*");
    await invalidatePattern("conversions:*");
    console.log(`[Cron] ${ts()} Cache invalidated`);
  } catch (err) {
    console.error(`[Cron] ${ts()} Cache invalidation error:`, err);
  }
}

// ---------------------------------------------------------------------------
// Full collection cycle
// ---------------------------------------------------------------------------

async function runCollectionCycle(): Promise<void> {
  const start = Date.now();
  console.log(`\n[Cron] ========== Collection cycle start: ${ts()} ==========`);

  await collectRealtime();
  await collectDailyTraffic();
  await invalidateCache();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[Cron] ========== Collection cycle complete in ${elapsed}s ==========\n`
  );
}

async function runHourlyCycle(): Promise<void> {
  console.log(`\n[Cron] ========== Hourly cycle start: ${ts()} ==========`);
  await collectDailySummary();
  await invalidateCache();
  console.log(`[Cron] ========== Hourly cycle complete ==========\n`);
}

// ---------------------------------------------------------------------------
// Worker startup
// ---------------------------------------------------------------------------

export function startWorker(): void {
  console.log(`[Cron] Starting analytics worker...`);
  console.log(`[Cron] Collection interval: every ${CRON_INTERVAL} minute(s)`);
  console.log(`[Cron] Hourly summary: at minute 0 of every hour`);

  cron.schedule(`*/${CRON_INTERVAL} * * * *`, async () => {
    try {
      await runCollectionCycle();
    } catch (err) {
      console.error(`[Cron] ${ts()} Unhandled error in collection cycle:`, err);
    }
  });

  cron.schedule("0 * * * *", async () => {
    try {
      await runHourlyCycle();
    } catch (err) {
      console.error(`[Cron] ${ts()} Unhandled error in hourly cycle:`, err);
    }
  });

  console.log(`[Cron] Running initial collection cycle...`);
  runCollectionCycle()
    .then(() => console.log(`[Cron] Initial collection cycle complete`))
    .catch((err) => console.error(`[Cron] Initial collection cycle failed:`, err));

  const shutdown = async (signal: string) => {
    console.log(`\n[Cron] Received ${signal}. Shutting down gracefully...`);
    cron.getTasks().forEach((task) => task.stop());
    await prisma.$disconnect();
    console.log("[Cron] Worker stopped.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ---------------------------------------------------------------------------
// Standalone execution
// ---------------------------------------------------------------------------

if (require.main === module) {
  startWorker();
}
