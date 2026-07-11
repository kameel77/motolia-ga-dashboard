const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== DATABASE TRAFFIC BY HOUR FOR TODAY ===');
  
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const todayPrefix = `${year}${month}${day}`;
  
  console.log(`Searching for prefix: ${todayPrefix}`);
  
  const rows = await prisma.trafficByHour.findMany({
    where: {
      dateHour: {
        startsWith: todayPrefix
      }
    },
    orderBy: {
      capturedAt: 'desc'
    }
  });

  console.log(`Total rows in DB: ${rows.length}`);
  
  // Print unique dateHours with their capturedAt
  const seen = new Set();
  const uniqueRows = [];
  for (const row of rows) {
    if (!seen.has(row.dateHour)) {
      seen.add(row.dateHour);
      uniqueRows.push(row);
    }
  }
  
  uniqueRows.sort((a, b) => a.dateHour.localeCompare(b.dateHour));
  
  uniqueRows.forEach(row => {
    console.log(`dateHour: ${row.dateHour} | sessions: ${row.sessions} | conversions: ${row.conversions} | capturedAt: ${row.capturedAt.toISOString()}`);
  });
  
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
