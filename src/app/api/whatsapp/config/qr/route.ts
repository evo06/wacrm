import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getWahaQr } from '@/lib/whatsapp/waha-api'

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
  if (!profile?.account_id) {
    return NextResponse.json({ error: 'Account not found' }, { status: 403 })
  }

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id')
    .eq('account_id', profile.account_id)
    .maybeSingle()
  if (!config) return NextResponse.json({ error: 'WAHA not configured' }, { status: 404 })

  try {
    const response = await getWahaQr(config.phone_number_id)
    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'image/png',
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'QR Code indisponível' },
      { status: 409 },
    )
  }
}
