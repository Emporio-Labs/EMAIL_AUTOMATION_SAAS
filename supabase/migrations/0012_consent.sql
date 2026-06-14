alter table public.tenants
  add column beta_terms_accepted_at timestamptz null,
  add column privacy_policy_accepted_at timestamptz null,
  add column accepted_terms_version text null; -- store version string e.g. "beta-v1"
