import type { MessageTemplate } from '@/types'

export type MediaKind = 'image' | 'video' | 'document' | 'audio'

export interface InteractiveButton {
  id: string
  title: string
}

export interface InteractiveListRow {
  id: string
  title: string
  description?: string
}

export interface InteractiveListSection {
  title?: string
  rows: InteractiveListRow[]
}

// Kept aligned with the CRM's existing composer validation. WAHA sends
// these menus as reliable numbered text, but the limits still keep the UI
// compact and preserve existing saved flows.
export const INTERACTIVE_LIMITS = {
  maxButtons: 3,
  buttonTitleMaxLength: 20,
  maxListSections: 10,
  maxListRowsTotal: 10,
  listRowTitleMaxLength: 24,
  listRowDescriptionMaxLength: 72,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
} as const

export type WahaSessionStatus =
  | 'STOPPED'
  | 'STARTING'
  | 'SCAN_QR_CODE'
  | 'WORKING'
  | 'FAILED'
  | string

export interface WahaSession {
  name: string
  status: WahaSessionStatus
  me?: { id?: string; pushName?: string } | null
  config?: Record<string, unknown>
}

interface WahaSendResult {
  messageId: string
}

interface WahaEnvironment {
  baseUrl: string
  apiKey: string
  session: string
  webhookUrl: string
  webhookSecret: string
}

function cleanBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

export function getWahaEnvironment(): WahaEnvironment {
  const baseUrl = cleanBaseUrl(process.env.WAHA_BASE_URL || 'http://127.0.0.1:3001')
  const apiKey = process.env.WAHA_API_KEY?.trim() || ''
  const session = process.env.WAHA_SESSION?.trim() || 'default'
  const webhookUrl = process.env.WAHA_WEBHOOK_URL?.trim() || ''
  const webhookSecret = process.env.WAHA_WEBHOOK_SECRET?.trim() || ''

  if (!apiKey) throw new Error('WAHA_API_KEY is not configured.')
  return { baseUrl, apiKey, session, webhookUrl, webhookSecret }
}

async function wahaRequest(
  path: string,
  options: RequestInit & { apiKey?: string; baseUrl?: string } = {},
): Promise<Response> {
  const env = getWahaEnvironment()
  const apiKey = options.apiKey || env.apiKey
  const baseUrl = cleanBaseUrl(options.baseUrl || env.baseUrl)
  const headers = new Headers(options.headers)
  headers.set('X-Api-Key', apiKey)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `WAHA error ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
    )
  }
  return response
}

async function wahaJson<T>(
  path: string,
  options: RequestInit & { apiKey?: string; baseUrl?: string } = {},
): Promise<T> {
  const response = await wahaRequest(path, options)
  return (await response.json()) as T
}

function chatId(phone: string): string {
  if (phone.includes('@')) {
    return phone.replace('@s.whatsapp.net', '@c.us')
  }
  const digits = phone.replace(/\D/g, '')
  if (!digits) throw new Error('Invalid WhatsApp recipient.')
  return `${digits}@c.us`
}

/**
 * WAHA runs in Docker while this self-hosted CRM and Supabase are exposed on
 * the Windows host. A Storage public URL such as http://127.0.0.1:8000/...
 * is valid in the browser, but from inside the WAHA container it points back
 * to WAHA itself. Docker provides host.docker.internal for this exact bridge.
 *
 * Only rewrite loopback hosts. Public deployments and already-routable URLs
 * retain their original host unchanged.
 */
function urlReachableFromWaha(link: string): string {
  try {
    const url = new URL(link)
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') {
      url.hostname = 'host.docker.internal'
    }
    return url.toString()
  } catch {
    // Let WAHA report malformed links with its normal error response.
    return link
  }
}

function extractMessageId(data: unknown): string {
  if (!data || typeof data !== 'object') {
    throw new Error('WAHA returned no message id.')
  }
  const row = data as Record<string, unknown>
  if (typeof row.id === 'string') return row.id
  if (row.id && typeof row.id === 'object') {
    const serialized = (row.id as Record<string, unknown>)._serialized
    if (typeof serialized === 'string') return serialized
  }
  if (row.key && typeof row.key === 'object') {
    const id = (row.key as Record<string, unknown>).id
    if (typeof id === 'string') return id
  }
  throw new Error('WAHA returned an unexpected send response.')
}

async function sendJson(
  endpoint: string,
  body: Record<string, unknown>,
  accessToken: string,
): Promise<WahaSendResult> {
  const data = await wahaJson<unknown>(endpoint, {
    method: 'POST',
    apiKey: accessToken,
    body: JSON.stringify(body),
  })
  return { messageId: extractMessageId(data) }
}

export async function getWahaSession(args?: {
  session?: string
  accessToken?: string
}): Promise<WahaSession> {
  const env = getWahaEnvironment()
  const session = args?.session || env.session
  return wahaJson<WahaSession>(`/api/sessions/${encodeURIComponent(session)}`, {
    apiKey: args?.accessToken,
    cache: 'no-store',
  })
}

function sessionConfig(accountId: string, webhookUrl: string, webhookSecret: string) {
  return {
    metadata: { account_id: accountId },
    ignore: { status: true, groups: true, channels: true, broadcast: true },
    webhooks: webhookUrl
      ? [
          {
            url: webhookUrl,
            events: ['message', 'message.ack', 'message.reaction', 'session.status'],
            ...(webhookSecret ? { hmac: { key: webhookSecret } } : {}),
            retries: { policy: 'constant', delaySeconds: 2, attempts: 10 },
          },
        ]
      : [],
  }
}

export async function ensureWahaSession(args: {
  accountId: string
  session?: string
}): Promise<WahaSession> {
  const env = getWahaEnvironment()
  const session = args.session || env.session
  const body = {
    name: session,
    config: sessionConfig(args.accountId, env.webhookUrl, env.webhookSecret),
  }

  try {
    await getWahaSession({ session })
    await wahaRequest(`/api/sessions/${encodeURIComponent(session)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('404')) throw error
    await wahaRequest('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  const current = await getWahaSession({ session })
  if (current.status === 'STOPPED' || current.status === 'FAILED') {
    await wahaRequest(`/api/sessions/${encodeURIComponent(session)}/start`, {
      method: 'POST',
    })
  }
  return getWahaSession({ session })
}

export async function logoutWahaSession(session: string): Promise<void> {
  await wahaRequest(`/api/sessions/${encodeURIComponent(session)}/logout`, {
    method: 'POST',
  })
}

export async function getWahaQr(session: string): Promise<Response> {
  return wahaRequest(`/api/${encodeURIComponent(session)}/auth/qr`, {
    // WAHA exposes QR retrieval as GET. Using POST happens to reach the
    // controller path but returns 404 on current WAHA releases.
    method: 'GET',
    headers: { Accept: 'image/png' },
    cache: 'no-store',
  })
}

/**
 * Resolve a WhatsApp LID (privacy-preserving sender id, e.g.
 * "78877695181052@lid") to the contact's real phone JID
 * ("5521978933556@c.us") using the session's lid↔pn mapping store.
 * Returns null when the mapping isn't known (yet) — callers must
 * degrade gracefully rather than drop the message.
 */
export async function resolveWahaLid(args: {
  session: string
  lid: string
  accessToken?: string
}): Promise<string | null> {
  try {
    const data = await wahaJson<{ lid: string; pn: string | null }>(
      `/api/${encodeURIComponent(args.session)}/lids/${encodeURIComponent(args.lid)}`,
      { apiKey: args.accessToken, cache: 'no-store' },
    )
    return data.pn || null
  } catch {
    return null
  }
}

/**
 * Read a WhatsApp contact's display name. Some engines omit `pushName` from
 * an inbound webhook even though it is available from the contacts endpoint.
 * This lookup is deliberately best-effort: failure to read a profile must
 * never delay or discard an inbound message.
 */
export async function getWahaContactDisplayName(args: {
  session: string
  contactId: string
  accessToken?: string
}): Promise<string | null> {
  try {
    const query = new URLSearchParams({
      session: args.session,
      contactId: args.contactId,
    })
    const contact = await wahaJson<{
      name?: string | null
      pushname?: string | null
      pushName?: string | null
      shortName?: string | null
    }>(`/api/contacts?${query.toString()}`, {
      apiKey: args.accessToken,
      cache: 'no-store',
    })
    const name = contact.pushname || contact.pushName || contact.name || contact.shortName
    return typeof name === 'string' && name.trim() ? name.trim().slice(0, 255) : null
  } catch {
    return null
  }
}

export async function fetchWahaMedia(path: string, accessToken?: string): Promise<Response> {
  const env = getWahaEnvironment()
  const target = new URL(path, `${env.baseUrl}/`)
  // WAHA may describe itself as http://localhost:3000 inside the webhook,
  // while the CRM reaches it through host port 3001. Ignore that supplied
  // origin and proxy only the tightly allow-listed files path via WAHA_BASE_URL.
  if (!target.pathname.startsWith('/api/files/')) {
    throw new Error('Invalid WAHA media path.')
  }
  return wahaRequest(`${target.pathname}${target.search}`, {
    apiKey: accessToken,
    cache: 'no-store',
  })
}

export async function sendTextMessage(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  text: string
  contextMessageId?: string
}): Promise<WahaSendResult> {
  return sendJson(
    '/api/sendText',
    {
      session: args.phoneNumberId,
      chatId: chatId(args.to),
      text: args.text,
      ...(args.contextMessageId ? { reply_to: args.contextMessageId } : {}),
    },
    args.accessToken,
  )
}

function mimeFor(kind: MediaKind, filename?: string): string {
  const extension = filename?.split('.').pop()?.toLowerCase()
  if (kind === 'image') return extension === 'png' ? 'image/png' : 'image/jpeg'
  if (kind === 'video') return 'video/mp4'
  if (kind === 'audio') return 'audio/ogg; codecs=opus'
  return 'application/octet-stream'
}

export async function sendMediaMessage(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  kind: MediaKind
  link: string
  caption?: string
  filename?: string
  contextMessageId?: string
}): Promise<WahaSendResult> {
  if (!args.link) throw new Error('sendMediaMessage requires a link.')
  const endpoint = {
    image: '/api/sendImage',
    video: '/api/sendVideo',
    document: '/api/sendFile',
    audio: '/api/sendVoice',
  }[args.kind]
  return sendJson(
    endpoint,
    {
      session: args.phoneNumberId,
      chatId: chatId(args.to),
      file: {
        url: urlReachableFromWaha(args.link),
        mimetype: mimeFor(args.kind, args.filename),
        ...(args.filename ? { filename: args.filename } : {}),
      },
      ...(args.caption && args.kind !== 'audio' ? { caption: args.caption } : {}),
      ...(args.contextMessageId ? { reply_to: args.contextMessageId } : {}),
    },
    args.accessToken,
  )
}

function positionalParams(messageParams: unknown, legacy: string[] = []): string[] {
  if (!messageParams || typeof messageParams !== 'object') return legacy
  const body = (messageParams as { body?: unknown }).body
  return Array.isArray(body)
    ? body.map((value) => (typeof value === 'string' ? value : String(value ?? '')))
    : legacy
}

function renderTemplateText(
  templateName: string,
  template: MessageTemplate | undefined,
  params: string[],
): string {
  const source = template?.body_text?.trim() || `[${templateName}]`
  const body = source.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, raw: string) => {
    return params[Number(raw) - 1] ?? `{{${raw}}}`
  })
  return [template?.header_type === 'text' ? template.header_content : null, body, template?.footer_text]
    .filter(Boolean)
    .join('\n\n')
}

export async function sendTemplateMessage(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  templateName: string
  language?: string
  params?: string[]
  template?: MessageTemplate
  messageParams?: unknown
  contextMessageId?: string
}): Promise<WahaSendResult> {
  const params = positionalParams(args.messageParams, args.params || [])
  return sendTextMessage({
    phoneNumberId: args.phoneNumberId,
    accessToken: args.accessToken,
    to: args.to,
    text: renderTemplateText(args.templateName, args.template, params),
    contextMessageId: args.contextMessageId,
  })
}

function menuText(parts: Array<string | undefined>, options: string[]): string {
  return [...parts.filter((part): part is string => Boolean(part?.trim())), ...options]
    .join('\n\n')
}

export async function sendInteractiveButtons(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  headerText?: string
  footerText?: string
  buttons: InteractiveButton[]
  contextMessageId?: string
}): Promise<WahaSendResult> {
  return sendTextMessage({
    phoneNumberId: args.phoneNumberId,
    accessToken: args.accessToken,
    to: args.to,
    text: menuText(
      [args.headerText, args.bodyText],
      args.buttons.map((button, index) => `${index + 1}. ${button.title}`)
        .concat(args.footerText ? [args.footerText] : []),
    ),
    contextMessageId: args.contextMessageId,
  })
}

export async function sendInteractiveList(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  buttonLabel: string
  headerText?: string
  footerText?: string
  sections: InteractiveListSection[]
  contextMessageId?: string
}): Promise<WahaSendResult> {
  const rows = args.sections.flatMap((section) => [
    ...(section.title ? [`*${section.title}*`] : []),
    ...section.rows.map((row, index) => `${index + 1}. ${row.title}${row.description ? ` — ${row.description}` : ''}`),
  ])
  return sendTextMessage({
    phoneNumberId: args.phoneNumberId,
    accessToken: args.accessToken,
    to: args.to,
    text: menuText([args.headerText, args.bodyText], rows.concat(args.footerText ? [args.footerText] : [])),
    contextMessageId: args.contextMessageId,
  })
}

export async function sendReactionMessage(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  targetMessageId: string
  emoji: string
}): Promise<WahaSendResult> {
  void args.to
  const data = await wahaJson<unknown>('/api/reaction', {
    method: 'PUT',
    apiKey: args.accessToken,
    body: JSON.stringify({
      session: args.phoneNumberId,
      messageId: args.targetMessageId,
      reaction: args.emoji,
    }),
  })
  try {
    return { messageId: extractMessageId(data) }
  } catch {
    return { messageId: args.targetMessageId }
  }
}
