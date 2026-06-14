-- Make tenant_id nullable in suppressed table
ALTER TABLE suppressed ALTER COLUMN tenant_id DROP NOT NULL;

-- Create a unique index to prevent duplicate global suppressions (where tenant_id is NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppressed_global_email_unique ON suppressed (email) WHERE tenant_id IS NULL;

-- Enable Row-Level Security (RLS) on all tables to secure direct client-side access.
-- This blocks any direct read/write from client-side Supabase JS SDK using the public anon key.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppressed ENABLE ROW LEVEL SECURITY;
ALTER TABLE sending_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_contacts ENABLE ROW LEVEL SECURITY;
