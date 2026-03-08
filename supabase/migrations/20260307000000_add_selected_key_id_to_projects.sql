-- ─────────────────────────────────────────────────────────
-- Migration: Add per-project API key selection
-- Allows users to select a specific account-level API key
-- for each project. Defaults to NULL = use account default.
-- ─────────────────────────────────────────────────────────

ALTER TABLE projects
ADD COLUMN selected_key_id UUID REFERENCES user_api_keys(id) ON DELETE SET NULL;

-- Index for lookup efficiency
CREATE INDEX idx_projects_selected_key_id ON projects(selected_key_id);

-- Add comment for clarity
COMMENT ON COLUMN projects.selected_key_id IS
  'Reference to user_api_keys. When set, this project uses the specified BYOK key. When NULL, uses user default or platform key.';
