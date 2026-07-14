import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy, shared service-role client for the profile-audit background task.
// Mirrors src/lib/ai/admin-client.ts — the audit runs in an `after()`
// callback with no `auth.uid()`, so it reads/writes contact data and notes
// through the service role. The API route enforces the caller's role before
// scheduling the work, so this bypass is gated behind an explicit agent check.
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}
