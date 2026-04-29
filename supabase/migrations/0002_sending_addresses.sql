create table if not exists sending_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  domain_id uuid not null references domains(id) on delete cascade,
  address text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (tenant_id, address)
);

create index if not exists idx_sending_addresses_tenant_id on sending_addresses(tenant_id);
create index if not exists idx_sending_addresses_domain_id on sending_addresses(domain_id);
