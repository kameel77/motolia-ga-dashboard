const https = require('https');

const USERNAME = 'api_user_analytics';
const API_KEY = 'BgytA1KGyqU7225k2XJjhSkB7C1DEZBX3+9S1XlEmWs=';
const INSTANCE = 'motolia'; // Assuming 'motolia' based on workspace and domain

function testThuliumAPI(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `https://${INSTANCE}.thulium.com/api/${endpoint}`;
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    
    console.log(`Testing GET ${url}...`);
    
    const req = https.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`Status Code for /${endpoint}:`, res.statusCode);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`API returned status ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  try {
    const tickets = await testThuliumAPI('tickets');
    console.log('Tickets Response keys:', Object.keys(tickets));
    if (tickets.result && tickets.result.length > 0) {
      console.log('Sample ticket:', JSON.stringify(tickets.result[0], null, 2));
    } else {
      console.log('No tickets returned or empty result array.');
    }
  } catch (err) {
    console.error('Failed tickets test:', err.message);
  }

  try {
    const connections = await testThuliumAPI('connections');
    console.log('Connections Response keys:', Object.keys(connections));
    if (connections.result && connections.result.length > 0) {
      console.log('Sample connection:', JSON.stringify(connections.result[0], null, 2));
    } else {
      console.log('No connections returned or empty result array.');
    }
  } catch (err) {
    console.error('Failed connections test:', err.message);
  }
}

main();
