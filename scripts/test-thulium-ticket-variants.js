const https = require('https');

const USERNAME = 'api_user_analytics';
const API_KEY = process.env.THULIUM_API_KEY;
if (!API_KEY) { console.error('THULIUM_API_KEY env var is required'); process.exit(1); }
const INSTANCE = 'motolia';

function request(path, options = {}) {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    const url = `https://${INSTANCE}.thulium.com/api${path}`;
    
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
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({ error: err.message });
    });
    
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function main() {
  const baseTicket = {
    subject: 'Test Ticket from Antigravity',
    description: 'This is a test ticket description.',
    customer_id: 34
  };

  const variants = [
    { name: 'queue_id', payload: { ...baseTicket, queue_id: 3 } },
    { name: 'ticket_queue_id', payload: { ...baseTicket, ticket_queue_id: 3 } },
    { name: 'queue', payload: { ...baseTicket, queue: 'Oddzwonienie_WWW' } },
    { name: 'mailbox (string)', payload: { ...baseTicket, mailbox: 'kontakt@motolia.pl' } },
    { name: 'mailbox_name', payload: { ...baseTicket, mailbox_name: 'Oddzwonienie_WWW' } },
    { name: 'mailbox_id', payload: { ...baseTicket, mailbox_id: 3 } },
    { name: 'email_account', payload: { ...baseTicket, email_account: 'kontakt@motolia.pl' } },
    { name: 'email_account_id', payload: { ...baseTicket, email_account_id: 3 } }
  ];

  for (const variant of variants) {
    console.log(`--- Testing variant: ${variant.name} ---`);
    const res = await request('/tickets', {
      body: JSON.stringify(variant.payload)
    });
    console.log(`Status Code: ${res.status}`);
    console.log(`Response:`, JSON.stringify(res.body, null, 2));
  }
}

main();
