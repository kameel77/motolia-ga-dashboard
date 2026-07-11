const https = require('https');

const USERNAME = 'api_user_analytics';
const API_KEY = 'BgytA1KGyqU7225k2XJjhSkB7C1DEZBX3+9S1XlEmWs=';
const INSTANCE = 'motolia';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    const url = `https://${INSTANCE}.thulium.com/api${path}`;
    console.log(`Testing POST ${url}...`);
    
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      ...options
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`Status Code: ${res.statusCode}`);
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function main() {
  // Test ticket creation with 'to' field
  const res = await request('/tickets', {
    body: JSON.stringify({
      to: 'kontakt@motolia.pl',
      from: 'test.sender@example.com',
      subject: 'Test Ticket from Antigravity with TO',
      body: 'This is a test ticket description using the correct v1 fields (to, subject, body).',
      customer_id: 34,
      source: 'www'
    })
  });
  console.log('Ticket Result:', JSON.stringify(res.body, null, 2));
}

main();
