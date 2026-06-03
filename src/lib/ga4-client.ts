import { BetaAnalyticsDataClient } from "@google-analytics/data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RealtimeActiveUsers {
  minutesAgo: string;
  activeUsers: number;
}

export interface RealtimeEventRow {
  eventName: string;
  eventCount: number;
}

export interface RealtimePageRow {
  pagePath: string;
  screenPageViews: number;
  activeUsers: number;
}

export interface RealtimeGeoRow {
  country: string;
  city: string;
  activeUsers: number;
}

export interface RealtimeDeviceRow {
  deviceCategory: string;
  activeUsers: number;
}

export interface RealtimeData {
  activeUsersByMinute: RealtimeActiveUsers[];
  events: RealtimeEventRow[];
  pages: RealtimePageRow[];
  geo: RealtimeGeoRow[];
  devices: RealtimeDeviceRow[];
  totalActiveUsers: number;
  totalEventCount: number;
  totalKeyEvents: number;
  totalScreenPageViews: number;
}

export interface TrafficBySourceRow {
  sessionSource: string;
  sessionMedium: string;
  sessions: number;
  totalUsers: number;
  newUsers: number;
  bounceRate: number;
  engagementRate: number;
  conversions: number;
}

export interface TrafficByHourRow {
  dateHour: string;
  sessions: number;
  totalUsers: number;
  conversions: number;
}

export interface TrafficByGeoRow {
  country: string;
  region: string;
  city: string;
  sessions: number;
  totalUsers: number;
  conversions: number;
}

export interface TrafficByDeviceRow {
  deviceCategory: string;
  sessions: number;
  totalUsers: number;
  bounceRate: number;
}

export interface TrafficByLandingPageRow {
  landingPage: string;
  sessions: number;
  totalUsers: number;
  bounceRate: number;
  conversions: number;
}

export interface ConversionRow {
  eventName: string;
  sessionSource: string;
  sessionMedium: string;
  eventCount: number;
}

export interface DailySummaryRow {
  date: string;
  sessions: number;
  totalUsers: number;
  newUsers: number;
  bounceRate: number;
  conversions: number;
  averageSessionDuration: number;
}

// ---------------------------------------------------------------------------
// Client initialization
// ---------------------------------------------------------------------------

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const GA_CLIENT_EMAIL = process.env.GA_CLIENT_EMAIL;
const GA_PRIVATE_KEY_RAW = process.env.GA_PRIVATE_KEY;

// Decode private key - it's stored as base64 to avoid .env parsing issues
function decodePrivateKey(): string {
  if (!GA_PRIVATE_KEY_RAW) return "";
  try {
    // Try base64 decode first
    const decoded = Buffer.from(GA_PRIVATE_KEY_RAW, "base64").toString("utf-8");
    if (decoded.includes("BEGIN PRIVATE KEY")) {
      return decoded;
    }
  } catch {
    // Not base64, use as-is
  }
  // Fallback: treat as regular escaped string
  return GA_PRIVATE_KEY_RAW.replace(/\\n/g, "\n");
}

if (!GA4_PROPERTY_ID) {
  console.warn("[GA4] GA4_PROPERTY_ID not set");
}

function createClient(): BetaAnalyticsDataClient {
  if (!GA_CLIENT_EMAIL || !GA_PRIVATE_KEY_RAW) {
    throw new Error(
      "[GA4] GA_CLIENT_EMAIL and GA_PRIVATE_KEY must be set"
    );
  }

  return new BetaAnalyticsDataClient({
    credentials: {
      client_email: GA_CLIENT_EMAIL,
      private_key: decodePrivateKey(),
    },
  });
}

let _client: BetaAnalyticsDataClient | null = null;

function getClient(): BetaAnalyticsDataClient {
  if (!_client) {
    _client = createClient();
  }
  return _client;
}

function getProperty(): string {
  if (!GA4_PROPERTY_ID) {
    throw new Error("[GA4] GA4_PROPERTY_ID is not set");
  }
  return `properties/${GA4_PROPERTY_ID}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeString(value: string | null | undefined): string {
  return value ?? "";
}

function safeNumber(value: string | null | undefined): number {
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// Realtime data
// ---------------------------------------------------------------------------

/**
 * Fetch realtime analytics data using multiple API calls for incompatible
 * dimension combinations.
 *
 * Available realtime dimensions:
 *   minutesAgo, city, country, countryId, deviceCategory, eventName,
 *   platform, streamId, streamName, unifiedScreenName
 *
 * Available realtime metrics:
 *   activeUsers, eventCount, keyEvents, screenPageViews
 */
export async function fetchRealtimeData(): Promise<RealtimeData> {
  const client = getClient();
  const property = getProperty();

  console.log("[GA4] Fetching realtime data...");

  try {
    // Call 1: Active users by minute
    const [byMinuteResponse] = await client.runRealtimeReport({
      property,
      dimensions: [{ name: "minutesAgo" }],
      metrics: [{ name: "activeUsers" }],
      returnPropertyQuota: true,
    });

    const activeUsersByMinute: RealtimeActiveUsers[] = (
      byMinuteResponse.rows || []
    ).map((row) => ({
      minutesAgo: safeString(row.dimensionValues?.[0]?.value),
      activeUsers: safeNumber(row.metricValues?.[0]?.value),
    }));

    // Call 2: Events breakdown
    const [eventsResponse] = await client.runRealtimeReport({
      property,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      returnPropertyQuota: true,
    });

    const events: RealtimeEventRow[] = (eventsResponse.rows || []).map(
      (row) => ({
        eventName: safeString(row.dimensionValues?.[0]?.value),
        eventCount: safeNumber(row.metricValues?.[0]?.value),
      })
    );

    // Call 3: Page views by screen/page
    const [pagesResponse] = await client.runRealtimeReport({
      property,
      dimensions: [{ name: "unifiedScreenName" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "activeUsers" },
      ],
      returnPropertyQuota: true,
    });

    const pages: RealtimePageRow[] = (pagesResponse.rows || []).map(
      (row) => ({
        pagePath: safeString(row.dimensionValues?.[0]?.value),
        screenPageViews: safeNumber(row.metricValues?.[0]?.value),
        activeUsers: safeNumber(row.metricValues?.[1]?.value),
      })
    );

    // Call 4: Geo breakdown (country + city)
    const [geoResponse] = await client.runRealtimeReport({
      property,
      dimensions: [{ name: "country" }, { name: "city" }],
      metrics: [{ name: "activeUsers" }],
      returnPropertyQuota: true,
    });

    const geo: RealtimeGeoRow[] = (geoResponse.rows || []).map((row) => ({
      country: safeString(row.dimensionValues?.[0]?.value),
      city: safeString(row.dimensionValues?.[1]?.value),
      activeUsers: safeNumber(row.metricValues?.[0]?.value),
    }));

    // Call 5: Device breakdown
    const [deviceResponse] = await client.runRealtimeReport({
      property,
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "activeUsers" }],
      returnPropertyQuota: true,
    });

    const devices: RealtimeDeviceRow[] = (deviceResponse.rows || []).map(
      (row) => ({
        deviceCategory: safeString(row.dimensionValues?.[0]?.value),
        activeUsers: safeNumber(row.metricValues?.[0]?.value),
      })
    );

    // Call 6: Totals (no dimensions)
    const [totalsResponse] = await client.runRealtimeReport({
      property,
      metrics: [
        { name: "activeUsers" },
        { name: "eventCount" },
        { name: "keyEvents" },
        { name: "screenPageViews" },
      ],
      returnPropertyQuota: true,
    });

    const totalsRow = totalsResponse.rows?.[0];

    // Log quota usage from last response
    if (totalsResponse.propertyQuota) {
      const quota = totalsResponse.propertyQuota;
      console.log(
        `[GA4] Realtime quota — tokensPerDay: ${quota.tokensPerDay?.consumed}/${quota.tokensPerDay?.remaining}, tokensPerHour: ${quota.tokensPerHour?.consumed}/${quota.tokensPerHour?.remaining}`
      );
    }

    const result: RealtimeData = {
      activeUsersByMinute,
      events,
      pages,
      geo,
      devices,
      totalActiveUsers: safeNumber(totalsRow?.metricValues?.[0]?.value),
      totalEventCount: safeNumber(totalsRow?.metricValues?.[1]?.value),
      totalKeyEvents: safeNumber(totalsRow?.metricValues?.[2]?.value),
      totalScreenPageViews: safeNumber(totalsRow?.metricValues?.[3]?.value),
    };

    console.log(
      `[GA4] Realtime: ${result.totalActiveUsers} active users, ${result.totalEventCount} events`
    );

    return result;
  } catch (err) {
    console.error("[GA4] fetchRealtimeData error:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Daily reports
// ---------------------------------------------------------------------------

/**
 * Traffic broken down by source/medium for a given date (YYYY-MM-DD).
 */
export async function fetchDailyTrafficBySource(
  date: string
): Promise<TrafficBySourceRow[]> {
  const client = getClient();
  const property = getProperty();

  console.log(`[GA4] Fetching traffic by source for ${date}...`);

  try {
    const [response] = await client.runReport({
      property,
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [
        { name: "sessionSource" },
        { name: "sessionMedium" },
      ],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "newUsers" },
        { name: "bounceRate" },
        { name: "engagementRate" },
        { name: "conversions" },
      ],
      returnPropertyQuota: true,
    });

    return (response.rows || []).map((row) => ({
      sessionSource: safeString(row.dimensionValues?.[0]?.value),
      sessionMedium: safeString(row.dimensionValues?.[1]?.value),
      sessions: safeNumber(row.metricValues?.[0]?.value),
      totalUsers: safeNumber(row.metricValues?.[1]?.value),
      newUsers: safeNumber(row.metricValues?.[2]?.value),
      bounceRate: safeNumber(row.metricValues?.[3]?.value),
      engagementRate: safeNumber(row.metricValues?.[4]?.value),
      conversions: safeNumber(row.metricValues?.[5]?.value),
    }));
  } catch (err) {
    console.error("[GA4] fetchDailyTrafficBySource error:", err);
    throw err;
  }
}

/**
 * Traffic broken down by hour for a given date (YYYY-MM-DD).
 */
export async function fetchDailyTrafficByHour(
  date: string
): Promise<TrafficByHourRow[]> {
  const client = getClient();
  const property = getProperty();

  console.log(`[GA4] Fetching traffic by hour and minute for ${date}...`);

  try {
    const [response] = await client.runReport({
      property,
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [{ name: "dateHourMinute" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "conversions" },
      ],
      returnPropertyQuota: true,
    });

    const aggregated = new Map<string, { sessions: number; totalUsers: number; conversions: number }>();
    
    for (const row of response.rows || []) {
      const dateHourMinute = safeString(row.dimensionValues?.[0]?.value); // "YYYYMMDDHHMM"
      if (dateHourMinute.length < 12) continue;
      
      const dateHour = dateHourMinute.slice(0, 10); // "YYYYMMDDHH"
      const minuteVal = parseInt(dateHourMinute.slice(10, 12), 10);
      const roundedMinute = minuteVal < 30 ? "00" : "30";
      const key = `${dateHour}${roundedMinute}`;
      
      const sessions = safeNumber(row.metricValues?.[0]?.value);
      const totalUsers = safeNumber(row.metricValues?.[1]?.value);
      const conversions = safeNumber(row.metricValues?.[2]?.value);
      
      const existing = aggregated.get(key);
      if (existing) {
        existing.sessions += sessions;
        existing.totalUsers += totalUsers;
        existing.conversions += conversions;
      } else {
        aggregated.set(key, { sessions, totalUsers, conversions });
      }
    }

    return Array.from(aggregated.entries()).map(([key, val]) => ({
      dateHour: key,
      sessions: val.sessions,
      totalUsers: val.totalUsers,
      conversions: val.conversions,
    }));
  } catch (err) {
    console.error("[GA4] fetchDailyTrafficByHour error:", err);
    throw err;
  }
}

/**
 * Traffic broken down by geography for a given date (YYYY-MM-DD).
 */
export async function fetchDailyTrafficByGeo(
  date: string
): Promise<TrafficByGeoRow[]> {
  const client = getClient();
  const property = getProperty();

  console.log(`[GA4] Fetching traffic by geo for ${date}...`);

  try {
    const [response] = await client.runReport({
      property,
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [
        { name: "country" },
        { name: "region" },
        { name: "city" },
      ],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "conversions" },
      ],
      returnPropertyQuota: true,
    });

    return (response.rows || []).map((row) => ({
      country: safeString(row.dimensionValues?.[0]?.value),
      region: safeString(row.dimensionValues?.[1]?.value),
      city: safeString(row.dimensionValues?.[2]?.value),
      sessions: safeNumber(row.metricValues?.[0]?.value),
      totalUsers: safeNumber(row.metricValues?.[1]?.value),
      conversions: safeNumber(row.metricValues?.[2]?.value),
    }));
  } catch (err) {
    console.error("[GA4] fetchDailyTrafficByGeo error:", err);
    throw err;
  }
}

/**
 * Traffic broken down by device category for a given date (YYYY-MM-DD).
 */
export async function fetchDailyTrafficByDevice(
  date: string
): Promise<TrafficByDeviceRow[]> {
  const client = getClient();
  const property = getProperty();

  console.log(`[GA4] Fetching traffic by device for ${date}...`);

  try {
    const [response] = await client.runReport({
      property,
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [{ name: "deviceCategory" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "bounceRate" },
      ],
      returnPropertyQuota: true,
    });

    return (response.rows || []).map((row) => ({
      deviceCategory: safeString(row.dimensionValues?.[0]?.value),
      sessions: safeNumber(row.metricValues?.[0]?.value),
      totalUsers: safeNumber(row.metricValues?.[1]?.value),
      bounceRate: safeNumber(row.metricValues?.[2]?.value),
    }));
  } catch (err) {
    console.error("[GA4] fetchDailyTrafficByDevice error:", err);
    throw err;
  }
}

/**
 * Traffic broken down by landing page for a given date (YYYY-MM-DD).
 */
export async function fetchDailyTrafficByLandingPage(
  date: string
): Promise<TrafficByLandingPageRow[]> {
  const client = getClient();
  const property = getProperty();

  console.log(`[GA4] Fetching traffic by landing page for ${date}...`);

  try {
    const [response] = await client.runReport({
      property,
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [{ name: "landingPagePlusQueryString" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "bounceRate" },
        { name: "conversions" },
      ],
      returnPropertyQuota: true,
    });

    return (response.rows || []).map((row) => ({
      landingPage: safeString(row.dimensionValues?.[0]?.value),
      sessions: safeNumber(row.metricValues?.[0]?.value),
      totalUsers: safeNumber(row.metricValues?.[1]?.value),
      bounceRate: safeNumber(row.metricValues?.[2]?.value),
      conversions: safeNumber(row.metricValues?.[3]?.value),
    }));
  } catch (err) {
    console.error("[GA4] fetchDailyTrafficByLandingPage error:", err);
    throw err;
  }
}

/**
 * Conversion events (form_submission, phone_call_click) for a given date.
 */
export async function fetchDailyConversions(
  date: string
): Promise<ConversionRow[]> {
  const client = getClient();
  const property = getProperty();

  console.log(`[GA4] Fetching conversions for ${date}...`);

  try {
    const [response] = await client.runReport({
      property,
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [
        { name: "eventName" },
        { name: "sessionSource" },
        { name: "sessionMedium" },
      ],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: {
            values: ["form_submission", "phone_call_click", "generate_lead"],
          },
        },
      },
      returnPropertyQuota: true,
    });

    return (response.rows || []).map((row) => ({
      eventName: safeString(row.dimensionValues?.[0]?.value),
      sessionSource: safeString(row.dimensionValues?.[1]?.value),
      sessionMedium: safeString(row.dimensionValues?.[2]?.value),
      eventCount: safeNumber(row.metricValues?.[0]?.value),
    }));
  } catch (err) {
    console.error("[GA4] fetchDailyConversions error:", err);
    throw err;
  }
}

/**
 * Daily summary across a date range. Returns one row per date.
 */
export async function fetchDailySummary(
  startDate: string,
  endDate: string
): Promise<DailySummaryRow[]> {
  const client = getClient();
  const property = getProperty();

  console.log(`[GA4] Fetching daily summary ${startDate} → ${endDate}...`);

  try {
    const [response] = await client.runReport({
      property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "newUsers" },
        { name: "bounceRate" },
        { name: "conversions" },
        { name: "averageSessionDuration" },
      ],
      orderBys: [{ dimension: { dimensionName: "date", orderType: "ALPHANUMERIC" } }],
      returnPropertyQuota: true,
    });

    if (response.propertyQuota) {
      const quota = response.propertyQuota;
      console.log(
        `[GA4] Report quota — tokensPerDay: ${quota.tokensPerDay?.consumed}/${quota.tokensPerDay?.remaining}, tokensPerHour: ${quota.tokensPerHour?.consumed}/${quota.tokensPerHour?.remaining}`
      );
    }

    return (response.rows || []).map((row) => ({
      date: safeString(row.dimensionValues?.[0]?.value),
      sessions: safeNumber(row.metricValues?.[0]?.value),
      totalUsers: safeNumber(row.metricValues?.[1]?.value),
      newUsers: safeNumber(row.metricValues?.[2]?.value),
      bounceRate: safeNumber(row.metricValues?.[3]?.value),
      conversions: safeNumber(row.metricValues?.[4]?.value),
      averageSessionDuration: safeNumber(row.metricValues?.[5]?.value),
    }));
  } catch (err) {
    console.error("[GA4] fetchDailySummary error:", err);
    throw err;
  }
}
