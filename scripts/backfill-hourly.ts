/**
 * One-off backfill for historical GA4 data.
 *
 * Two things it repairs:
 *
 *  1. TrafficByHour rows collected before the switch to the `dateHour`
 *     dimension. Those were built by summing per-minute rows into 30-minute
 *     buckets, which counts a visitor once per minute they were active and
 *     inflated the /trends chart roughly 4x.
 *  2. DailySnapshot rows for past days. The worker only ever fetched "today",
 *     so every day stayed frozen at its 23:00 value and was never corrected
 *     once GA4 finished processing it.
 *
 * Usage:  npx tsx scripts/backfill-hourly.ts [days]   (default 30)
 */
import { prisma } from "../src/lib/prisma";
import { fetchDailyTrafficByHour, fetchDailySummary } from "../src/lib/ga4-client";
import { getWarsawDateString } from "../src/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

async function backfillDay(date: string): Promise<void> {
  const prefix = date.replace(/-/g, "");
  const [year, month, day] = date.split("-").map(Number);
  // Midday of the day itself, so the heatmap's capturedAt window sees these
  // rows on the day they describe.
  const capturedAt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const byHour = await fetchDailyTrafficByHour(date);

  await prisma.$transaction(async (tx) => {
    await tx.trafficByHour.deleteMany({ where: { dateHour: { startsWith: prefix } } });

    if (byHour.length > 0) {
      await tx.trafficByHour.createMany({
        data: byHour.map((row) => ({
          capturedAt,
          dateHour: row.dateHour,
          sessions: row.sessions,
          users: row.totalUsers,
          conversions: row.conversions,
        })),
      });
    }
  });

  const [summary] = await fetchDailySummary(date, date);
  if (summary) {
    const dateObj = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const values = {
      sessions: summary.sessions,
      users: summary.totalUsers,
      newUsers: summary.newUsers,
      bounceRate: summary.bounceRate,
      conversions: summary.conversions,
      avgSessionDuration: summary.averageSessionDuration,
    };
    await prisma.dailySnapshot.upsert({
      where: { date: dateObj },
      update: values,
      create: { date: dateObj, ...values },
    });
  }

  const hourSessions = byHour.reduce((s, r) => s + r.sessions, 0);
  console.log(
    `${date}: ${byHour.length} hourly rows (${hourSessions} sessions), daily total ${summary?.sessions ?? "n/a"}`
  );
}

async function main(): Promise<void> {
  const days = parseInt(process.argv[2] || "30", 10);
  if (isNaN(days) || days < 1) {
    console.error("Usage: npx tsx scripts/backfill-hourly.ts [days]");
    process.exit(1);
  }

  console.log(`Backfilling the last ${days} day(s)...`);

  for (let i = days - 1; i >= 0; i--) {
    const date = getWarsawDateString(new Date(Date.now() - i * DAY_MS));
    try {
      await backfillDay(date);
    } catch (err) {
      console.error(`${date}: FAILED`, err);
    }
  }

  await prisma.$disconnect();
  console.log("Done.");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
