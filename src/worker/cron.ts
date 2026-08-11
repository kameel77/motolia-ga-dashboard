import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { invalidatePattern } from "../lib/redis";
import { getWarsawNow, getWarsawDateString } from "../lib/utils";
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
import { fetchGscData } from "../lib/gsc-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CRON_INTERVAL = parseInt(process.env.CRON_INTERVAL_MINUTES || "5", 10);

function ts(): string {
  return getWarsawNow().toISOString();
}

function todayString(): string {
  return getWarsawDateString();
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
        capturedAt: getWarsawNow(),
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
  const now = getWarsawNow();
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
    const [year, month, day] = today.split("-").map(Number);
    const todayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const todayEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

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
      const dateObj = new Date(Date.UTC(year, month, day, 0, 0, 0));

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
// Thulium Sync
// ---------------------------------------------------------------------------

const THULIUM_USERNAME = process.env.THULIUM_USERNAME || 'api_user_analytics';
const THULIUM_API_KEY = process.env.THULIUM_API_KEY;
const THULIUM_INSTANCE = process.env.THULIUM_INSTANCE || 'motolia';

// No hardcoded fallback — the key must come from the environment.
// A missing key must not take the worker down: GA4 collection has to keep
// running, and this module is also imported by /api/sync, where a top-level
// throw would break the route. CRM sync is skipped with a loud log instead.
async function fetchThulium(path: string): Promise<any> {
  if (!THULIUM_API_KEY) {
    throw new Error('THULIUM_API_KEY environment variable is required');
  }
  const auth = Buffer.from(`${THULIUM_USERNAME}:${THULIUM_API_KEY}`).toString('base64');
  const url = `https://${THULIUM_INSTANCE}.thulium.com/api${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) {
    throw new Error(`Thulium API returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function parseWarsawDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();
  const isoStr = dateStr.replace(" ", "T");
  if (isoStr.includes("Z") || isoStr.includes("+") || (isoStr.includes("-") && isoStr.split("-").length > 3)) {
    return new Date(dateStr);
  }
  
  const dateObj = new Date(isoStr + "Z");
  try {
    const tzString = dateObj.toLocaleString("en-US", { timeZone: "Europe/Warsaw" });
    const localDate = new Date(tzString);
    const diffMs = localDate.getTime() - dateObj.getTime();
    return new Date(new Date(isoStr + "Z").getTime() - diffMs);
  } catch (e) {
    const month = dateObj.getUTCMonth() + 1;
    const offset = (month >= 4 && month <= 10) ? "+02:00" : "+01:00";
    return new Date(isoStr + offset);
  }
}
function mapThuliumStatus(statusName: string | null): "NEW" | "IN_PROGRESS" | "OFFER" | "WON" | "LOST" {
  if (!statusName) return "NEW";
  const s = statusName.toLowerCase();

  // Explicit win markers checked first so "zamknięte - wygrany" maps to WON
  // before the generic "zamkni" LOST check below. Thulium statuses:
  // "zamknięte", "zamknięte - wygrany", "zamknięty - przegrany", "zamknięty - spam".
  if (
    s.includes("wygran") ||
    s.includes("sukces") ||
    s.includes("sprzedan") ||
    s.includes("zaakceptowane") ||
    s.includes("won")
  ) {
    return "WON";
  }

  if (
    s.includes("odrzucon") ||
    s.includes("przegran") ||
    s.includes("lost") ||
    s.includes("spam") ||
    s.includes("anulowan") ||
    s.includes("rezygnac") ||
    s.includes("bez powodzenia") ||
    // Plain "zamknięte" without a win marker = closed without a sale
    s.includes("zamkni")
  ) {
    return "LOST";
  }
  
  if (
    s.includes("oferta") || 
    s.includes("offer") || 
    s.includes("wycen")
  ) {
    return "OFFER";
  }
  
  if (
    s.includes("otwarty") || 
    s.includes("kontakt") || 
    s.includes("proces") || 
    s.includes("bieżąc") ||
    s.includes("toku") ||
    s.includes("podjęt")
  ) {
    return "IN_PROGRESS";
  }
  
  if (s.includes("nowy") || s.includes("nowe")) {
    return "NEW";
  }
  
  return "NEW";
}

function mapThuliumSource(sourceStr: string | null): "PHONE" | "EMAIL" | "WEB_FORM" {
  if (!sourceStr) return "WEB_FORM";
  const s = sourceStr.toLowerCase();
  if (s.includes("phone") || s.includes("telefon") || s.includes("call")) return "PHONE";
  if (s.includes("email") || s.includes("mail")) return "EMAIL";
  return "WEB_FORM";
}

function extractThuliumDetails(ticket: any) {
  let text = "";
  if (ticket.messages && ticket.messages.length > 0) {
    ticket.messages.forEach((msg: any) => {
      text += "\n" + (msg.body || "") + "\n" + (msg.comment || "") + "\n" + (msg.system_comment || "");
    });
  }

  const priceMatch = text.match(/(?:Cena|Cena \(PLN\)|Wartość|Kwota)\s*:\s*([\d\s]+)/i);
  const urlMatch = text.match(/(?:Link do ogłoszenia|URL|Adres)\s*:\s*(https?:\/\/[^\s]+)/i);
  const referrerMatch = text.match(/(?:Referrer|Źródło)\s*:\s*([^\s\n\r]+)/i);
  
  const utmSourceMatch = text.match(/utm_source\s*:\s*([^\s\n\r]+)/i);
  const utmMediumMatch = text.match(/utm_medium\s*:\s*([^\s\n\r]+)/i);
  const utmCampaignMatch = text.match(/utm_campaign\s*:\s*([^\s\n\r]+)/i);

  let value = 0;
  if (priceMatch) {
    value = parseFloat(priceMatch[1].replace(/\s/g, "")) || 0;
  }

  return {
    value,
    url: urlMatch ? urlMatch[1] : null,
    referrer: referrerMatch ? referrerMatch[1] : null,
    utmSource: utmSourceMatch ? utmSourceMatch[1] : null,
    utmMedium: utmMediumMatch ? utmMediumMatch[1] : null,
    utmCampaign: utmCampaignMatch ? utmCampaignMatch[1] : null,
  };
}

const THULIUM_PAGE_LIMIT = 100;
const THULIUM_MAX_PAGES = 10;
const THULIUM_LOOKBACK_DAYS = 7;

/**
 * Paginate a Thulium list endpoint (newest first) until records are older
 * than the lookback window, the page is short, or the page cap is reached.
 */
async function fetchThuliumPaged(basePath: string, dateField: string): Promise<any[]> {
  const cutoff = Date.now() - THULIUM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const items: any[] = [];
  for (let page = 0; page < THULIUM_MAX_PAGES; page++) {
    const res = await fetchThulium(`${basePath}?limit=${THULIUM_PAGE_LIMIT}&offset=${page * THULIUM_PAGE_LIMIT}`);
    const batch = res.result || [];
    if (batch.length === 0) break;
    items.push(...batch);
    const oldestDate = batch[batch.length - 1]?.[dateField];
    if (oldestDate && parseWarsawDate(oldestDate).getTime() < cutoff) break;
    if (batch.length < THULIUM_PAGE_LIMIT) break;
  }
  return items;
}

async function collectThulium(): Promise<void> {
  if (!THULIUM_API_KEY) {
    console.error(
      `[Cron] ${ts()} THULIUM_API_KEY is not set — skipping CRM sync. ` +
        `Lead and call data will be stale. GA4 collection continues.`
    );
    return;
  }
  console.log(`[Cron] ${ts()} Synchronizing Thulium CRM data...`);
  try {
    // 1. Fetch customers for lookup
    const rawCustomers = await fetchThulium("/customers?limit=1000");
    const customersList = Array.isArray(rawCustomers) ? rawCustomers : (rawCustomers.result || rawCustomers.data || []);
    const customerMap = new Map();
    customersList.forEach((c: any) => {
      customerMap.set(String(c.customer_id), {
        name: `${c.name || ""} ${c.surname || ""}`.trim() || "Klient Anonimowy",
        phone: c.phone_number || c.phone || null,
        email: c.email || (c.emails && c.emails[0]) || null,
      });
    });

    // 2. Fetch connections (paginated over the lookback window)
    const calls = await fetchThuliumPaged("/connections", "date");
    let callsImported = 0;

    for (const call of calls) {
      const timestamp = parseWarsawDate(call.date);
      if (isNaN(timestamp.getTime())) continue;

      await prisma.crmCall.upsert({
        where: { id: String(call.connection_id) },
        create: {
          id: String(call.connection_id),
          phone: call.src,
          direction: call.type || "INBOUND",
          disposition: call.disposition,
          duration: parseInt(call.duration) || 0,
          billsec: parseInt(call.billsec) || 0,
          agentName: call.user_login || null,
          queueName: call.queue_id ? String(call.queue_id) : null,
          timestamp,
        },
        update: {
          disposition: call.disposition,
          duration: parseInt(call.duration) || 0,
          billsec: parseInt(call.billsec) || 0,
          agentName: call.user_login || null,
          timestamp,
        }
      });

      // Record answered call conversion
      if (call.disposition === "ANSWERED") {
        const capturedAt = new Date(timestamp);
        capturedAt.setUTCSeconds(0, 0);
        capturedAt.setUTCMinutes(capturedAt.getUTCMinutes() < 30 ? 0 : 30);

        const dateHour = `${capturedAt.getUTCFullYear()}${String(capturedAt.getUTCMonth() + 1).padStart(2, "0")}${String(capturedAt.getUTCDate()).padStart(2, "0")}${String(capturedAt.getUTCHours()).padStart(2, "0")}${capturedAt.getUTCMinutes() < 30 ? "00" : "30"}`;

        const trafficRow = await prisma.trafficByHour.findFirst({ where: { dateHour } });
        if (trafficRow) {
          await prisma.trafficByHour.update({
            where: { id: trafficRow.id },
            data: { conversions: { increment: 1 } }
          });
        }

        const existingConv = await prisma.conversionEvent.findFirst({
          where: {
            capturedAt,
            eventName: "crm_lead_phone",
            source: "crm_connector"
          }
        });

        if (!existingConv) {
          await prisma.conversionEvent.create({
            data: {
              capturedAt,
              eventName: "crm_lead_phone",
              source: "crm_connector",
              medium: "phone",
              count: 1
            }
          });
        }
      }
      callsImported++;
    }

    // 3. Fetch tickets (paginated over the lookback window)
    const tickets = await fetchThuliumPaged("/tickets", "created_at");
    let ticketsImported = 0;

    for (const ticket of tickets) {
      const thuliumCreatedAt = parseWarsawDate(ticket.created_at);
      const thuliumUpdatedAt = parseWarsawDate(ticket.updated_at);
      if (isNaN(thuliumCreatedAt.getTime())) continue;

      const cust = customerMap.get(String(ticket.customer_id)) || {
        name: "Klient Anonimowy",
        phone: null,
        email: ticket.from || null,
      };

      const details = extractThuliumDetails(ticket);
      const sourceVal = mapThuliumSource(ticket.source);
      const statusVal = mapThuliumStatus(ticket.full_status_name);

      const existingLead = await prisma.crmLead.findUnique({
        where: { id: String(ticket.ticket_id) }
      });

      await prisma.crmLead.upsert({
        where: { id: String(ticket.ticket_id) },
        create: {
          id: String(ticket.ticket_id),
          clientName: cust.name,
          clientEmail: cust.email || ticket.from || null,
          clientPhone: cust.phone || null,
          source: sourceVal,
          status: statusVal,
          thuliumStatus: ticket.full_status_name || "Nowy",
          queueName: ticket.ticket_queue_name || null,
          subject: ticket.subject || null,
          agentName: ticket.user_login || null,
          value: details.value,
          url: details.url,
          referrer: details.referrer,
          utmSource: details.utmSource,
          utmMedium: details.utmMedium,
          utmCampaign: details.utmCampaign,
          thuliumCreatedAt,
          thuliumUpdatedAt,
        },
        update: {
          status: statusVal,
          thuliumStatus: ticket.full_status_name || "Nowy",
          agentName: ticket.user_login || null,
          thuliumCreatedAt,
          thuliumUpdatedAt,
          value: details.value > 0 ? details.value : undefined,
        }
      });

      if (!existingLead) {
        const capturedAt = new Date(thuliumCreatedAt);
        capturedAt.setUTCSeconds(0, 0);
        capturedAt.setUTCMinutes(capturedAt.getUTCMinutes() < 30 ? 0 : 30);

        const dateHour = `${capturedAt.getUTCFullYear()}${String(capturedAt.getUTCMonth() + 1).padStart(2, "0")}${String(capturedAt.getUTCDate()).padStart(2, "0")}${String(capturedAt.getUTCHours()).padStart(2, "0")}${capturedAt.getUTCMinutes() < 30 ? "00" : "30"}`;
        // CRM events use distinct names so they are never double-counted
        // with GA4 events (form_submission / phone_call_click)
        const eventName = sourceVal === "PHONE" ? "crm_lead_phone" : "crm_lead_form";

        const trafficRow = await prisma.trafficByHour.findFirst({ where: { dateHour } });
        if (trafficRow) {
          await prisma.trafficByHour.update({
            where: { id: trafficRow.id },
            data: { conversions: { increment: 1 } }
          });
        }

        const existingConv = await prisma.conversionEvent.findFirst({
          where: {
            capturedAt,
            eventName,
            source: details.utmSource || "crm_connector"
          }
        });

        if (!existingConv) {
          await prisma.conversionEvent.create({
            data: {
              capturedAt,
              eventName,
              source: details.utmSource || "crm_connector",
              medium: details.utmMedium || (sourceVal === "PHONE" ? "phone" : "web"),
              count: 1
            }
          });
        }
      }
      ticketsImported++;
    }

    console.log(`[Cron] ${ts()} Thulium CRM sync complete. Calls synced: ${callsImported}, Tickets synced: ${ticketsImported}`);
  } catch (err) {
    console.error(`[Cron] ${ts()} collectThulium error:`, err);
  }
}


async function collectGsc(): Promise<void> {
  console.log(`[Cron] ${ts()} Collecting GSC data...`);
  try {
    const siteUrl = process.env.GSC_SITE_URL || "https://motolia.pl/";
    // GSC data is typically delayed by 2-3 days
    const targetDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const rows = await fetchGscData(siteUrl, targetDate, targetDate);

    await prisma.$transaction(async (tx) => {
      await tx.gscPerformance.deleteMany({
        where: { capturedAt: new Date(targetDate) }
      });
      if (rows.length > 0) {
        await tx.gscPerformance.createMany({
          data: rows.map((row: any) => ({
            capturedAt: new Date(targetDate),
            url: row.keys[0],
            query: row.keys[1],
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          }))
        });
      }
    });
    console.log(`[Cron] ${ts()} GSC data saved: ${rows.length} rows for ${targetDate}`);
  } catch (err) {
    console.error(`[Cron] ${ts()} collectGsc error:`, err);
  }
}

// ---------------------------------------------------------------------------
// Full collection cycle
// ---------------------------------------------------------------------------

export async function runCollectionCycle(): Promise<void> {
  const start = Date.now();
  console.log(`\n[Cron] ========== Collection cycle start: ${ts()} ==========`);

  await collectRealtime();
  await collectDailyTraffic();
  await collectThulium();
  await invalidateCache();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[Cron] ========== Collection cycle complete in ${elapsed}s ==========\n`
  );
}

async function runHourlyCycle(): Promise<void> {
  console.log(`\n[Cron] ========== Hourly cycle start: ${ts()} ==========`);
  await collectDailySummary();
  await collectGsc();
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
