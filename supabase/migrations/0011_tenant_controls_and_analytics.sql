-- Alter tenants table — add override columns (all nullable)
alter table public.tenants
  add column if not exists max_domains integer null,
  add column if not exists max_sending_addresses integer null,
  add column if not exists max_recipients_per_send integer null,
  add column if not exists can_send_marketing boolean null,
  add column if not exists can_use_webhooks boolean null,
  add column if not exists can_track_opens boolean null,
  add column if not exists can_track_clicks boolean null,
  add column if not exists force_sandbox boolean null default false,
  add column if not exists trial_ends_at timestamptz null,
  add column if not exists internal_notes text null;

-- Alter email_jobs table — add analytics columns
alter table public.email_jobs
  add column if not exists delivered_at timestamptz null,
  add column if not exists opened_at timestamptz null,
  add column if not exists clicked_at timestamptz null,
  add column if not exists open_count integer not null default 0,
  add column if not exists click_count integer not null default 0;

-- New table email_job_events
create table if not exists public.email_job_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.email_jobs(job_id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  event_type  text not null, -- 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'unsubscribed'
  metadata    jsonb null,     -- { url, ip, user_agent } for clicks; { ip } for opens
  created_at  timestamptz not null default now()
);

create index if not exists idx_email_job_events_job_id on public.email_job_events(job_id);
create index if not exists idx_email_job_events_tenant_event on public.email_job_events(tenant_id, event_type);
