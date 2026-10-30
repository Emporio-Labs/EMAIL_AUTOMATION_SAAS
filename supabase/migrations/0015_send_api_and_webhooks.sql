-- Transactional send API (/v1/emails) and outbound webhooks.

-- ── email_jobs: fields used by API sends ─────────────────────────────────────
alter table public.email_jobs
  add column if not exists source text not null default 'dashboard', -- 'dashboard' | 'api'
  add column if not exists idempotency_key text null,
  add column if not exists request_hash text null,
  add column if not exists to_emails text[] null,
  add column if not exists cc_emails text[] null,
  add column if not exists bcc_emails text[] null,
  add column if not exists reply_to text[] null,
  add column if not exists attachments jsonb null, -- [{ filename, url }]
  add column if not exists tags jsonb null;        -- { key: value }

create unique index if not exists idx_email_jobs_tenant_idempotency
  on public.email_jobs(tenant_id, idempotency_key)
  where idempotency_key is not null;

-- ── Webhook endpoint: one per tenant ─────────────────────────────────────────
create table if not exists public.webhook_endpoints (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null unique references public.tenants(id) on delete cascade,
  url         text not null,
  secret      text not null,
  events      text[] not null default array[
    'email.sent', 'email.delivered', 'email.bounced', 'email.complained',
    'email.opened', 'email.clicked', 'email.failed'
  ],
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.webhook_endpoints enable row level security;

-- ── Webhook deliveries: outbox + log ─────────────────────────────────────────
create table if not exists public.webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  endpoint_id      uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_type       text not null,
  payload          jsonb not null,
  status           text not null default 'pending', -- 'pending' | 'succeeded' | 'failed'
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  locked_until     timestamptz null,
  last_status_code integer null,
  last_error       text null,
  delivered_at     timestamptz null,
  created_at       timestamptz not null default now()
);

alter table public.webhook_deliveries enable row level security;

create index if not exists idx_webhook_deliveries_due
  on public.webhook_deliveries(next_attempt_at)
  where status = 'pending';
create index if not exists idx_webhook_deliveries_tenant_created
  on public.webhook_deliveries(tenant_id, created_at desc);

-- ── Every email_job_events row becomes a webhook delivery ────────────────────
-- Opens, clicks, deliveries, bounces and complaints are already written to
-- email_job_events by the tracking and SNS routes, so hooking here covers them
-- all without touching those code paths.
create or replace function public.enqueue_webhook_for_job_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  endpoint record;
  job record;
  webhook_event text := 'email.' || new.event_type;
begin
  select id, events into endpoint
  from webhook_endpoints
  where tenant_id = new.tenant_id and enabled
  limit 1;

  if endpoint.id is null or not (webhook_event = any(endpoint.events)) then
    return new;
  end if;

  select job_id, from_email, to_email, to_emails, cc_emails, subject, email_type,
         campaign_id, source, tags, created_at
    into job
  from email_jobs
  where job_id = new.job_id;

  insert into webhook_deliveries (tenant_id, endpoint_id, event_type, payload)
  values (
    new.tenant_id,
    endpoint.id,
    webhook_event,
    jsonb_build_object(
      'email_id', new.job_id,
      'from', job.from_email,
      'to', coalesce(to_jsonb(job.to_emails), jsonb_build_array(job.to_email)),
      'cc', coalesce(to_jsonb(job.cc_emails), '[]'::jsonb),
      'subject', job.subject,
      'email_type', job.email_type,
      'campaign_id', job.campaign_id,
      'source', job.source,
      'tags', coalesce(job.tags, '{}'::jsonb),
      'email_created_at', job.created_at,
      'event_at', new.created_at,
      'details', coalesce(new.metadata, '{}'::jsonb)
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_email_job_events_webhook on public.email_job_events;
create trigger trg_email_job_events_webhook
  after insert on public.email_job_events
  for each row execute function public.enqueue_webhook_for_job_event();

-- ── Worker status changes become 'sent' / 'failed' events ────────────────────
-- The Go worker reports 'delivered' (accepted by SES) or 'failed' through
-- /internal/job-status. Record those as events so webhooks see them too.
create or replace function public.record_job_status_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'failed' then
      insert into email_job_events (job_id, tenant_id, event_type, metadata)
      values (new.job_id, new.tenant_id, 'failed',
              jsonb_build_object('reason', new.failure_reason));
    elsif old.status = 'queued' and new.status in ('delivered', 'sent') then
      insert into email_job_events (job_id, tenant_id, event_type, metadata)
      values (new.job_id, new.tenant_id, 'sent', '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_email_jobs_status_event on public.email_jobs;
create trigger trg_email_jobs_status_event
  after update of status on public.email_jobs
  for each row execute function public.record_job_status_event();

-- ── Claim due deliveries (safe with several API processes) ───────────────────
create or replace function public.claim_webhook_deliveries(batch_size integer default 20)
returns setof public.webhook_deliveries
language sql
security definer
set search_path = public
as $$
  update webhook_deliveries d
     set locked_until = now() + interval '2 minutes'
   where d.id in (
     select id from webhook_deliveries
      where status = 'pending'
        and next_attempt_at <= now()
        and (locked_until is null or locked_until < now())
      order by next_attempt_at
      limit batch_size
      for update skip locked
   )
  returning d.*;
$$;

-- Only the API (service role) may call these.
revoke all on function public.claim_webhook_deliveries(integer) from public, anon, authenticated;
revoke all on function public.enqueue_webhook_for_job_event() from public, anon, authenticated;
revoke all on function public.record_job_status_event() from public, anon, authenticated;
