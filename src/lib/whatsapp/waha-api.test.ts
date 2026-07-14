import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  sendInteractiveButtons,
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
} from './waha-api'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  vi.restoreAllMocks()
  process.env = { ...ORIGINAL_ENV }
})

function mockSend(id = 'true_5511999999999@c.us_ABC') {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('WAHA transport', () => {
  it('sends text to a c.us chat with the API key', async () => {
    process.env.WAHA_BASE_URL = 'http://127.0.0.1:3001/'
    process.env.WAHA_API_KEY = 'server-key'
    const fetchMock = mockSend()

    await sendTextMessage({
      phoneNumberId: 'default',
      accessToken: 'account-key',
      to: '+55 (11) 99999-9999',
      text: 'Olá',
      contextMessageId: 'parent-id',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/api/sendText',
      expect.objectContaining({ method: 'POST' }),
    )
    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(options.headers).get('X-Api-Key')).toBe('account-key')
    expect(JSON.parse(String(options.body))).toEqual({
      session: 'default',
      chatId: '5511999999999@c.us',
      text: 'Olá',
      reply_to: 'parent-id',
    })
  })

  it('maps documents to sendFile', async () => {
    process.env.WAHA_API_KEY = 'key'
    const fetchMock = mockSend()
    await sendMediaMessage({
      phoneNumberId: 'default',
      accessToken: 'key',
      to: '5511999999999',
      kind: 'document',
      link: 'https://example.com/proposta.pdf',
      filename: 'proposta.pdf',
      caption: 'Segue a proposta',
    })
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3001/api/sendFile')
  })

  it('makes local Storage URLs reachable from the Docker WAHA container', async () => {
    process.env.WAHA_API_KEY = 'key'
    const fetchMock = mockSend()
    await sendMediaMessage({
      phoneNumberId: 'default',
      accessToken: 'key',
      to: '5511999999999',
      kind: 'image',
      link: 'http://127.0.0.1:8000/storage/v1/object/public/chat-media/a.png',
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.file.url).toBe(
      'http://host.docker.internal:8000/storage/v1/object/public/chat-media/a.png',
    )
  })

  it('renders local templates as WAHA text', async () => {
    process.env.WAHA_API_KEY = 'key'
    const fetchMock = mockSend()
    await sendTemplateMessage({
      phoneNumberId: 'default',
      accessToken: 'key',
      to: '5511999999999',
      templateName: 'boas_vindas',
      params: ['Ana'],
      template: { body_text: 'Olá, {{1}}!' } as never,
    })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.text).toBe('Olá, Ana!')
  })

  it('uses a reliable text menu instead of deprecated WAHA buttons', async () => {
    process.env.WAHA_API_KEY = 'key'
    const fetchMock = mockSend()
    await sendInteractiveButtons({
      phoneNumberId: 'default',
      accessToken: 'key',
      to: '5511999999999',
      bodyText: 'Escolha:',
      buttons: [{ id: 'sales', title: 'Vendas' }],
    })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.text).toContain('1. Vendas')
  })
})
