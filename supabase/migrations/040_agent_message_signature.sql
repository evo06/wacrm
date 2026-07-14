-- ============================================================
-- 040_agent_message_signature
--
-- Optional account-wide agent identification for manual inbox
-- replies. When enabled, the dashboard prefixes outgoing text and
-- media captions with the authenticated agent's profile name.
-- Automations, broadcasts, templates, and public API sends are not
-- affected.
--
-- RLS: no change needed. The existing accounts_update policy limits
-- account-wide preference changes to admins+.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS agent_signature_enabled BOOLEAN NOT NULL DEFAULT FALSE;
