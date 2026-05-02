create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'running', 'paused', 'completed')),
  target_list_id uuid references lists(id) on delete set null,
  opted_out_list_id uuid references lists(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table email_jobs
add column if not exists campaign_id uuid references campaigns(id) on delete set null;

create index if not exists idx_campaigns_tenant_id on campaigns(tenant_id);
create index if not exists idx_campaigns_status on campaigns(status);
create index if not exists idx_email_jobs_campaign_id on email_jobs(campaign_id);