-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: API Key Audit Logging + RLS hardening + workspace isolation
-- Applied: 2026-03-07
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Audit log table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_key_audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id       UUID        NOT NULL,          -- references user_api_keys.id (soft FK — key may be deleted)
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id   UUID        REFERENCES projects(id) ON DELETE SET NULL,
  action       TEXT        NOT NULL CHECK (action IN ('created', 'deleted', 'used', 'rotated')),
  key_prefix   TEXT,
  provider     TEXT,
  ip_address   INET,
  user_agent   TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_key_audit_log_user_id   ON api_key_audit_log(user_id);
CREATE INDEX idx_api_key_audit_log_key_id    ON api_key_audit_log(key_id);
CREATE INDEX idx_api_key_audit_log_created_at ON api_key_audit_log(created_at DESC);

ALTER TABLE api_key_audit_log ENABLE ROW LEVEL SECURITY;

-- Users can only view their own audit records
CREATE POLICY "Users can view own audit logs"
  ON api_key_audit_log FOR SELECT
  USING (user_id = auth.uid());

-- ── 2. Revoke direct encrypted_key access from authenticated role ────────────
-- Users access keys only through the backend service_role, never directly.
REVOKE SELECT (encrypted_key) ON user_api_keys FROM authenticated;

-- ── 3. Safe metadata view (no encrypted_key) ─────────────────────────────────
CREATE OR REPLACE VIEW api_key_metadata_view AS
  SELECT
    id,
    user_id,
    provider,
    label,
    key_prefix,
    is_active,
    created_at,
    updated_at
  FROM user_api_keys;

GRANT SELECT ON api_key_metadata_view TO authenticated;

-- ── 4. Workspace isolation helper function ────────────────────────────────────
-- Returns true when the calling user is a member of the workspace that owns a project.
CREATE OR REPLACE FUNCTION is_workspace_member_for_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM projects
  WHERE id = p_project_id;

  IF v_workspace_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = v_workspace_id
      AND user_id = auth.uid()
  );
END;
$$;
