-- Atomic monthly quota reservation: succeeds only if the whole batch fits,
-- so two parallel sends can no longer both pass a stale count check.
create or replace function public.reserve_tenant_email_quota(p_tenant_id uuid, p_count integer)
returns integer as $$
declare
  new_count integer;
begin
  update public.tenants
  set monthly_email_count = monthly_email_count + p_count
  where id = p_tenant_id
    and monthly_email_count + p_count <= monthly_email_limit
  returning monthly_email_count into new_count;

  return new_count; -- null when the batch does not fit
end;
$$ language plpgsql security definer;

-- Gives back quota for jobs that were reserved but never created or queued.
create or replace function public.release_tenant_email_quota(p_tenant_id uuid, p_count integer)
returns void as $$
begin
  update public.tenants
  set monthly_email_count = greatest(monthly_email_count - p_count, 0)
  where id = p_tenant_id;
end;
$$ language plpgsql security definer;

-- Speeds up per-tenant recent-job queries.
create index if not exists idx_email_jobs_tenant_created on public.email_jobs(tenant_id, created_at desc);

-- Bounce / complaint status on the job itself.
alter table public.email_jobs
  add column if not exists bounced_at timestamptz null,
  add column if not exists complained_at timestamptz null;

-- Only the API (service role) may call these.
revoke all on function public.reserve_tenant_email_quota(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_tenant_email_quota(uuid, integer) from public, anon, authenticated;
revoke all on function public.increment_tenant_email_count(uuid, integer) from public, anon, authenticated;
revoke all on function public.purge_old_html_contents() from public, anon, authenticated;
