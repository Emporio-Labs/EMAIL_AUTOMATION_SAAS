-- Create email_html_contents table
CREATE TABLE IF NOT EXISTS public.email_html_contents (
  hash TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on email_html_contents table to align with project conventions
ALTER TABLE public.email_html_contents ENABLE ROW LEVEL SECURITY;

-- Add html_hash column to email_jobs (referenced table must be updated first)
ALTER TABLE public.email_jobs ADD COLUMN IF NOT EXISTS html_hash TEXT REFERENCES public.email_html_contents(hash) ON DELETE SET NULL;

-- Backfill existing html contents to email_html_contents
-- We use sha256 of the bytea cast of html to produce a SHA-256 hash in hex representation
INSERT INTO public.email_html_contents (hash, html, created_at)
SELECT DISTINCT 
  encode(sha256(html::bytea), 'hex') as hash, 
  html, 
  MIN(created_at) as created_at
FROM public.email_jobs
ON CONFLICT (hash) DO NOTHING;

-- Backfill html_hash on email_jobs
UPDATE public.email_jobs
SET html_hash = encode(sha256(html::bytea), 'hex')
WHERE html_hash IS NULL;

-- Make html_hash NOT NULL
ALTER TABLE public.email_jobs ALTER COLUMN html_hash SET NOT NULL;

-- Drop html column from email_jobs
ALTER TABLE public.email_jobs DROP COLUMN html;

-- Create index on email_jobs(html_hash) for faster joins and existence checks
CREATE INDEX IF NOT EXISTS idx_email_jobs_html_hash ON public.email_jobs(html_hash);

-- Create a helper function to purge old html contents
CREATE OR REPLACE FUNCTION public.purge_old_html_contents()
RETURNS void AS $$
BEGIN
  UPDATE public.email_html_contents
  SET html = '[content purged]'
  WHERE html <> '[content purged]'
    AND NOT EXISTS (
      SELECT 1 FROM public.email_jobs
      WHERE email_jobs.html_hash = email_html_contents.hash
        AND email_jobs.created_at >= NOW() - INTERVAL '30 days'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
