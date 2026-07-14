import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import {
  ensureWahaSession,
  getWahaEnvironment,
  getWahaSession,
  logoutWahaSession,
} from '@/lib/whatsapp/waha-api'

async function authenticatedAccount() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.account_id) return null
  return { supabase, user, accountId: profile.account_id as string }
}

function sessionResponse(session: {
  name: string
  status: string
  me?: { id?: string; pushName?: string } | null
}) {
  return {
    connected: session.status === 'WORKING',
    needs_qr: session.status === 'SCAN_QR_CODE',
    session: session.name,
    status: session.status,
    phone: session.me?.id?.replace(/@.+$/, '') || null,
    display_name: session.me?.pushName || null,
  }
}

export async function GET() {
  const auth = await authenticatedAccount()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: config } = await auth.supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', auth.accountId)
    .maybeSingle()

  if (!config) {
    return NextResponse.json({
      connected: false,
      configured: false,
      status: 'NOT_CONFIGURED',
      message: 'Clique em “Preparar conexão” para gerar o QR Code.',
    })
  }

  try {
    const session = await getWahaSession({
      session: config.phone_number_id,
      accessToken: decrypt(config.access_token),
    })
    return NextResponse.json({ configured: true, ...sessionResponse(session) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WAHA indisponível.'
    return NextResponse.json({
      connected: false,
      configured: true,
      status: 'OFFLINE',
      message,
    })
  }
}

export async function POST(request: Request) {
  const auth = await authenticatedAccount()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = (await request.json().catch(() => ({}))) as { session?: string }
    const env = getWahaEnvironment()
    const sessionName = body.session?.trim() || env.session
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sessionName)) {
      return NextResponse.json({ error: 'Nome de sessão inválido.' }, { status: 400 })
    }

    const session = await ensureWahaSession({
      accountId: auth.accountId,
      session: sessionName,
    })

    const row = {
      phone_number_id: sessionName,
      waba_id: env.baseUrl,
      access_token: encrypt(env.apiKey),
      verify_token: env.webhookSecret ? encrypt(env.webhookSecret) : null,
      status: session.status === 'WORKING' ? 'connected' : 'disconnected',
      connected_at: session.status === 'WORKING' ? new Date().toISOString() : null,
      registered_at: session.status === 'WORKING' ? new Date().toISOString() : null,
      last_registration_error: null,
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await auth.supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', auth.accountId)
      .maybeSingle()

    const mutation = existing
      ? auth.supabase.from('whatsapp_config').update(row).eq('account_id', auth.accountId)
      : auth.supabase.from('whatsapp_config').insert({
          account_id: auth.accountId,
          user_id: auth.user.id,
          ...row,
        })
    const { error: saveError } = await mutation
    if (saveError) throw new Error(`Não foi possível salvar a conexão: ${saveError.message}`)

    return NextResponse.json({ configured: true, ...sessionResponse(session) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao preparar o WAHA.'
    console.error('[waha/config] setup failed:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export async function DELETE() {
  const auth = await authenticatedAccount()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: config } = await auth.supabase
    .from('whatsapp_config')
    .select('phone_number_id')
    .eq('account_id', auth.accountId)
    .maybeSingle()

  if (config?.phone_number_id) {
    try {
      await logoutWahaSession(config.phone_number_id)
    } catch (error) {
      console.warn(
        '[waha/config] logout failed:',
        error instanceof Error ? error.message : error,
      )
    }
  }

  const { error } = await auth.supabase
    .from('whatsapp_config')
    .delete()
    .eq('account_id', auth.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
