import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

/**
 * WAHA does not have Meta's approved-template catalog. Templates in this
 * CRM are local text snippets, so "sync" is an authenticated no-op kept
 * for backward compatibility with older clients.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.account_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { count } = await supabase
    .from('message_templates')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', profile.account_id)

  return NextResponse.json({ total: count ?? 0, inserted: 0, updated: 0, local: true })
}
