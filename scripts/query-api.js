const https = require('https');

const TOKEN = 'd461aecd0db541f8b113fc8bffcef23b';
const DATE = '2026-06-03';

function fetchUrl(url, cookie) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Cookie': `auth_token=${cookie}`
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log(`Fetching TV overlay for ${DATE}...`);
    const tvData = await fetchUrl(`https://analytics.motolia.pl/api/tv-overlay?date=${DATE}`, TOKEN);
    console.log('TV Spots:', JSON.stringify(tvData, null, 2));

    console.log(`\nFetching hourly data for ${DATE}...`);
    const hourlyData = await fetchUrl(`https://analytics.motolia.pl/api/hourly?date=${DATE}`, TOKEN);
    console.log('Hourly Data Points count:', hourlyData.points?.length);
    
    // Print points that are not 0
    console.log('Non-zero hourly points:');
    hourlyData.points?.forEach(p => {
      if (p.sessions > 0 || p.conversions > 0) {
        console.log(`${p.label} -> sessions: ${p.sessions}, conversions: ${p.conversions}, yesterday: ${p.sessionsYesterday}, weekAgo: ${p.sessionsWeekAgo}`);
      }
    });

  } catch (err) {
    console.error('Error fetching API:', err);
  }
}

main();
