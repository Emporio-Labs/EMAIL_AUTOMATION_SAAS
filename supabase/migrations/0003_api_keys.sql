create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_preview text not null,
  type text not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint api_keys_type_check check (type in ('sandbox', 'production'))
);

create index if not exists idx_api_keys_tenant_id on api_keys(tenant_id);
