const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const fs = require('fs');

const KEY_FILE = '/Users/kamiltonkowicz/Documents/Coding/github/car-scout/docs_other/motolia-6b24d186ef5e.json';
const PROPERTY_ID = '504637386';
const DATE_STR = '2026-05-26'; // YYYY-MM-DD

async function main() {
  const keyData = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const client = new BetaAnalyticsDataClient({
    credentials: {
      client_email: keyData.client_email,
      private_key: keyData.private_key,
    },
  });

  const property = `properties/${PROPERTY_ID}`;

  try {
    // 1. Fetch hourly report from GA4 for May 26th
    const [reportResponse] = await client.runReport({
      property,
      dateRanges: [{ startDate: DATE_STR, endDate: DATE_STR }],
      dimensions: [{ name: 'dateHourMinute' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'dateHourMinute', orderType: 'ALPHANUMERIC' } }],
    });

    const hourlySessions = new Map();
    for (const row of reportResponse.rows || []) {
      const dateHourMinute = row.dimensionValues[0].value; // "YYYYMMDDHHMM"
      const hour = dateHourMinute.slice(8, 10);
      const minute = dateHourMinute.slice(10, 12);
      const roundedMinute = parseInt(minute, 10) < 30 ? '00' : '30';
      const key = `${hour}:${roundedMinute}`;
      const sessions = parseInt(row.metricValues[0].value, 10);
      hourlySessions.set(key, (hourlySessions.get(key) || 0) + sessions);
    }

    // 2. Parse TV spots for May 26th from CSV
    const csvContent = fs.readFileSync('/Users/kamiltonkowicz/Downloads/motolia-lista-emisji-202605.csv', 'utf8');
    const lines = csvContent.split('\n');
    const spots = [];
    
    // Header check
    const headers = lines[0].split(',');
    
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = lines[i].split(',');
      // Columns: Klient,Typ sprzedaży,Zlecenie,Stacja,Data,Godzina planowana,Program,Typ bloku,Produkt,Długość,Pasmo,Blok,Wersja,Nr kasety
      // e.g. Telewizja Niezależna S.A.,Cennik,0403959/26/A3/ŁP,TV Republika,26.05.2026,09:00:00
      const date = row[4];
      const time = row[5];
      const station = row[3];
      const program = row[6];
      
      if (date === '26.05.2026') {
        const [h, m, s] = time.split(':');
        spots.push({
          time: `${h}:${m}`,
          station,
          program
        });
      }
    }

    console.log(`=== ALIGNMENT CHECK FOR ${DATE_STR} ===`);
    console.log('TV spots for the day:');
    spots.forEach(s => {
      console.log(`- TV Spot at ${s.time} | Station: ${s.station} | Program: ${s.program}`);
    });

    console.log('\nGA4 Sessions vs TV Spots per 30-minute interval:');
    for (let h = 0; h < 24; h++) {
      for (const m of ['00', '30']) {
        const key = `${h.toString().padStart(2, '0')}:${m}`;
        const sessions = hourlySessions.get(key) || 0;
        
        // Find TV spots in this 30-minute interval
        const matchingSpots = spots.filter(s => {
          const [sh, sm] = s.time.split(':');
          const spotMin = parseInt(sm, 10);
          const intervalMin = parseInt(m, 10);
          return parseInt(sh, 10) === h && spotMin >= intervalMin && spotMin < intervalMin + 30;
        });

        const spotIndicator = matchingSpots.length > 0 
          ? `<<< TV SPOT(S) AT: ${matchingSpots.map(s => s.time).join(', ')} (${matchingSpots.map(s => s.program).join(', ')})`
          : '';
        
        console.log(`${key} : ${sessions.toString().padStart(3, ' ')} sessions ${spotIndicator}`);
      }
    }

  } catch (err) {
    console.error('Error running alignment check:', err);
  }
}

main();
