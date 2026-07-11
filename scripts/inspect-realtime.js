const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function getWarsawNow() {
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
  const val = (name) => parseInt(parts.find(p => p.type === name)?.value || '0');
  
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

async function main() {
  console.log('--- timezone checks ---');
  const dbTimezone = await prisma.$queryRaw`SHOW timezone`;
  console.log('DB Timezone:', dbTimezone);

  console.log('--- current process times ---');
  console.log('Process local time:', new Date().toLocaleString());
  console.log('Process UTC time:', new Date().toISOString());
  console.log('getWarsawNow() clock digits as UTC:', getWarsawNow().toISOString());

  console.log('--- latest realtime snapshots ---');
  const snapshots = await prisma.realtimeSnapshot.findMany({
    orderBy: { capturedAt: 'desc' },
    take: 5
  });
  snapshots.forEach(s => {
    console.log(`Snapshot ID: ${s.id} | capturedAt (JS Date): ${s.capturedAt.toISOString()} | capturedAt (raw DB value/local JS representation): ${s.capturedAt.toString()}`);
  });

  console.log('--- latest tv schedule spots ---');
  const spots = await prisma.tvSchedule.findMany({
    orderBy: { airDate: 'desc' },
    take: 5
  });
  spots.forEach(s => {
    console.log(`Spot ID: ${s.id} | airDate (JS Date): ${s.airDate.toISOString()} | station: ${s.station}`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
