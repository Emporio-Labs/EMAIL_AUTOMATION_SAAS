-- Saved email templates with {{merge_tags}}, and custom contact attributes.

create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  subject     text not null,
  html        text not null,
  text        text null, -- optional plain-text part; generated from html when empty
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create index if not exists idx_email_templates_tenant on public.email_templates(tenant_id);
alter table public.email_templates enable row level security;

-- Free-form per-contact fields usable as merge tags, e.g. {{company}} or {{plan}}.
alter table public.contacts
  add column if not exists attributes jsonb not null default '{}'::jsonb;

alter table public.email_jobs
  add column if not exists template_id uuid null references public.email_templates(id) on delete set null;
