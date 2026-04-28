require('dotenv').config();

async function main() {
  const base = process.env.SUPABASE_URL;
  const headers = {
    apikey: process.env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  };

  const urls = [
    `${base}/rest/v1/`,
    `${base}/rest/v1/tenants?select=id&limit=1`,
    `${base}/rest/v1/tenant_members?select=id&limit=1`,
  ];

  for (const url of urls) {
    const res = await fetch(url, { headers });
    const text = await res.text();
    console.log('URL:', url);
    console.log('STATUS:', res.status);
    console.log('BODY:', text.slice(0, 1000));
    console.log('---');
  }
}

main().catch((error) => {
  console.error('PROBE_ERROR', error);
  process.exit(1);
});
