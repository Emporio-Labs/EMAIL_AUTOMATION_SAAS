-- 0006_backfill_list_types.sql
-- Backfill `lists.type` based on existing campaigns and known associations.
-- Run this after applying 0005_add_list_type.sql in production.

BEGIN;

-- Ensure any lists referenced by campaigns are marked as marketing.
UPDATE lists
SET type = 'marketing'
WHERE id IN (
  SELECT DISTINCT target_list_id FROM campaigns WHERE target_list_id IS NOT NULL
);

-- Optionally: keep other lists as 'contact' (default from 0005). This is a no-op
-- if 0005 used DEFAULT 'contact'. Included here for clarity.
UPDATE lists
SET type = 'contact'
WHERE type IS NULL;

COMMIT;
