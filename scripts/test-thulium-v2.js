const https = require('https');

const USERNAME = 'api_user_analytics';
const API_KEY = 'BgytA1KGyqU7225k2XJjhSkB7C1DEZBX3+9S1XlEmWs=';
const INSTANCE = 'motolia';

function getQueues() {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    const req = https.get(`https://${INSTANCE}.thulium.com/api/queues`, {
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
          resolve([]);
        }
      });
    });
  });
}

async function main() {
  const queues = await getQueues();
  console.log('Available queues:', JSON.stringify(queues, null, 2));
}

main();
