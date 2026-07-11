const https = require('https');

const USERNAME = 'api_user_analytics';
const API_KEY = 'BgytA1KGyqU7225k2XJjhSkB7C1DEZBX3+9S1XlEmWs=';
const INSTANCE = 'motolia';

function fetchDocs(path = '/docs/api') {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    const url = `https://${INSTANCE}.thulium.com${path}`;
    
    https.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const html = await fetchDocs();
  const hrefRegex = /href="\/docs\/api\/([^"]+)"/g;
  let match;
  const links = [];
  while ((match = hrefRegex.exec(html)) !== null) {
    links.push(`/docs/api/${match[1]}`);
  }
  
  // Find all post tickets links
  const createTicketLinks = [...new Set(links)].filter(link => 
    link.includes('tickets') && (link.includes('post') || link.includes('create'))
  );
  
  console.log('Ticket creation doc links:', createTicketLinks);

  for (const link of createTicketLinks) {
    if (link.includes('_id')) continue; // skip nested operations on a ticket ID (like comments)
    
    console.log(`\n=================== Fetching ${link} ===================`);
    const pageHtml = await fetchDocs(link);
    
    // Print the parameters section or description table
    const bodyText = pageHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    console.log(`Text snippet:`, bodyText.substring(0, 1500));
    
    // Print all <pre> blocks
    const preRegex = /<pre[\s\S]*?<\/pre>/gi;
    let preMatch;
    while ((preMatch = preRegex.exec(pageHtml)) !== null) {
      console.log(`Code Block:\n`, preMatch[0].replace(/<[^>]*>/g, '').trim());
    }
  }
}

main();
