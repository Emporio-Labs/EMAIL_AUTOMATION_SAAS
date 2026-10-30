-- Campaign content, scheduling, and per-recipient progress so the scheduler
-- can send a campaign in chunks, pause it and resume where it stopped.

alter table public.campaigns
  add column if not exists subject       text null,
  add column if not exists html          text null,
  add column if not exists from_email    text null,
  add column if not exists scheduled_at  timestamptz null,
  add column if not exists started_at    timestamptz null,
  add column if not exists completed_at  timestamptz null,
  add column if not exists last_error    text null;

-- Allow a 'failed' end state (e.g. sender domain removed mid-send).
alter table public.campaigns drop constraint if exists campaigns_status_check;
alter table public.campaigns add constraint campaigns_status_check
  check (status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed'));

alter table public.campaign_contacts
  add column if not exists processed_at   timestamptz null, -- queued or skipped
  add column if not exists skipped_reason text null;        -- 'suppressed' | 'unsubscribed' | ...

create index if not exists idx_campaign_contacts_pending
  on public.campaign_contacts(campaign_id) where processed_at is null;

create index if not exists idx_campaigns_due
  on public.campaigns(scheduled_at) where status = 'scheduled';
