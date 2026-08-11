const https = require('https');
const fs = require('fs');

const USERNAME = 'api_user_analytics';
const API_KEY = process.env.THULIUM_API_KEY;
if (!API_KEY) { console.error('THULIUM_API_KEY env var is required'); process.exit(1); }
const INSTANCE = 'motolia';

function fetchDocs() {
  return new Promise((resolve, reject) => {
    const url = `https://${INSTANCE}.thulium.com/docs/api`;
    const auth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
    
    console.log(`Fetching docs from ${url}...`);
    
    const req = https.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`Docs status:`, res.statusCode);
        resolve(data);
      });
    });
    
    req.on('error', reject);
  });
}

async function main() {
  try {
    const html = await fetchDocs();
    console.log(`Fetched docs size: ${html.length} bytes`);
    
    // Look for mentions of "calls", "history", "records", "phone" etc.
    const matches = [];
    const regex = /href="([^"]+)"|id="([^"]+)"|class="([^"]+)"|(\/api\/[a-zA-Z0-9_\-\/]+)/g;
    
    let match;
    const seen = new Set();
    while ((match = regex.exec(html)) !== null) {
      const path = match[4] || match[1];
      if (path && path.includes('/api/') && !seen.has(path)) {
        seen.add(path);
        matches.push(path);
      }
    }
    
    console.log('\nFound API paths in documentation HTML:');
    matches.forEach(m => console.log(`- ${m}`));
    
    // Also save the HTML to a scratch file so we can view it if needed
    fs.writeFileSync('/Users/kamiltonkowicz/Documents/Coding/github/ga-analytics/scripts/docs.html', html);
    console.log('\nSaved docs to scripts/docs.html');
    
  } catch (err) {
    console.error('Error fetching docs:', err);
  }
}

main();
