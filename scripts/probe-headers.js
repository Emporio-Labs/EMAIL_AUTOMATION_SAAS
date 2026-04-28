require('dotenv').config();

async function tryRequest(label, headers) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/tenants?select=id&limit=1`, { headers });
  const text = await res.text();
  console.log('LABEL:', label);
  console.log('STATUS:', res.status);
  console.log('BODY:', text.slice(0, 500));
  console.log('---');
}

async function main() {
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  await tryRequest('apikey anon only', { apikey: anon });
  await tryRequest('apikey service only', { apikey: service });
  await tryRequest('apikey anon + bearer anon', { apikey: anon, Authorization: `Bearer ${anon}` });
  await tryRequest('apikey service + bearer service', { apikey: service, Authorization: `Bearer ${service}` });
}

main().catch((error) => {
  console.error('PROBE_ERROR', error);
  process.exit(1);
});
