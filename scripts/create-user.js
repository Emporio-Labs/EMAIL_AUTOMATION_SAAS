require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }
  return process.argv[index + 1];
}

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  const tenantId = getArg('--tenant-id');
  const role = getArg('--role') ?? 'member';

  if (!email || !password) {
    console.error('Usage: node scripts/create-user.js <email> <password> [--tenant-id <uuid>] [--role <role>]');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    console.error('CREATE_USER_ERROR', error?.message || 'Unknown error');
    process.exit(1);
  }

  console.log('User created:', { id: data.user.id, email: data.user.email });

  if (tenantId) {
    const { error: memberError } = await supabaseAdmin.from('tenant_members').insert({
      tenant_id: tenantId,
      user_id: data.user.id,
      role,
    });

    if (memberError) {
      console.error('TENANT_MEMBER_ERROR', memberError.message);
      process.exit(1);
    }

    console.log('Tenant membership created:', { tenantId, userId: data.user.id, role });
  }
}

main().catch((error) => {
  console.error('SCRIPT_ERROR', error?.message || error);
  process.exit(1);
});
