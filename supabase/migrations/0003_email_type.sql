-- Add email_type column to email_jobs table
ALTER TABLE email_jobs
ADD COLUMN email_type text DEFAULT 'marketing' CHECK (email_type IN ('transactional', 'marketing'));

-- Create index for filtering by email_type
CREATE INDEX idx_email_jobs_email_type ON email_jobs(email_type);

-- Create index for efficient filtering by tenant and email_type
CREATE INDEX idx_email_jobs_tenant_email_type ON email_jobs(tenant_id, email_type);
