/**
 * Shared utility functions and types for the analytics dashboard.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TvScheduleRow {
  klient: string;
  typSprzedazy: string;
  zlecenie: string;
  stacja: string;
  data: Date;
  godzinaPlanowana: Date;
  program: string;
  typBloku: string;
  produkt: string;
  dlugoscSekund: number;
  pasmo: string;
  blok: string;
  wersja: string;
  nrKasety: string;
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

/**
 * Format a number with thousands separators (e.g. 1,234).
 */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Format a number as a percentage (e.g. 45.2%).
 */
export function formatPercent(n: number): string {
  // GA4 returns rates as decimals (0.452 = 45.2%)
  const pct = n > 1 ? n : n * 100;
  return `${pct.toFixed(1)}%`;
}

/**
 * Format seconds as mm:ss (e.g. 125 → "2:05").
 */
export function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Get current date/time in Europe/Warsaw timezone represented directly in a Date object as UTC clock digits.
 * This ensures that UTC queries matching this date align exactly with Warsaw local calendar boundaries.
 */
export function getWarsawNow(): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(new Date());
  const val = (name: string) => parseInt(parts.find(p => p.type === name)?.value || '0');
  
  const hour = val('hour');
  return new Date(Date.UTC(
    val('year'),
    val('month') - 1,
    val('day'),
    hour === 24 ? 0 : hour,
    val('minute'),
    val('second')
  ));
}

/**
 * Get YYYY-MM-DD date string in Europe/Warsaw timezone.
 */
export function getWarsawDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Convert a period string into a start Date.
 * Supported values: 'today', '7d', '30d', '90d'.
 */
export function getStartDateForPeriod(period: string): Date {
  const now = getWarsawNow();
  now.setUTCHours(0, 0, 0, 0);

  switch (period) {
    case "today":
      return now;
    case "7d": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 7);
      return d;
    }
    case "30d": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 30);
      return d;
    }
    case "90d": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 90);
      return d;
    }
    default:
      throw new Error(`Unknown period: "${period}". Use today|7d|30d|90d`);
  }
}

// ---------------------------------------------------------------------------
// TV schedule CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single CSV row from the TV schedule format.
 *
 * Expected columns:
 *   Klient, Typ sprzedaży, Zlecenie, Stacja, Data, Godzina planowana,
 *   Program, Typ bloku, Produkt, Długość, Pasmo, Blok, Wersja, Nr kasety
 *
 * - 'Data' is DD.MM.YYYY → parsed to Date
 * - 'Godzina planowana' is HH:mm:ss → combined with Data into a full Date
 * - 'Długość' is e.g. "39'" → parsed to integer seconds
 */
export function parseTvCsvRow(
  row: Record<string, string>
): TvScheduleRow {
  // Parse date: DD.MM.YYYY
  const dateParts = (row["Data"] || "").split(".");
  if (dateParts.length !== 3) {
    throw new Error(`Invalid date format: "${row["Data"]}" (expected DD.MM.YYYY)`);
  }
  const [day, month, year] = dateParts.map(Number);
  const dateOnly = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));

  // Parse time: HH:mm:ss and combine with date
  const timeParts = (row["Godzina planowana"] || "").split(":");
  if (timeParts.length < 2) {
    throw new Error(
      `Invalid time format: "${row["Godzina planowana"]}" (expected HH:mm:ss)`
    );
  }
  const [hours, minutes, seconds] = timeParts.map(Number);
  const fullDateTime = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds || 0));

  // Parse duration: e.g. "39'" → 39 seconds
  const dlugoscRaw = (row["Długość"] || "").replace(/'/g, "").trim();
  const dlugoscSekund = parseInt(dlugoscRaw, 10);
  if (isNaN(dlugoscSekund)) {
    throw new Error(`Invalid duration: "${row["Długość"]}" (expected number with optional ')`);
  }

  return {
    klient: row["Klient"] || "",
    typSprzedazy: row["Typ sprzedaży"] || "",
    zlecenie: row["Zlecenie"] || "",
    stacja: row["Stacja"] || "",
    data: dateOnly,
    godzinaPlanowana: fullDateTime,
    program: row["Program"] || "",
    typBloku: row["Typ bloku"] || "",
    produkt: row["Produkt"] || "",
    dlugoscSekund,
    pasmo: row["Pasmo"] || "",
    blok: row["Blok"] || "",
    wersja: row["Wersja"] || "",
    nrKasety: row["Nr kasety"] || "",
  };
}
