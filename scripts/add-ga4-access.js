/**
 * Add service account to GA4 via Admin API
 * Uses the service account's own credentials + domain-wide delegation
 * OR uses the Admin API with an access token from OAuth2 Playground
 * 
 * Since service account can't add itself, we use a workaround:
 * The GA4 Admin API accepts service accounts when called programmatically,
 * even though the UI doesn't.
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

const KEY_FILE = path.resolve(__dirname, '../../Documents/Coding/github/car-scout/docs_other/motolia-6b24d186ef5e.json');
const GA4_ACCOUNT_ID = '368056036';
const GA4_PROPERTY_ID = '504637386';
const SERVICE_ACCOUNT_EMAIL = 'ga4-dashboard@motolia.iam.gserviceaccount.com';

// OAuth2 client for user authentication
const SCOPES = ['https://www.googleapis.com/auth/analytics.manage.users'];

async function main() {
  console.log('=== GA4 Service Account Access Provisioner ===\n');
  
  // We need to authenticate as a user who has admin access to GA4
  // Create OAuth2 client using the GCP project credentials
  const keyData = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  
  // For this we need OAuth2 credentials (client_id, client_secret)
  // from the GCP project. Let's check if there are any.
  // Since we only have a service account key, we'll use a different approach:
  // Use the Google Auth library to create a JWT and call the API directly
  
  const { GoogleAuth } = require('google-auth-library');
  
  // First, let's try if the service account can call the Admin API
  // to list accounts (just to verify connectivity)
  const auth = new GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/analytics.manage.users',
             'https://www.googleapis.com/auth/analytics.edit',
             'https://www.googleapis.com/auth/analytics.readonly'],
  });
  
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  
  console.log('Service account authenticated successfully');
  console.log('Attempting to list GA4 account access...\n');
  
  // Try to list current users on the account
  try {
    const listRes = await client.request({
      url: `https://analyticsadmin.googleapis.com/v1alpha/accounts/${GA4_ACCOUNT_ID}/accessBindings`,
      method: 'GET',
    });
    console.log('Current access bindings:', JSON.stringify(listRes.data, null, 2));
  } catch (err) {
    console.log('Cannot list (expected if SA has no access yet):', err.message);
  }
  
  // Try to add the service account via the Admin API
  // This needs to be called by someone with admin access
  // If the SA doesn't have access, we need the user's OAuth token
  
  console.log('\n--- Alternative: Direct API call ---');
  console.log('Since the service account cannot add itself,');
  console.log('please run this curl command in your terminal:\n');
  
  // Get a user OAuth token via gcloud or OAuth playground
  console.log('Step 1: Get an OAuth token');
  console.log('   Go to: https://developers.google.com/oauthplayground/');
  console.log('   Select scope: Google Analytics Admin API v1alpha');
  console.log('   → https://www.googleapis.com/auth/analytics.manage.users');
  console.log('   Authorize with your kameel77seo@gmail.com account');
  console.log('   Click "Exchange authorization code for tokens"');
  console.log('   Copy the access_token\n');
  
  console.log('Step 2: Run this curl command with your token:\n');
  console.log(`curl -X POST \\
  'https://analyticsadmin.googleapis.com/v1alpha/accounts/${GA4_ACCOUNT_ID}/accessBindings' \\
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN_HERE' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "user": "${SERVICE_ACCOUNT_EMAIL}",
    "roles": ["predefinedRoles/viewer"]
  }'`);
  
  console.log('\n--- OR use property-level access: ---\n');
  console.log(`curl -X POST \\
  'https://analyticsadmin.googleapis.com/v1alpha/properties/${GA4_PROPERTY_ID}/accessBindings' \\
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN_HERE' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "user": "${SERVICE_ACCOUNT_EMAIL}",
    "roles": ["predefinedRoles/viewer"]
  }'`);
}

main().catch(console.error);
