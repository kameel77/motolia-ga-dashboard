const https = require('https');

const USERNAME = 'api_user_analytics';
const API_KEY = process.env.THULIUM_API_KEY;
if (!API_KEY) { console.error('THULIUM_API_KEY env var is required'); process.exit(1); }
const INSTANCE = 'motolia';

function getTickets() {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    const req = https.get(`https://${INSTANCE}.thulium.com/api/tickets`, {
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
          resolve({});
        }
      });
    });
  });
}

async function main() {
  const response = await getTickets();
  const tickets = response.result || [];
  console.log(`Fetched ${tickets.length} tickets.`);
  
  // Print values of 'from' and see if there are other email-related fields like 'to' or 'email' or 'mailbox'
  const emailTickets = tickets.filter(t => t.source === 'email');
  console.log(`Found ${emailTickets.length} email tickets.`);
  
  if (emailTickets.length > 0) {
    console.log('Sample email ticket fields:', Object.keys(emailTickets[0]));
    emailTickets.slice(0, 5).forEach((t, i) => {
      console.log(`Ticket ${t.ticket_id}:`);
      console.log(`  From: ${t.from}`);
      console.log(`  Subject: ${t.subject}`);
      console.log(`  Queue Name: ${t.ticket_queue_name}`);
      console.log(`  Queue ID: ${t.ticket_queue_id}`);
    });
  } else {
    console.log('No email tickets found in sample.');
    // Let's print fields of any tickets
    if (tickets.length > 0) {
      console.log('Sample ticket fields:', Object.keys(tickets[0]));
      tickets.slice(0, 5).forEach(t => {
        console.log(`Ticket ${t.ticket_id}: Source=${t.source}, From=${t.from}, Queue=${t.ticket_queue_name}`);
      });
    }
  }
}

main();
