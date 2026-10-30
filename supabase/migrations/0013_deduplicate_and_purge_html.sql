-- Renamed from a second "0012" migration so versions are unique.
-- Written to be safe to re-run on a database that already applied the old 0012 copy.

CREATE TABLE IF NOT EXISTS public.email_html_contents (
  hash TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.email_html_contents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.email_jobs ADD COLUMN IF NOT EXISTS html_hash TEXT REFERENCES public.email_html_contents(hash) ON DELETE SET NULL;

-- Backfill and drop the old inline html column only if it still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'email_jobs' AND column_name = 'html'
  ) THEN
    INSERT INTO public.email_html_contents (hash, html, created_at)
    SELECT encode(sha256(html::bytea), 'hex'), html, MIN(created_at)
    FROM public.email_jobs
    GROUP BY html
    ON CONFLICT (hash) DO NOTHING;

    UPDATE public.email_jobs
    SET html_hash = encode(sha256(html::bytea), 'hex')
    WHERE html_hash IS NULL;

    ALTER TABLE public.email_jobs DROP COLUMN html;
  END IF;
END $$;

ALTER TABLE public.email_jobs ALTER COLUMN html_hash SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_jobs_html_hash ON public.email_jobs(html_hash);

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
