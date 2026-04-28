require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const pub = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const testEmail = `apitest.${Date.now()}@example.com`;
  const password = 'Test@12345678';
  const seededTenantId = '11111111-1111-1111-1111-111111111111';

  const created = await admin.auth.admin.createUser({
    email: testEmail,
    password,
    email_confirm: true,
  });

  if (created.error || !created.data.user) {
    throw new Error(`createUser failed: ${created.error?.message || 'unknown'}`);
  }

  const userId = created.data.user.id;

  const memberUpsert = await admin.from('tenant_members').upsert(
    {
      tenant_id: seededTenantId,
      user_id: userId,
      role: 'owner',
    },
    { onConflict: 'tenant_id,user_id' }
  );

  if (memberUpsert.error) {
    throw new Error(`tenant_members upsert failed: ${memberUpsert.error.message}`);
  }

  const signIn = await pub.auth.signInWithPassword({ email: testEmail, password });
  if (signIn.error || !signIn.data.session?.access_token) {
    throw new Error(`signIn failed: ${signIn.error?.message || 'no token'}`);
  }

  const token = signIn.data.session.access_token;

  async function call(name, url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();
    let body;

    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return { name, status: res.status, ok: res.ok, body };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const results = [];
  results.push(await call('health', 'http://localhost:3000/health'));
  results.push(await call('auth_me', 'http://localhost:3000/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } }));
  results.push(await call('contacts_get', 'http://localhost:3000/v1/contacts', { headers }));
  results.push(await call('lists_get', 'http://localhost:3000/v1/lists', { headers }));
  results.push(
    await call('send_post', 'http://localhost:3000/v1/send', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subject: `Live API Test ${new Date().toISOString()}`,
        html: '<p>This is a live API test email trigger from backend test.</p>',
        toEmails: ['sagunvarma25@gmail.com', 'yeshwanthdandu2003@gmail.com'],
      }),
    })
  );

  console.log(
    JSON.stringify(
      {
        testUser: testEmail,
        userId,
        tenantId: seededTenantId,
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('API_TEST_ERROR', error);
  process.exit(1);
});
