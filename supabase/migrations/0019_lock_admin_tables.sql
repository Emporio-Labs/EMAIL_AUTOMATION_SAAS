-- system_admins, beta_users and email_job_events were created without row level
-- security. They sit in the public schema, so anyone holding the public anon key
-- (shipped in the dashboard) could read or write them through the REST API,
-- including adding themselves to system_admins. Only the API touches these
-- tables, with the service role, which bypasses RLS.
alter table public.system_admins enable row level security;
alter table public.beta_users enable row level security;
alter table public.email_job_events enable row level security;

-- Pin search_path on the older security definer functions.
alter function public.increment_tenant_email_count(uuid, integer) set search_path = public;
alter function public.purge_old_html_contents() set search_path = public;
alter function public.reserve_tenant_email_quota(uuid, integer) set search_path = public;
alter function public.release_tenant_email_quota(uuid, integer) set search_path = public;
