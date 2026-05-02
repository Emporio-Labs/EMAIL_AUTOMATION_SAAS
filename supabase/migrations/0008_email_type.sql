-- Add email_type column to email_jobs table
ALTER TABLE email_jobs
ADD COLUMN IF NOT EXISTS email_type text;

-- Ensure a stable default and no null values for existing rows.
ALTER TABLE email_jobs
ALTER COLUMN email_type SET DEFAULT 'marketing';

UPDATE email_jobs
SET email_type = 'marketing'
WHERE email_type IS NULL;

ALTER TABLE email_jobs
ALTER COLUMN email_type SET NOT NULL;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'email_jobs_email_type_check'
			AND conrelid = 'email_jobs'::regclass
	) THEN
		ALTER TABLE email_jobs
		ADD CONSTRAINT email_jobs_email_type_check
		CHECK (email_type IN ('transactional', 'marketing'));
	END IF;
END $$;

-- Create index for filtering by email_type
CREATE INDEX IF NOT EXISTS idx_email_jobs_email_type ON email_jobs(email_type);

-- Create index for efficient filtering by tenant and email_type
CREATE INDEX IF NOT EXISTS idx_email_jobs_tenant_email_type ON email_jobs(tenant_id, email_type);
