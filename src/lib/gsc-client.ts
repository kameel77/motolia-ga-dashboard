import { google } from "googleapis";

function getAuth() {
  const email = process.env.GA_CLIENT_EMAIL;
  let key = process.env.GA_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error("Missing GA_CLIENT_EMAIL or GA_PRIVATE_KEY for GSC auth");
  }
  
  if (key.includes("\\n")) {
    key = key.replace(/\\n/g, "\n");
  }

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
}

export async function fetchGscData(siteUrl: string, startDate: string, endDate: string) {
  const auth = getAuth();
  const searchconsole = google.searchconsole({ version: "v1", auth });
  
  const response = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["page", "query"],
      rowLimit: 1000,
    },
  });

  return response.data.rows || [];
}
