-- Seed data for local/dev testing
-- Safe to run multiple times: inserts use fixed UUIDs with ON CONFLICT DO NOTHING.

-- Mock tenant and membership context
insert into tenants (id, name, slug, owner_user_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'Mock Tenant',
  'mock-tenant',
  '22222222-2222-2222-2222-222222222222'
)
on conflict (id) do nothing;

insert into tenant_members (id, tenant_id, user_id, role)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'owner'
)
on conflict (tenant_id, user_id) do nothing;

-- Mock audience
insert into contacts (id, tenant_id, email, first_name, last_name)
values
  (
    '44444444-4444-4444-4444-444444444441',
    '11111111-1111-1111-1111-111111111111',
    'sagunvarma25@gmail.com',
    'Sagun',
    'Varma'
  ),
  (
    '44444444-4444-4444-4444-444444444442',
    '11111111-1111-1111-1111-111111111111',
    'yeshwanthdandu2003@gmail.com',
    'Yeshwanth',
    'Dandu'
  )
on conflict (tenant_id, email) do nothing;

insert into lists (id, tenant_id, name, description)
values (
  '55555555-5555-5555-5555-555555555555',
  '11111111-1111-1111-1111-111111111111',
  'Mock Recipients',
  'Seeded test list with 2 recipients'
)
on conflict (id) do nothing;

insert into list_contacts (list_id, contact_id)
values
  (
    '55555555-5555-5555-5555-555555555555',
    '44444444-4444-4444-4444-444444444441'
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    '44444444-4444-4444-4444-444444444442'
  )
on conflict (list_id, contact_id) do nothing;

-- Optional sample queued jobs for UI/testing visibility
insert into email_jobs (
  job_id,
  tenant_id,
  contact_id,
  list_id,
  from_email,
  to_email,
  subject,
  html,
  status,
  sqs_message_id
)
values
  (
    '66666666-6666-6666-6666-666666666661',
    '11111111-1111-1111-1111-111111111111',
    '44444444-4444-4444-4444-444444444441',
    '55555555-5555-5555-5555-555555555555',
    'no-reply@fitflix.in',
    'sagunvarma25@gmail.com',
    'Seeded: Welcome to SwayamMail',
    '<p>Hello Sagun, this is seeded mock data.</p>',
    'queued',
    null
  ),
  (
    '66666666-6666-6666-6666-666666666662',
    '11111111-1111-1111-1111-111111111111',
    '44444444-4444-4444-4444-444444444442',
    '55555555-5555-5555-5555-555555555555',
    'no-reply@fitflix.in',
    'yeshwanthdandu2003@gmail.com',
    'Seeded: Welcome to SwayamMail',
    '<p>Hello Yeshwanth, this is seeded mock data.</p>',
    'queued',
    null
  )
on conflict (job_id) do nothing;
