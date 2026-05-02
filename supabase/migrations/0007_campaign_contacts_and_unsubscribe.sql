alter table contacts
add column if not exists is_subscribed boolean not null default true;

create table if not exists campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  email text not null,
  source_type text not null check (source_type in ('list', 'manual')),
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);

create index if not exists idx_campaign_contacts_campaign_id on campaign_contacts(campaign_id);
create index if not exists idx_campaign_contacts_email on campaign_contacts(email);

alter table campaigns drop column if exists target_list_id;
alter table campaigns drop column if exists opted_out_list_id;
