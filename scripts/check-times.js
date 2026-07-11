const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const fs = require('fs');

const KEY_FILE = '/Users/kamiltonkowicz/Documents/Coding/github/car-scout/docs_other/motolia-6b24d186ef5e.json';
const PROPERTY_ID = '504637386';

async function main() {
  const keyData = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const client = new BetaAnalyticsDataClient({
    credentials: {
      client_email: keyData.client_email,
      private_key: keyData.private_key,
    },
  });

  const property = `properties/${PROPERTY_ID}`;

  console.log('Current Warsaw Time:', new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }));
  console.log('Current UTC Time:   ', new Date().toISOString());

  try {
    // 1. Fetch from Realtime API (active users by minute)
    const [realtimeResponse] = await client.runRealtimeReport({
      property,
      dimensions: [{ name: 'minutesAgo' }],
      metrics: [{ name: 'activeUsers' }],
    });

    console.log('\n--- REALTIME ACTIVE USERS ---');
    const rtRows = realtimeResponse.rows || [];
    rtRows.slice(0, 5).forEach(row => {
      console.log(`minutesAgo: ${row.dimensionValues[0].value} | activeUsers: ${row.metricValues[0].value}`);
    });

    // 2. Fetch today's hourly report from standard API
    const [reportResponse] = await client.runReport({
      property,
      dateRanges: [{ startDate: 'today', endDate: 'today' }],
      dimensions: [{ name: 'dateHourMinute' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'dateHourMinute', orderType: 'ALPHANUMERIC' } }],
    });

    console.log('\n--- REPORT API LATEST COMPLED MINUTE ---');
    const reportRows = reportResponse.rows || [];
    if (reportRows.length > 0) {
      const latestRow = reportRows[reportRows.length - 1];
      console.log(`Latest dateHourMinute: ${latestRow.dimensionValues[0].value} | sessions: ${latestRow.metricValues[0].value}`);
      
      // Let's print the last 10 rows to see the progression
      console.log('\nLast 10 completed minutes in GA4:');
      reportRows.slice(-10).forEach(row => {
        console.log(`dateHourMinute: ${row.dimensionValues[0].value} | sessions: ${row.metricValues[0].value}`);
      });
    } else {
      console.log('No rows returned for today.');
    }

  } catch (err) {
    console.error('Error running check-times:', err);
  }
}

main();
