import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getWahaSession } from '@/lib/whatsapp/waha-api'

export async function GET() {
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

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token, registered_at')
    .eq('account_id', profile.account_id)
    .maybeSingle()
  if (!config) {
    return NextResponse.json({ live: false, checks: { waha_session: false } })
  }

  try {
    const session = await getWahaSession({
      session: config.phone_number_id,
      accessToken: decrypt(config.access_token),
    })
    const live = session.status === 'WORKING'
    return NextResponse.json({
      live,
      checks: { waha_session: true, authenticated: live },
      registered_at: config.registered_at,
    })
  } catch (error) {
    return NextResponse.json({
      live: false,
      checks: { waha_session: false, authenticated: false },
      errors: [error instanceof Error ? error.message : 'WAHA unavailable'],
    })
  }
}
