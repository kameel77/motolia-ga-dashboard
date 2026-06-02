import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache, redis } from '@/lib/redis';
import { parse } from 'csv-parse/sync';

interface CsvRow {
  Klient: string;
  'Typ sprzedaży': string;
  Zlecenie: string;
  Stacja: string;
  Data: string;
  'Godzina planowana': string;
  Program: string;
  'Typ bloku': string;
  Produkt: string;
  Długość: string;
  Pasmo: string;
  Blok: string;
  Wersja: string;
  'Nr kasety': string;
}

function parseDate(dateStr: string, timeStr: string): Date {
  if (!dateStr || !timeStr) {
    return new Date();
  }
  const [day, month, year] = dateStr.split('.');
  const [hours, minutes, seconds] = timeStr.split(':');
  return new Date(Date.UTC(
    parseInt(year) || new Date().getFullYear(),
    (parseInt(month) || 1) - 1,
    parseInt(day) || 1,
    parseInt(hours) || 0,
    parseInt(minutes) || 0,
    parseInt(seconds || '0') || 0
  ));
}

function parseSpotLength(lengthStr: string): number {
  if (!lengthStr) return 0;
  return parseInt(lengthStr.replace(/[^0-9]/g, '')) || 0;
}

function getRowValue(row: any, ...keys: string[]): string {
  // Try exact match first
  for (const k of keys) {
    if (row[k] !== undefined) return row[k];
  }
  
  // Try case-insensitive, trimmed, and normalized match
  const rowKeys = Object.keys(row);
  for (const k of keys) {
    const normK = k.toLowerCase().trim();
    for (const rk of rowKeys) {
      const normRk = rk.toLowerCase().trim();
      if (normRk === normK) return row[rk];
      
      // Handle potential encoding issues with Polish characters by comparing prefixes/suffixes
      if (normK === 'długość' && (normRk.includes('dł') || normRk.includes('dl') || normRk.includes('ug'))) {
        return row[rk];
      }
      if (normK === 'typ sprzedaży' && (normRk.includes('sprzed') || normRk.includes('sprz'))) {
        return row[rk];
      }
      if (normK === 'godzina planowana' && (normRk.includes('godzin') || normRk.includes('plan'))) {
        return row[rk];
      }
    }
  }
  return '';
}

export async function POST(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const overwrite = formData.get('overwrite') !== 'false';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const csvContent = await file.text();
    const firstLine = csvContent.split('\n')[0] || '';
    const delimiter = firstLine.includes(';') ? ';' : ',';

    const records: any[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      delimiter,
      trim: true,
      bom: true,
    });

    if (records.length === 0) {
      return NextResponse.json({ error: 'CSV file is empty' }, { status: 400 });
    }

    const uniqueDates = new Set<string>();
    const rows = records.map((row) => {
      const dateVal = getRowValue(row, 'Data', 'date');
      const timeVal = getRowValue(row, 'Godzina planowana', 'time');
      const airDate = parseDate(dateVal, timeVal);
      if (dateVal) {
        uniqueDates.add(dateVal);
      }
      
      return {
        zlecenie: getRowValue(row, 'Zlecenie', 'zlecenie'),
        station: getRowValue(row, 'Stacja', 'station'),
        airDate,
        program: getRowValue(row, 'Program', 'program'),
        product: getRowValue(row, 'Produkt', 'product'),
        spotLength: parseSpotLength(getRowValue(row, 'Długość', 'duration')),
        pasmo: getRowValue(row, 'Pasmo', 'pasmo'),
        spotVersion: getRowValue(row, 'Wersja', 'version'),
      };
    });

    if (overwrite) {
      for (const dateStr of uniqueDates) {
        const [day, month, year] = dateStr.split('.');
        const dayStart = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0));
        const dayEnd = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day) + 1, 0, 0, 0));

        await prisma.tvSchedule.deleteMany({
          where: {
            airDate: { gte: dayStart, lt: dayEnd },
          },
        });
      }
    }

    await prisma.tvSchedule.createMany({
      data: rows,
    });

    // Save import log to database
    await prisma.importLog.create({
      data: {
        filename: file.name || 'imported_file.csv',
        recordCount: rows.length,
        mode: overwrite ? 'overwrite' : 'add',
      },
    });

    for (const dateStr of uniqueDates) {
      const [day, month, year] = dateStr.split('.');
      const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      if (redis) {
        await redis.del(`tv-overlay:${isoDate}`);
      }
    }

    if (redis) {
      await redis.del('tv-schedule:list');
    }

    return NextResponse.json({ success: true, imported: rows.length });
  } catch (err) {
    console.error('TV schedule import error:', err);
    return NextResponse.json(
      { error: 'Failed to parse CSV file' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cacheKey = 'tv-schedule:list';
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const entries = await prisma.tvSchedule.findMany({
    orderBy: { airDate: 'desc' },
    take: 100,
  });

  const logs = await prisma.importLog.findMany({
    orderBy: { importedAt: 'desc' },
    take: 10,
  });

  const data = { entries, logs };

  await setCache(cacheKey, data, 10); // low TTL for admin freshness

  return NextResponse.json(data);
}
