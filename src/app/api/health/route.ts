import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getWarsawNow } from '@/lib/utils';

export async function GET() {
  try {
    const tzResult = await prisma.$queryRaw<any[]>`SHOW TIMEZONE`;
    const timezone = tzResult[0]?.TimeZone || tzResult[0]?.timezone || 'unknown';

    const latestSpots = await prisma.tvSchedule.findMany({
      orderBy: { airDate: 'desc' },
      take: 5,
    });

    const spotsInfo = latestSpots.map(s => ({
      id: s.id,
      station: s.station,
      program: s.program,
      airDateISO: s.airDate.toISOString(),
      airDateRaw: s.airDate,
    }));

    return NextResponse.json({
      status: 'ok',
      systemTime: new Date().toISOString(),
      getWarsawNow: getWarsawNow().toISOString(),
      databaseTimezone: timezone,
      latestSpots: spotsInfo,
    });
  } catch (err: any) {
    return NextResponse.json({
      status: 'error',
      message: err.message,
      stack: err.stack,
    }, { status: 500 });
  }
}

