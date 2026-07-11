const https = require('https');

const USERNAME = 'api_user_analytics';
const API_KEY = 'BgytA1KGyqU7225k2XJjhSkB7C1DEZBX3+9S1XlEmWs=';
const INSTANCE = 'motolia';

function request(path) {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    const url = `https://${INSTANCE}.thulium.com/api${path}`;
    console.log(`GET ${url}...`);
    
    https.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'JSON parse error' });
        }
      });
    }).on('error', (err) => {
      resolve({ error: err.message });
    });
  });
}

async function main() {
  // Test offset
  const res1 = await request('/tickets?limit=3');
  const res2 = await request('/tickets?limit=3&offset=3');
  
  if (res1.result && res2.result) {
    console.log('Limit 3 first ID:', res1.result[0].ticket_id);
    console.log('Limit 3 + Offset 3 first ID:', res2.result[0].ticket_id);
  } else {
    console.log('Failed to fetch results');
  }

  // Test page parameter under filter
  const resFilterPage = await request('/tickets?limit=3&filter[page]=2');
  if (resFilterPage.result && resFilterPage.result.length > 0) {
    console.log('Filter page 2 first ID:', resFilterPage.result[0].ticket_id);
  }
}

main();
