-- 0005_add_list_type.sql
-- Add type column to lists table to distinguish marketing vs contact lists

ALTER TABLE lists ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'contact' CHECK (type IN ('marketing', 'contact'));

-- Index for filtering lists by type
CREATE INDEX IF NOT EXISTS idx_lists_type ON lists(tenant_id, type);
