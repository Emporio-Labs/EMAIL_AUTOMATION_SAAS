create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  owner_user_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table if not exists lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists list_contacts (
  list_id uuid not null references lists(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, contact_id)
);

create table if not exists email_jobs (
  job_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  list_id uuid references lists(id) on delete set null,
  from_email text not null,
  to_email text not null,
  subject text not null,
  html text not null,
  status text not null default 'queued',
  sqs_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  failure_reason text
);

create table if not exists suppressed (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create index if not exists idx_tenant_members_user_id on tenant_members(user_id);
create index if not exists idx_lists_tenant_id on lists(tenant_id);
create index if not exists idx_contacts_tenant_id on contacts(tenant_id);
create index if not exists idx_list_contacts_list_id on list_contacts(list_id);
create index if not exists idx_email_jobs_tenant_id on email_jobs(tenant_id);