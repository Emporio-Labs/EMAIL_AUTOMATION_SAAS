alter table public.tenants
  add column if not exists beta_terms_accepted_at timestamptz null,
  add column if not exists privacy_policy_accepted_at timestamptz null,
  add column if not exists accepted_terms_version text null; -- store version string e.g. "beta-v1"
