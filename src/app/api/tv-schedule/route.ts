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
  const [day, month, year] = dateStr.split('.');
  const [hours, minutes, seconds] = timeStr.split(':');
  return new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hours),
    parseInt(minutes),
    parseInt(seconds || '0')
  );
}

function parseSpotLength(lengthStr: string): number {
  return parseInt(lengthStr.replace(/[^0-9]/g, '')) || 0;
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

    const records: CsvRow[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      delimiter: ';',
      trim: true,
      bom: true,
    });

    if (records.length === 0) {
      return NextResponse.json({ error: 'CSV file is empty' }, { status: 400 });
    }

    const uniqueDates = new Set<string>();
    const rows = records.map((row) => {
      const airDate = parseDate(row.Data, row['Godzina planowana']);
      uniqueDates.add(row.Data);
      return {
        zlecenie: row.Zlecenie,
        station: row.Stacja,
        airDate,
        program: row.Program,
        product: row.Produkt,
        spotLength: parseSpotLength(row['Długość']),
        pasmo: row.Pasmo,
        spotVersion: row.Wersja,
      };
    });

    if (overwrite) {
      for (const dateStr of uniqueDates) {
        const [day, month, year] = dateStr.split('.');
        const dayStart = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        const dayEnd = new Date(parseInt(year), parseInt(month) - 1, parseInt(day) + 1);

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
