-- Shared core for every product in the suite (Swayam Mail, Whatomation, AI worker).
--
-- Additive only. public.tenants stays the organisation table (core calls it
-- org_id) and public.tenant_members stays the membership table. No existing
-- table, trigger or route is changed by this migration.
--
-- The schema is not exposed through PostgREST; only the service role uses it.

create extension if not exists pgcrypto;

create schema if not exists core;

revoke all on schema core from public, anon, authenticated;
grant usage on schema core to service_role;

-- Which products an organisation has switched on. A product sold on its own
-- is simply an org with one row here.
create table if not exists core.org_products (
  org_id      uuid not null references public.tenants(id) on delete cascade,
  product     text not null,
  plan        text not null default 'starter',
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, product),
  constraint org_products_product_check check (product in ('mail', 'whatsapp', 'ai')),
  constraint org_products_status_check check (status in ('trial', 'active', 'suspended', 'cancelled'))
);

-- Filled once per business, read by email footers, the WhatsApp bot persona
-- and every AI skill.
create table if not exists core.business_profiles (
  org_id         uuid primary key references public.tenants(id) on delete cascade,
  business_name  text null,
  description    text null,   -- what the business does and sells
  industry       text null,
  website        text null,
  email          text null,
  phone          text null,
  address        text null,
  timezone       text not null default 'Asia/Kolkata',
  languages      text[] not null default array['en'],
  tone           text null,   -- e.g. 'friendly', 'formal'
  hours          jsonb null,  -- { "mon": [["09:00","18:00"]], ... }
  logo_url       text null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One person, reachable by email and/or WhatsApp. Backfilled mail contacts keep
-- their public.contacts id so the two can be joined until mail reads from here.
create table if not exists core.contacts (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.tenants(id) on delete cascade,
  email               text null,
  phone               text null,  -- E.164, e.g. +919812345678
  first_name          text null,
  last_name           text null,
  attributes          jsonb not null default '{}'::jsonb,
  tags                text[] not null default '{}',
  email_status        text not null default 'subscribed',
  whatsapp_opt_in     boolean not null default false,
  whatsapp_opt_in_at  timestamptz null,
  source              text not null default 'mail',  -- product that created it
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint contacts_reachable_check check (email is not null or phone is not null),
  constraint contacts_phone_e164_check check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint contacts_email_status_check check (email_status in ('subscribed', 'unsubscribed', 'suppressed'))
);

create unique index if not exists idx_core_contacts_org_email
  on core.contacts(org_id, email) where email is not null;
create unique index if not exists idx_core_contacts_org_phone
  on core.contacts(org_id, phone) where phone is not null;
create index if not exists idx_core_contacts_org_created
  on core.contacts(org_id, created_at desc);

-- Outbox for the shared event envelope. Products write here in the same
-- transaction as the change; a relay delivers to webhooks and internal
-- listeners and stamps published_at.
create table if not exists core.events (
  id            text primary key default ('evt_' || replace(gen_random_uuid()::text, '-', '')),
  org_id        uuid not null references public.tenants(id) on delete cascade,
  product       text not null,
  type          text not null,  -- product.object.action (or object.action for core), e.g. whatsapp.message.received
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  published_at  timestamptz null,
  constraint events_product_check check (product in ('core', 'mail', 'whatsapp', 'ai', 'billing')),
  constraint events_type_check check (type ~ '^[a-z_]+(\.[a-z_]+){1,2}$')
);

create index if not exists idx_core_events_org_created on core.events(org_id, created_at desc);
create index if not exists idx_core_events_unpublished on core.events(created_at) where published_at is null;

-- Swayam Mail's current webhook names keep working as aliases of the shared names.
create table if not exists core.event_type_aliases (
  alias  text primary key,
  type   text not null
);

insert into core.event_type_aliases (alias, type) values
  ('email.sent',       'email.message.sent'),
  ('email.delivered',  'email.message.delivered'),
  ('email.opened',     'email.message.read'),
  ('email.clicked',    'email.message.clicked'),
  ('email.bounced',    'email.message.failed'),
  ('email.failed',     'email.message.failed'),
  ('email.complained', 'email.message.complained')
on conflict (alias) do nothing;

-- One row per billable unit. Billing reads only this table. source_id makes
-- writes idempotent (e.g. the email job id or WhatsApp conversation id).
create table if not exists core.usage_records (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.tenants(id) on delete cascade,
  product      text not null,
  meter        text not null,  -- e.g. email.sent, whatsapp.conversation, ai.tokens
  quantity     bigint not null,
  source_id    text not null,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint usage_records_product_check check (product in ('mail', 'whatsapp', 'ai')),
  constraint usage_records_quantity_check check (quantity > 0),
  unique (org_id, meter, source_id)
);

create index if not exists idx_core_usage_org_occurred on core.usage_records(org_id, occurred_at desc);

alter table core.org_products       enable row level security;
alter table core.business_profiles  enable row level security;
alter table core.contacts           enable row level security;
alter table core.events             enable row level security;
alter table core.event_type_aliases enable row level security;
alter table core.usage_records      enable row level security;

grant all on all tables in schema core to service_role;
grant all on all sequences in schema core to service_role;

-- Write one event to the outbox and return its id.
create or replace function core.emit_event(p_org_id uuid, p_product text, p_type text, p_data jsonb default '{}'::jsonb)
returns text
language sql
set search_path = ''
as $$
  insert into core.events (org_id, product, type, data)
  values (p_org_id, p_product, p_type, coalesce(p_data, '{}'::jsonb))
  returning id;
$$;

-- Record usage once per (org, meter, source_id); repeats are ignored.
create or replace function core.record_usage(
  p_org_id uuid, p_product text, p_meter text, p_quantity bigint, p_source_id text,
  p_occurred_at timestamptz default now()
)
returns void
language sql
set search_path = ''
as $$
  insert into core.usage_records (org_id, product, meter, quantity, source_id, occurred_at)
  values (p_org_id, p_product, p_meter, p_quantity, p_source_id, p_occurred_at)
  on conflict (org_id, meter, source_id) do nothing;
$$;

-- Copy Swayam Mail's tenants and contacts into core. Safe to run again: rows
-- that already exist in core are left as they are.
create or replace function core.sync_from_mail()
returns void
language sql
set search_path = ''
as $$
  insert into core.org_products (org_id, product, plan, status)
  select t.id, 'mail', coalesce(t.plan, 'starter'),
         case when t.is_suspended then 'suspended' else 'active' end
  from public.tenants t
  on conflict do nothing;

  insert into core.business_profiles (org_id, business_name)
  select t.id, t.name
  from public.tenants t
  on conflict do nothing;

  insert into core.contacts (id, org_id, email, first_name, last_name, email_status, source, created_at, updated_at)
  select c.id, c.tenant_id, c.email, c.first_name, c.last_name,
         case
           when exists (
             select 1 from public.suppressed s
             where s.email = c.email
               and (s.tenant_id = c.tenant_id or s.tenant_id is null)
               and s.reason <> 'unsubscribe'
           ) then 'suppressed'
           when not c.is_subscribed or exists (
             select 1 from public.suppressed s
             where s.email = c.email
               and (s.tenant_id = c.tenant_id or s.tenant_id is null)
           ) then 'unsubscribed'
           else 'subscribed'
         end,
         'mail', c.created_at, c.updated_at
  from public.contacts c
  on conflict do nothing;
$$;

revoke all on all functions in schema core from public, anon, authenticated;
grant execute on all functions in schema core to service_role;

select core.sync_from_mail();
