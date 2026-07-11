const https = require('https');

const USERNAME = 'api_user_analytics';
const API_KEY = 'BgytA1KGyqU7225k2XJjhSkB7C1DEZBX3+9S1XlEmWs=';
const INSTANCE = 'motolia';

function requestEndpoint(path) {
  return new Promise((resolve) => {
    const url = `https://${INSTANCE}.thulium.com${path}`;
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    
    const req = https.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          path,
          status: res.statusCode,
          data: data.slice(0, 300) // limit length
        });
      });
    });
    
    req.on('error', (err) => {
      resolve({
        path,
        status: 'error',
        data: err.message
      });
    });
  });
}

async function main() {
  const paths = [
    '/api/v2/tickets',
    '/api/v2/calls',
    '/api/v2/campaigns',
    '/api/v2/customers',
    '/api/v2/users',
    '/api/tickets',
    '/api/calls',
    '/api/campaigns',
    '/api/customers',
    '/api/users',
  ];
  
  console.log('Testing Thulium endpoints...');
  for (const path of paths) {
    const res = await requestEndpoint(path);
    console.log(`Path: ${res.path} -> Status: ${res.status}`);
    if (res.status === 200) {
      console.log(`  Success! Response snippet: ${res.data}`);
    } else {
      console.log(`  Response: ${res.data}`);
    }
  }
}

main();
