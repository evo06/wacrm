// Constants shared between the server-side profile-audit orchestrator and the
// client-side contact detail view. Kept in a dependency-free file so importing
// it into a client component never pulls in server-only modules (Supabase
// admin client, node:dns, etc.).

/**
 * First line of every note produced by the profile-audit feature — both the
 * success note and the failure note. The UI polls `contact_notes` for a note
 * whose text starts with this marker to know the audit finished.
 */
export const AUDIT_NOTE_PREFIX = '🔎 Auditoria de perfil (automática)';

/** Hard cap on the assembled note so one audit can't blow past sane sizes. */
export const AUDIT_NOTE_MAX_CHARS = 6_000;
