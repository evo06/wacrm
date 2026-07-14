import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { fetchWahaMedia } from '@/lib/whatsapp/waha-api'

export async function GET(request: Request) {
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

  const path = new URL(request.url).searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'Missing media path' }, { status: 400 })

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('access_token')
    .eq('account_id', profile.account_id)
    .maybeSingle()
  if (!config) return NextResponse.json({ error: 'WAHA not configured' }, { status: 404 })

  try {
    const response = await fetchWahaMedia(path, decrypt(config.access_token))
    return new Response(await response.arrayBuffer(), {
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Media unavailable' },
      { status: 502 },
    )
  }
}
