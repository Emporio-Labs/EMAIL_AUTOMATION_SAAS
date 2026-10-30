-- Email OTP API (/v1/otp/send, /v1/otp/verify).

-- ── Per-tenant OTP settings ──────────────────────────────────────────────────
create table if not exists public.otp_settings (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  -- Sender. from_email on the tenant's own verified domain wins; otherwise the
  -- default subdomain <subdomain_label>.<OTP_SENDING_DOMAIN> is used.
  from_email           text null,
  from_name            text null,
  app_name             text null,      -- shown in the subject and body
  subdomain_label      text null unique,
  subdomain_status     text not null default 'none', -- 'none' | 'pending' | 'verified' | 'failed'
  subdomain_dkim_tokens text[] null,
  -- Code policy.
  code_length          integer not null default 6 check (code_length between 4 and 8),
  ttl_seconds          integer not null default 600 check (ttl_seconds between 120 and 900),
  max_attempts         integer not null default 5 check (max_attempts between 1 and 10),
  -- CAPTCHA, verified server side with the tenant's own secret.
  captcha_provider     text null check (captcha_provider in ('turnstile', 'hcaptcha')),
  captcha_secret       text null,
  require_captcha      boolean not null default false,
  -- Set by the bounce monitor; only an admin can clear it.
  paused_at            timestamptz null,
  paused_reason        text null,
  resumed_at           timestamptz null, -- the bounce monitor only counts mail after this
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.otp_settings enable row level security;

-- ── Issued codes ─────────────────────────────────────────────────────────────
create table if not exists public.otp_codes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  email         text not null,
  purpose       text null,
  code_hash     text not null,          -- HMAC-SHA256(key, id || ':' || code); never the code
  job_id        uuid null references public.email_jobs(job_id) on delete set null,
  client_ip     text null,
  attempts      integer not null default 0,
  max_attempts  integer not null,
  expires_at    timestamptz not null,
  consumed_at   timestamptz null,       -- set on success, or when a newer code replaces it
  status        text not null default 'pending', -- 'pending' | 'verified' | 'superseded' | 'locked'
  created_at    timestamptz not null default now()
);

alter table public.otp_codes enable row level security;

create index if not exists idx_otp_codes_tenant_email_created on public.otp_codes(tenant_id, email, created_at desc);
create index if not exists idx_otp_codes_tenant_ip_created on public.otp_codes(tenant_id, client_ip, created_at desc) where client_ip is not null;
create index if not exists idx_otp_codes_tenant_created on public.otp_codes(tenant_id, created_at desc);

-- ── Bounce / complaint alerts ────────────────────────────────────────────────
create table if not exists public.otp_alerts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  level           text not null,       -- 'warning' | 'paused'
  sent_count      integer not null,
  bounce_rate     numeric not null,
  complaint_rate  numeric not null,
  created_at      timestamptz not null default now()
);

alter table public.otp_alerts enable row level security;

create index if not exists idx_otp_alerts_tenant_created on public.otp_alerts(tenant_id, created_at desc);

create index if not exists idx_email_jobs_source_created on public.email_jobs(source, created_at desc);

-- ── Atomic verify ────────────────────────────────────────────────────────────
-- Locks the code row and counts the attempt in the same transaction, so
-- parallel guesses cannot exceed max_attempts and a code works only once.
-- The caller computes the candidate hash, because the HMAC key lives in the
-- API and not in the database.
create or replace function public.otp_verify_attempt(
  p_tenant_id uuid,
  p_email text,
  p_code_id uuid,
  p_candidate_hash text
)
returns table (result text, code_id uuid, attempts_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  row otp_codes%rowtype;
begin
  select * into row
  from otp_codes
  where tenant_id = p_tenant_id
    and email = p_email
    and id = p_code_id
  for update;

  if row.id is null then
    return query select 'not_found'::text, null::uuid, 0;
    return;
  end if;

  if row.status = 'verified' then
    return query select 'already_used'::text, row.id, 0;
    return;
  end if;
  if row.status = 'superseded' then
    return query select 'superseded'::text, row.id, 0;
    return;
  end if;
  if row.status = 'locked' or row.attempts >= row.max_attempts then
    return query select 'too_many_attempts'::text, row.id, 0;
    return;
  end if;
  if row.expires_at <= now() then
    return query select 'expired'::text, row.id, 0;
    return;
  end if;

  if row.code_hash = p_candidate_hash then
    update otp_codes
      set attempts = attempts + 1, status = 'verified', consumed_at = now()
      where id = row.id;
    return query select 'verified'::text, row.id, row.max_attempts - row.attempts - 1;
    return;
  end if;

  update otp_codes
    set attempts = attempts + 1,
        status = case when attempts + 1 >= max_attempts then 'locked' else status end
    where id = row.id;
  return query select 'invalid'::text, row.id, greatest(row.max_attempts - row.attempts - 1, 0);
end;
$$;

-- Rate-limit counts in one round trip.
create or replace function public.otp_rate_counts(
  p_tenant_id uuid,
  p_email text,
  p_client_ip text
)
returns table (email_last_minute integer, email_last_hour integer, ip_last_hour integer, tenant_last_minute integer)
language sql
security definer
set search_path = public
as $$
  select
    (select count(*)::int from otp_codes where tenant_id = p_tenant_id and email = p_email and created_at > now() - interval '1 minute'),
    (select count(*)::int from otp_codes where tenant_id = p_tenant_id and email = p_email and created_at > now() - interval '1 hour'),
    (select case when p_client_ip is null then 0 else
      (select count(*)::int from otp_codes where tenant_id = p_tenant_id and client_ip = p_client_ip and created_at > now() - interval '1 hour') end),
    (select count(*)::int from otp_codes where tenant_id = p_tenant_id and created_at > now() - interval '1 minute');
$$;

-- OTP bounce and complaint rates per tenant over a window.
create or replace function public.otp_bounce_stats(p_since timestamptz, p_tenant_id uuid default null)
returns table (tenant_id uuid, sent integer, bounced integer, complained integer)
language sql
security definer
set search_path = public
as $$
  select tenant_id,
         count(*)::int,
         count(*) filter (where bounced_at is not null or status = 'bounced')::int,
         count(*) filter (where complained_at is not null or status = 'complained')::int
  from email_jobs
  where source = 'otp' and created_at > p_since and status <> 'queued'
    and (p_tenant_id is null or tenant_id = p_tenant_id)
  group by tenant_id;
$$;

-- Old codes are useless after expiry; keep a week for support and abuse review.
create or replace function public.purge_old_otp_codes()
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from otp_codes where created_at < now() - interval '7 days' returning 1
  )
  select count(*)::int from deleted;
$$;

revoke all on function public.otp_verify_attempt(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.otp_rate_counts(uuid, text, text) from public, anon, authenticated;
revoke all on function public.otp_bounce_stats(timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.purge_old_otp_codes() from public, anon, authenticated;
