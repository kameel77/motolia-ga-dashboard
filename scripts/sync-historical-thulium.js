const https = require('https');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

const USERNAME = process.env.THULIUM_USERNAME || 'api_user_analytics';
const API_KEY = process.env.THULIUM_API_KEY || 'BgytA1KGyqU7225k2XJjhSkB7C1DEZBX3+9S1XlEmWs=';
const INSTANCE = process.env.THULIUM_INSTANCE || 'motolia';

function parseWarsawDate(dateStr) {
  if (!dateStr) return new Date();
  const isoStr = dateStr.replace(" ", "T");
  if (isoStr.includes("Z") || isoStr.includes("+") || (isoStr.includes("-") && isoStr.split("-").length > 3)) {
    return new Date(dateStr);
  }
  
  const dateObj = new Date(isoStr + "Z");
  try {
    const tzString = dateObj.toLocaleString("en-US", { timeZone: "Europe/Warsaw" });
    const localDate = new Date(tzString);
    const diffMs = localDate.getTime() - dateObj.getTime();
    return new Date(new Date(isoStr + "Z").getTime() - diffMs);
  } catch (e) {
    const month = dateObj.getUTCMonth() + 1;
    const offset = (month >= 4 && month <= 10) ? "+02:00" : "+01:00";
    return new Date(isoStr + offset);
  }
}

function request(path) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    const url = `https://${INSTANCE}.thulium.com/api${path}`;
    
    https.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`API returned status ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

// Map Thulium status names to ga-analytics CrmLeadStatus
function mapStatus(statusName) {
  if (!statusName) return 'NEW';
  const s = statusName.toLowerCase();
  if (s.includes('nowy')) return 'NEW';
  if (s.includes('otwarty') || s.includes('kontakt') || s.includes('proces') || s.includes('bieżąc')) return 'IN_PROGRESS';
  if (s.includes('zamkni') || s.includes('zamknięty') || s.includes('wygran') || s.includes('sukces')) return 'WON';
  if (s.includes('odrzucon') || s.includes('przegran') || s.includes('lost') || s.includes('spam') || s.includes('anulowan')) return 'LOST';
  return 'NEW';
}

// Map Thulium source to CrmLeadSource
function mapSource(sourceStr) {
  if (!sourceStr) return 'WEB_FORM';
  const s = sourceStr.toLowerCase();
  if (s.includes('phone') || s.includes('telefon') || s.includes('call')) return 'PHONE';
  if (s.includes('email') || s.includes('mail')) return 'EMAIL';
  return 'WEB_FORM';
}

// Extract rich details from ticket body/comments using regex
function extractDetails(ticket) {
  let text = '';
  if (ticket.messages && ticket.messages.length > 0) {
    ticket.messages.forEach(msg => {
      text += '\n' + (msg.body || '') + '\n' + (msg.comment || '') + '\n' + (msg.system_comment || '');
    });
  }

  // Regexes for car details and marketing attribution
  const priceMatch = text.match(/(?:Cena|Cena \(PLN\)|Wartość|Kwota)\s*:\s*([\d\s]+)/i);
  const urlMatch = text.match(/(?:Link do ogłoszenia|URL|Adres)\s*:\s*(https?:\/\/[^\s]+)/i);
  const referrerMatch = text.match(/(?:Referrer|Źródło)\s*:\s*([^\s\n\r]+)/i);
  
  // UTMs
  const utmSourceMatch = text.match(/utm_source\s*:\s*([^\s\n\r]+)/i);
  const utmMediumMatch = text.match(/utm_medium\s*:\s*([^\s\n\r]+)/i);
  const utmCampaignMatch = text.match(/utm_campaign\s*:\s*([^\s\n\r]+)/i);

  let value = 0;
  if (priceMatch) {
    value = parseFloat(priceMatch[1].replace(/\s/g, '')) || 0;
  }

  return {
    value,
    url: urlMatch ? urlMatch[1] : null,
    referrer: referrerMatch ? referrerMatch[1] : null,
    utmSource: utmSourceMatch ? utmSourceMatch[1] : null,
    utmMedium: utmMediumMatch ? utmMediumMatch[1] : null,
    utmCampaign: utmCampaignMatch ? utmCampaignMatch[1] : null,
  };
}

async function main() {
  console.log('=== STARTING HISTORICAL THULIUM SYNC ===');
  console.log(`Connecting to instance: ${INSTANCE}`);

  try {
    // 1. Fetch all customers to populate lookup map (speeds up name & contact extraction)
    console.log('Fetching customers lookup...');
    const rawCustomers = await request('/customers?limit=2000');
    const customersList = Array.isArray(rawCustomers) ? rawCustomers : (rawCustomers.result || rawCustomers.data || []);
    const customerMap = new Map();
    
    customersList.forEach(c => {
      customerMap.set(String(c.customer_id), {
        name: `${c.name || ''} ${c.surname || ''}`.trim() || 'Klient Anonimowy',
        phone: c.phone_number || c.phone || null,
        email: c.email || (c.emails && c.emails[0]) || null,
      });
    });
    console.log(`Loaded ${customerMap.size} customers into memory.`);

    // 2. Fetch and import connections (calls)
    console.log('\nFetching historical connections...');
    let callOffset = 0;
    const callLimit = 100;
    let callsImported = 0;
    let finishedCalls = false;

    while (!finishedCalls) {
      console.log(`Fetching connections offset ${callOffset}...`);
      const res = await request(`/connections?limit=${callLimit}&offset=${callOffset}`);
      const calls = res.result || [];
      
      if (calls.length === 0) {
        finishedCalls = true;
        break;
      }

      for (const call of calls) {
        const timestamp = parseWarsawDate(call.date);
        if (isNaN(timestamp.getTime())) continue;

        // Upsert CrmCall
        await prisma.crmCall.upsert({
          where: { id: String(call.connection_id) },
          create: {
            id: String(call.connection_id),
            phone: call.src,
            direction: call.type || 'INBOUND',
            disposition: call.disposition,
            duration: parseInt(call.duration) || 0,
            billsec: parseInt(call.billsec) || 0,
            agentName: call.user_login || null,
            queueName: call.queue_id ? String(call.queue_id) : null,
            timestamp,
          },
          update: {
            disposition: call.disposition,
            duration: parseInt(call.duration) || 0,
            billsec: parseInt(call.billsec) || 0,
            agentName: call.user_login || null,
            timestamp,
          }
        });

        // Record answered call conversion
        if (call.disposition === 'ANSWERED') {
          const capturedAt = new Date(timestamp);
          capturedAt.setUTCSeconds(0, 0);
          capturedAt.setUTCMinutes(capturedAt.getUTCMinutes() < 30 ? 0 : 30);

          const dateHour = `${capturedAt.getUTCFullYear()}${String(capturedAt.getUTCMonth() + 1).padStart(2, '0')}${String(capturedAt.getUTCDate()).padStart(2, '0')}${String(capturedAt.getUTCHours()).padStart(2, '0')}${capturedAt.getUTCMinutes() < 30 ? '00' : '30'}`;

          const trafficRow = await prisma.trafficByHour.findFirst({ where: { dateHour } });
          if (trafficRow) {
            await prisma.trafficByHour.update({
              where: { id: trafficRow.id },
              data: { conversions: { increment: 1 } }
            });
          }

          // Check if ConversionEvent already exists for this exact call connection to prevent double counting
          const existingConv = await prisma.conversionEvent.findFirst({
            where: {
              capturedAt,
              eventName: 'phone_call',
              source: 'crm_connector'
            }
          });

          if (!existingConv) {
            await prisma.conversionEvent.create({
              data: {
                capturedAt,
                eventName: 'phone_call',
                source: 'crm_connector',
                medium: 'phone',
                count: 1
              }
            });
          }
        }
        callsImported++;
      }

      callOffset += callLimit;
    }
    console.log(`Imported/Updated ${callsImported} connections.`);

    // 3. Fetch and import tickets (leads)
    console.log('\nFetching historical tickets...');
    let ticketOffset = 0;
    const ticketLimit = 100;
    let ticketsImported = 0;
    let finishedTickets = false;

    while (!finishedTickets) {
      console.log(`Fetching tickets offset ${ticketOffset}...`);
      const res = await request(`/tickets?limit=${ticketLimit}&offset=${ticketOffset}`);
      const tickets = res.result || [];

      if (tickets.length === 0) {
        finishedTickets = true;
        break;
      }

      for (const ticket of tickets) {
        const thuliumCreatedAt = parseWarsawDate(ticket.created_at);
        const thuliumUpdatedAt = parseWarsawDate(ticket.updated_at);
        if (isNaN(thuliumCreatedAt.getTime())) continue;

        // Lookup customer info
        const cust = customerMap.get(String(ticket.customer_id)) || {
          name: 'Klient Anonimowy',
          phone: null,
          email: ticket.from || null,
        };

        const details = extractDetails(ticket);
        const sourceVal = mapSource(ticket.source);
        const statusVal = mapStatus(ticket.full_status_name);

        // Check if lead already exists in DB
        const existingLead = await prisma.crmLead.findUnique({
          where: { id: String(ticket.ticket_id) }
        });

        // Upsert CrmLead
        await prisma.crmLead.upsert({
          where: { id: String(ticket.ticket_id) },
          create: {
            id: String(ticket.ticket_id),
            clientName: cust.name,
            clientEmail: cust.email || ticket.from || null,
            clientPhone: cust.phone || null,
            source: sourceVal,
            status: statusVal,
            thuliumStatus: ticket.full_status_name || 'Nowy',
            queueName: ticket.ticket_queue_name || null,
            subject: ticket.subject || null,
            agentName: ticket.user_login || null,
            value: details.value,
            url: details.url,
            referrer: details.referrer,
            utmSource: details.utmSource,
            utmMedium: details.utmMedium,
            utmCampaign: details.utmCampaign,
            thuliumCreatedAt,
            thuliumUpdatedAt,
          },
          update: {
            status: statusVal,
            thuliumStatus: ticket.full_status_name || 'Nowy',
            agentName: ticket.user_login || null,
            thuliumCreatedAt,
            thuliumUpdatedAt,
            value: details.value > 0 ? details.value : undefined, // update value if found
          }
        });

        // Record conversion for new lead
        if (!existingLead) {
          const capturedAt = new Date(thuliumCreatedAt);
          capturedAt.setUTCSeconds(0, 0);
          capturedAt.setUTCMinutes(capturedAt.getUTCMinutes() < 30 ? 0 : 30);

          const dateHour = `${capturedAt.getUTCFullYear()}${String(capturedAt.getUTCMonth() + 1).padStart(2, '0')}${String(capturedAt.getUTCDate()).padStart(2, '0')}${String(capturedAt.getUTCHours()).padStart(2, '0')}${capturedAt.getUTCMinutes() < 30 ? '00' : '30'}`;
          const eventName = sourceVal === 'PHONE' ? 'phone_call' : 'form_submission';

          // Increment TrafficByHour
          const trafficRow = await prisma.trafficByHour.findFirst({ where: { dateHour } });
          if (trafficRow) {
            await prisma.trafficByHour.update({
              where: { id: trafficRow.id },
              data: { conversions: { increment: 1 } }
            });
          }

          // Check if ConversionEvent exists
          const existingConv = await prisma.conversionEvent.findFirst({
            where: {
              capturedAt,
              eventName,
              source: details.utmSource || 'crm_connector'
            }
          });

          if (!existingConv) {
            await prisma.conversionEvent.create({
              data: {
                capturedAt,
                eventName,
                source: details.utmSource || 'crm_connector',
                medium: details.utmMedium || (sourceVal === 'PHONE' ? 'phone' : 'web'),
                count: 1
              }
            });
          }
        }
        ticketsImported++;
      }

      ticketOffset += ticketLimit;
    }
    console.log(`Imported/Updated ${ticketsImported} tickets.`);
    console.log('\n=== HISTORICAL SYNC COMPLETE SUCCESS ===');

  } catch (err) {
    console.error('Fatal sync error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
