const https = require('https');

const USERNAME = 'api_user_analytics';
const API_KEY = process.env.THULIUM_API_KEY;
if (!API_KEY) { console.error('THULIUM_API_KEY env var is required'); process.exit(1); }
const INSTANCE = 'motolia';

function fetchUrl(url, method = 'GET') {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    console.log(`${method} ${url}...`);
    
    const req = https.request(url, {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'text/html,application/json,application/xhtml+xml'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`Status for ${url}: ${res.statusCode}`);
        console.log(`Headers:`, JSON.stringify(res.headers, null, 2));
        console.log(`Body snippet:`, data.substring(0, 1000));
        resolve(res.statusCode);
      });
    });
    
    req.on('error', (err) => {
      console.log(`Error: ${err.message}`);
      resolve(null);
    });
    
    req.end();
  });
}

async function main() {
  await fetchUrl(`https://${INSTANCE}.thulium.com/docs/api`);
  await fetchUrl(`https://${INSTANCE}.thulium.com/api/docs`);
  await fetchUrl(`https://${INSTANCE}.thulium.com/api/help`);
}

main();
