const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const fs = require('fs');
const path = require('path');

const KEY_FILE = '/Users/kamiltonkowicz/Documents/Coding/github/car-scout/docs_other/motolia-6b24d186ef5e.json';
const PROPERTY_ID = '504637386';

async function main() {
  console.log('=== GA4 API Query for June 3rd ===');
  
  const keyData = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  
  const client = new BetaAnalyticsDataClient({
    credentials: {
      client_email: keyData.client_email,
      private_key: keyData.private_key,
    },
  });

  const property = `properties/${PROPERTY_ID}`;
  
  try {
    const [response] = await client.runReport({
      property,
      dateRanges: [{ startDate: 'today', endDate: 'today' }],
      dimensions: [{ name: 'dateHourMinute' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'dateHourMinute' } }],
    });

    const rows = response.rows || [];
    console.log(`Total rows returned: ${rows.length}`);

    const aggregated = new Map();
    for (const row of rows) {
      const dateHourMinute = row.dimensionValues[0].value; // "YYYYMMDDHHMM"
      if (dateHourMinute.length < 12) continue;
      
      const hourMinute = dateHourMinute.slice(8, 12); // "HHMM"
      const hour = hourMinute.slice(0, 2);
      const minuteVal = parseInt(hourMinute.slice(2, 4), 10);
      const roundedMinute = minuteVal < 30 ? "00" : "30";
      const key = `${hour}:${roundedMinute}`;
      
      const sessions = parseInt(row.metricValues[0].value, 10);
      aggregated.set(key, (aggregated.get(key) || 0) + sessions);
    }

    console.log('\n--- AGGREGATED 30-MIN INTERVALS FOR TODAY ---');
    const sortedIntervals = Array.from(aggregated.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    sortedIntervals.forEach(([interval, sessions]) => {
      console.log(`${interval} : ${sessions} sessions`);
    });

  } catch (err) {
    console.error('Error running report:', err);
  }
}

main();
