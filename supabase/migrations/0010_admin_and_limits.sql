-- Create system_admins table referencing auth.users
create table if not exists public.system_admins (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

-- Note: In Supabase local migrations, auth schema might not be fully initialized when this runs,
-- so we catch foreign key references. If auth.users exists, we link it.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'auth' and tablename = 'users') then
    alter table public.system_admins
      add constraint fk_system_admins_user_id
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- Create beta_users table for whitelisting signups
create table if not exists public.beta_users (
  email text primary key,
  invited_at timestamptz not null default now()
);

-- Add limiting columns to tenants table
alter table public.tenants 
  add column if not exists plan text not null default 'starter',
  add column if not exists rate_limit integer not null default 60, -- emails per minute
  add column if not exists monthly_email_limit integer not null default 1000, -- monthly volume limit
  add column if not exists monthly_email_count integer not null default 0,
  add column if not exists last_billing_reset timestamptz not null default now(),
  add column if not exists is_suspended boolean not null default false;

-- Function to safely increment monthly email count
create or replace function public.increment_tenant_email_count(tenant_id uuid, increment_by integer)
returns void as $$
begin
  update public.tenants
  set monthly_email_count = monthly_email_count + increment_by
  where id = tenant_id;
end;
$$ language plpgsql security definer;
