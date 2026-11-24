import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { invalidatePattern } from "../lib/redis";
import {
  getWarsawNow,
  getWarsawDateString,
  getPeriodRange,
  PERIODS,
  type Period,
} from "../lib/utils";
import {
  fetchRealtimeData,
  fetchDailyTrafficBySource,
  fetchDailyTrafficByHour,
  fetchDailyTrafficByGeo,
  fetchDailyTrafficByDevice,
  fetchDailyTrafficByLandingPage,
  fetchDailyConversions,
  fetchDailySummary,
  fetchPeriodSummary,
} from "../lib/ga4-client";
import { fetchGscData } from "../lib/gsc-client";
import {
  mapThuliumStatus,
  mapThuliumSource,
  isMissedCallTicket,
  classifyInboundCall,
} from "../lib/thulium-mapping";
import { runScheduledReportGeneration } from "../lib/report-builder";

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
        topSources: JSON.parse(JSON.stringify(data.events.slice(0, 25))),
        topPages: JSON.parse(JSON.stringify(data.pages.slice(0, 15))),
        topCities: JSON.parse(JSON.stringify(data.geo.slice(0, 25))),
        topDevices: JSON.parse(JSON.stringify(data.devices)),
      },
    });

    console.log(
      `[Cron] ${ts()} Realtime snapshot saved: ${data.totalActiveUsers} active users`
    );
  } catch (err) {
    console.error(`[Cron] ${ts()} collectRealtime error:`, err);
  }
}

async function collectDailyTrafficForDate(
  targetDate: string,
  capturedAt: Date
): Promise<void> {
  console.log(`[Cron] ${ts()} Collecting daily traffic for ${targetDate}...`);

  try {
    const [bySource, byHour, byGeo, byDevice, byLandingPage, conversions] =
      await Promise.all([
        fetchDailyTrafficBySource(targetDate),
        fetchDailyTrafficByHour(targetDate),
        fetchDailyTrafficByGeo(targetDate),
        fetchDailyTrafficByDevice(targetDate),
        fetchDailyTrafficByLandingPage(targetDate),
        fetchDailyConversions(targetDate),
      ]);

    const [year, month, day] = targetDate.split("-").map(Number);
    const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const dayEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

    await prisma.$transaction(async (tx) => {
      // Only replace a table when GA4 returned rows so a delayed/empty batch
      // never wipes out previously collected rows.
      if (bySource.length > 0) {
        await tx.trafficBySource.deleteMany({
          where: { capturedAt: { gte: dayStart, lt: dayEnd } },
        });
        await tx.trafficBySource.createMany({
          data: bySource.map((row) => ({
            capturedAt,
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
        await tx.trafficByHour.deleteMany({
          where: { capturedAt: { gte: dayStart, lt: dayEnd } },
        });
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

      if (byGeo.length > 0) {
        await tx.trafficByGeo.deleteMany({
          where: { capturedAt: { gte: dayStart, lt: dayEnd } },
        });
        await tx.trafficByGeo.createMany({
          data: byGeo.map((row) => ({
            capturedAt,
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
        await tx.trafficByDevice.deleteMany({
          where: { capturedAt: { gte: dayStart, lt: dayEnd } },
        });
        await tx.trafficByDevice.createMany({
          data: byDevice.map((row) => ({
            capturedAt,
            deviceCategory: row.deviceCategory,
            sessions: row.sessions,
            users: row.totalUsers,
            bounceRate: row.bounceRate,
          })),
        });
      }

      if (byLandingPage.length > 0) {
        await tx.trafficByLandingPage.deleteMany({
          where: { capturedAt: { gte: dayStart, lt: dayEnd } },
        });
        await tx.trafficByLandingPage.createMany({
          data: byLandingPage.map((row) => ({
            capturedAt,
            landingPage: row.landingPage,
            sessions: row.sessions,
            users: row.totalUsers,
            bounceRate: row.bounceRate,
            conversions: row.conversions,
          })),
        });
      }

      if (conversions.length > 0) {
        // Preserve CRM-sourced conversion rows (crm_lead_form, crm_lead_phone)
        await tx.conversionEvent.deleteMany({
          where: {
            capturedAt: { gte: dayStart, lt: dayEnd },
            eventName: { notIn: ["crm_lead_form", "crm_lead_phone"] },
          },
        });
        await tx.conversionEvent.createMany({
          data: conversions.map((row) => ({
            capturedAt,
            eventName: row.eventName,
            source: row.sessionSource,
            medium: row.sessionMedium,
            count: row.eventCount,
          })),
        });
      }
    });

    console.log(
      `[Cron] ${ts()} Daily traffic (${targetDate}) saved — ` +
        `source: ${bySource.length}, hour: ${byHour.length}, ` +
        `geo: ${byGeo.length}, device: ${byDevice.length}, ` +
        `landing: ${byLandingPage.length}, conversions: ${conversions.length}`
    );
  } catch (err) {
    console.error(`[Cron] ${ts()} collectDailyTraffic (${targetDate}) error:`, err);
  }
}

async function collectDailyTraffic(): Promise<void> {
  await collectDailyTrafficForDate(todayString(), getWarsawNow());
}

// GA4 keeps finalising a day for hours after midnight, so a day fetched only
// while it was "today" stays frozen at whatever it looked like at 23:00 and is
// never corrected. Re-fetch a short trailing window instead.
const SUMMARY_BACKFILL_DAYS = 3;

async function collectDailyTrafficBackfill(): Promise<void> {
  for (let i = 1; i < SUMMARY_BACKFILL_DAYS; i++) {
    const targetDate = getWarsawDateString(
      new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    );
    const [year, month, day] = targetDate.split("-").map(Number);
    const capturedAt = new Date(Date.UTC(year, month - 1, day, 23, 55, 0));
    await collectDailyTrafficForDate(targetDate, capturedAt);
  }
}

async function collectDailySummary(): Promise<void> {
  const today = todayString();
  const startDate = getWarsawDateString(
    new Date(Date.now() - (SUMMARY_BACKFILL_DAYS - 1) * 24 * 60 * 60 * 1000)
  );
  console.log(
    `[Cron] ${ts()} Collecting daily summary for ${startDate} -> ${today}...`
  );

  try {
    const rows = await fetchDailySummary(startDate, today);

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

/**
 * Period-level totals straight from GA4, with no dimension breakdown.
 *
 * The overview KPIs used to sum TrafficBySource rows, which over-reports:
 * GA4's source breakdown adds overlapping "(not set)" / "(data not available)"
 * rows, and a user arriving from two sources is counted twice. Unique users
 * over a multi-day window cannot be derived from stored daily rows at all, so
 * each window is fetched as one report and cached here.
 */
async function collectPeriodSummaries(periods: Period[]): Promise<void> {
  console.log(`[Cron] ${ts()} Collecting period summaries: ${periods.join(", ")}...`);

  for (const period of periods) {
    for (const windowOffset of [0, 1]) {
      try {
        const { start, end, startDate, endDate } = getPeriodRange(period, windowOffset);
        const row = await fetchPeriodSummary(start, end);

        const values = {
          startDate,
          endDate,
          sessions: row.sessions,
          users: row.totalUsers,
          newUsers: row.newUsers,
          bounceRate: row.bounceRate,
          conversions: row.conversions,
          avgSessionDuration: row.averageSessionDuration,
        };

        await prisma.periodSummary.upsert({
          where: { period_windowOffset: { period, windowOffset } },
          update: values,
          create: { period, windowOffset, ...values },
        });
      } catch (err) {
        console.error(
          `[Cron] ${ts()} collectPeriodSummaries error (${period}, offset ${windowOffset}):`,
          err
        );
      }
    }
  }

  console.log(`[Cron] ${ts()} Period summaries saved`);
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

      const existingCall = await prisma.crmCall.findUnique({
        where: { id: String(call.connection_id) }
      });

      const callDirection = call.type || "INBOUND";
      const callBillsec = parseInt(call.billsec) || 0;
      const callWaitTime = parseInt(call.wait_time) || 0;
      const callAgentName = call.user_login || call.dst_user_login || null;

      await prisma.crmCall.upsert({
        where: { id: String(call.connection_id) },
        create: {
          id: String(call.connection_id),
          phone: call.src || "",
          direction: callDirection,
          disposition: call.disposition,
          duration: parseInt(call.duration) || 0,
          billsec: callBillsec,
          waitTime: callWaitTime,
          agentName: callAgentName,
          queueName: call.queue_id ? String(call.queue_id) : null,
          timestamp,
        },
        update: {
          disposition: call.disposition,
          duration: parseInt(call.duration) || 0,
          billsec: callBillsec,
          waitTime: callWaitTime,
          agentName: callAgentName,
          timestamp,
        }
      });

      const isInboundRealAnswer =
        (!callDirection || callDirection.toUpperCase() === "INBOUND") &&
        classifyInboundCall({
          id: String(call.connection_id),
          phone: call.src || "",
          direction: callDirection,
          disposition: call.disposition,
          billsec: callBillsec,
          waitTime: callWaitTime,
          agentName: callAgentName,
          timestamp,
        }) === "ANSWERED";

      // Record answered inbound call conversion only for newly discovered agent-handled calls >= 30s
      if (!existingCall && isInboundRealAnswer) {
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
      const sourceVal = mapThuliumSource(ticket);
      const thuliumStatusStr = ticket.full_status_name || "Nowy";
      const statusVal = mapThuliumStatus(
        thuliumStatusStr,
        ticket.status_id,
        ticket.substatus_id
      );
      const leadId = String(ticket.ticket_id);

      const existingLead = await prisma.crmLead.findUnique({
        where: { id: leadId }
      });

      await prisma.crmLead.upsert({
        where: { id: leadId },
        create: {
          id: leadId,
          clientName: cust.name,
          clientEmail: cust.email || ticket.from || null,
          clientPhone: cust.phone || null,
          source: sourceVal,
          status: statusVal,
          thuliumStatus: thuliumStatusStr,
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
          clientName: cust.name && cust.name !== "Klient Anonimowy" ? cust.name : undefined,
          clientEmail: cust.email || ticket.from || undefined,
          clientPhone: cust.phone || undefined,
          source: sourceVal,
          status: statusVal,
          thuliumStatus: thuliumStatusStr,
          queueName: ticket.ticket_queue_name || undefined,
          subject: ticket.subject || undefined,
          agentName: ticket.user_login || null,
          thuliumCreatedAt,
          thuliumUpdatedAt,
          value: details.value > 0 ? details.value : undefined,
        }
      });

      if (!existingLead) {
        await prisma.crmLeadStatusHistory.create({
          data: {
            leadId,
            fromStatus: null,
            toStatus: statusVal,
            thuliumStatus: thuliumStatusStr,
            changedAt: thuliumCreatedAt,
          },
        });
      } else if (existingLead.status !== statusVal) {
        await prisma.crmLeadStatusHistory.create({
          data: {
            leadId,
            fromStatus: existingLead.status,
            toStatus: statusVal,
            thuliumStatus: thuliumStatusStr,
            changedAt: thuliumUpdatedAt,
          },
        });
      }

      if (!existingLead) {
        const isMissedCall =
          sourceVal === "PHONE" ||
          isMissedCallTicket(ticket.ticket_queue_name, ticket.subject);
        const isExcluded = statusVal === "EXCLUDED";
        const isSpam =
          statusVal === "LOST" &&
          thuliumStatusStr.toLowerCase().includes("spam");

        // Only record conversions for genuine web/form leads (not missed calls, excluded, or spam)
        if (!isMissedCall && !isExcluded && !isSpam) {
          const capturedAt = new Date(thuliumCreatedAt);
          capturedAt.setUTCSeconds(0, 0);
          capturedAt.setUTCMinutes(capturedAt.getUTCMinutes() < 30 ? 0 : 30);

          const dateHour = `${capturedAt.getUTCFullYear()}${String(capturedAt.getUTCMonth() + 1).padStart(2, "0")}${String(capturedAt.getUTCDate()).padStart(2, "0")}${String(capturedAt.getUTCHours()).padStart(2, "0")}${capturedAt.getUTCMinutes() < 30 ? "00" : "30"}`;
          const eventName = "crm_lead_form";

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
                medium: details.utmMedium || "web",
                count: 1
              }
            });
          }
        }
      }
      ticketsImported++;
    }

    console.log(`[Cron] ${ts()} Thulium CRM sync complete. Calls synced: ${callsImported}, Tickets synced: ${ticketsImported}`);
  } catch (err) {
    console.error(`[Cron] ${ts()} collectThulium error:`, err);
  }
}

let didBackfillLeadStatuses = false;

/**
 * One-time per worker lifecycle backfill: ensures historical CrmLead rows
 * reflect the updated mapThuliumStatus rules (e.g. "Oczekuje na klienta" -> IN_PROGRESS,
 * "Zamknięte - SPAM" / "Połączone" / "Test" -> EXCLUDED) and have an initial history row.
 */
async function backfillLeadStatuses(): Promise<void> {
  if (didBackfillLeadStatuses) return;
  try {
    const leads = await prisma.crmLead.findMany({
      select: {
        id: true,
        status: true,
        thuliumStatus: true,
        thuliumCreatedAt: true,
        thuliumUpdatedAt: true,
        _count: { select: { statusHistory: true } },
      },
    });

    let updatedCount = 0;
    let historySeeded = 0;

    for (const lead of leads) {
      const expectedStatus = mapThuliumStatus(lead.thuliumStatus);
      if (lead.status !== expectedStatus) {
        await prisma.crmLead.update({
          where: { id: lead.id },
          data: { status: expectedStatus },
        });
        await prisma.crmLeadStatusHistory.create({
          data: {
            leadId: lead.id,
            fromStatus: lead.status,
            toStatus: expectedStatus,
            thuliumStatus: lead.thuliumStatus,
            changedAt: lead.thuliumUpdatedAt || lead.thuliumCreatedAt,
          },
        });
        updatedCount++;
      } else if (lead._count.statusHistory === 0) {
        await prisma.crmLeadStatusHistory.create({
          data: {
            leadId: lead.id,
            fromStatus: null,
            toStatus: lead.status,
            thuliumStatus: lead.thuliumStatus,
            changedAt: lead.thuliumCreatedAt,
          },
        });
        historySeeded++;
      }
    }

    didBackfillLeadStatuses = true;
    console.log(
      `[Cron] ${ts()} Lead status backfill complete: ${updatedCount} remapped, ${historySeeded} history seeded`
    );
  } catch (err) {
    console.error(`[Cron] ${ts()} backfillLeadStatuses error:`, err);
  }
}

/**
 * Refreshes open leads older than THULIUM_LOOKBACK_DAYS so status transitions
 * happening after 7 days are still reflected in analytics.motolia.pl.
 */
async function refreshOpenThuliumLeads(): Promise<void> {
  if (!THULIUM_API_KEY) return;
  console.log(`[Cron] ${ts()} Refreshing open Thulium leads older than ${THULIUM_LOOKBACK_DAYS}d...`);

  try {
    const cutoff = new Date(Date.now() - THULIUM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const openLeads = await prisma.crmLead.findMany({
      where: {
        status: { in: ["NEW", "IN_PROGRESS", "OFFER"] },
        thuliumCreatedAt: { lt: cutoff },
      },
      orderBy: { thuliumUpdatedAt: "asc" },
      take: 200,
    });

    if (openLeads.length === 0) return;

    let refreshed = 0;
    for (const lead of openLeads) {
      try {
        const res = await fetchThulium(`/tickets/${lead.id}`);
        const ticket = res?.result || res;
        if (!ticket || (!ticket.ticket_id && !ticket.full_status_name)) continue;

        const thuliumStatusStr = ticket.full_status_name || lead.thuliumStatus;
        const newStatus = mapThuliumStatus(
          thuliumStatusStr,
          ticket.status_id,
          ticket.substatus_id
        );
        const thuliumUpdatedAt = ticket.updated_at
          ? parseWarsawDate(ticket.updated_at)
          : lead.thuliumUpdatedAt;

        await prisma.crmLead.update({
          where: { id: lead.id },
          data: {
            status: newStatus,
            thuliumStatus: thuliumStatusStr,
            agentName: ticket.user_login || lead.agentName,
            clientEmail: ticket.from || lead.clientEmail,
            queueName: ticket.ticket_queue_name || lead.queueName,
            subject: ticket.subject || lead.subject,
            thuliumUpdatedAt,
          },
        });

        if (lead.status !== newStatus) {
          await prisma.crmLeadStatusHistory.create({
            data: {
              leadId: lead.id,
              fromStatus: lead.status,
              toStatus: newStatus,
              thuliumStatus: thuliumStatusStr,
              changedAt: thuliumUpdatedAt,
            },
          });
        }
        refreshed++;
      } catch (ticketErr) {
        console.warn(`[Cron] ${ts()} Failed to refresh ticket ${lead.id}:`, ticketErr);
      }
    }

    console.log(`[Cron] ${ts()} Refreshed ${refreshed}/${openLeads.length} older open Thulium leads`);
  } catch (err) {
    console.error(`[Cron] ${ts()} refreshOpenThuliumLeads error:`, err);
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
  // Only "today" here — the longer windows barely move minute to minute and
  // are refreshed by the hourly cycle instead.
  await collectPeriodSummaries(["today"]);
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
  await collectDailyTrafficBackfill();
  await collectPeriodSummaries(PERIODS.filter((p) => p !== "today"));
  await backfillLeadStatuses();
  await refreshOpenThuliumLeads();
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

  cron.schedule(
    "30 6 * * *",
    async () => {
      try {
        console.log(`[Cron] ${ts()} Running scheduled morning report generation...`);
        const count = await runScheduledReportGeneration();
        console.log(`[Cron] ${ts()} Generated/updated ${count} report snapshots`);
      } catch (err) {
        console.error(`[Cron] ${ts()} Scheduled report generation failed:`, err);
      }
    },
    { timezone: "Europe/Warsaw" }
  );

  console.log(`[Cron] Running initial collection cycle...`);
  runCollectionCycle()
    .then(async () => {
      console.log(`[Cron] Initial collection cycle complete; running backfill...`);
      await collectDailySummary();
      await collectDailyTrafficBackfill();
      await backfillLeadStatuses();
      await refreshOpenThuliumLeads();
      const recentThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentSnapshot = await prisma.reportSnapshot.findFirst({
        where: { generatedAt: { gte: recentThreshold } },
        select: { id: true },
      });
      if (!recentSnapshot) {
        console.log(`[Cron] ${ts()} No recent report snapshot found; generating initial reports...`);
        try {
          await runScheduledReportGeneration();
        } catch (reportErr) {
          console.error(`[Cron] ${ts()} Initial report generation failed:`, reportErr);
        }
      }
      await invalidateCache();
    })
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
