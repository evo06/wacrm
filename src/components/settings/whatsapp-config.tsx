'use client'

import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, MessageSquareText, QrCode, RefreshCw, Smartphone, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/use-auth'
import { createClient } from '@/lib/supabase/client'
import { resolveAgentDisplayName } from '@/lib/whatsapp/agent-signature'
import { SettingsPanelHead } from './settings-panel-head'

interface WahaConnection {
  configured?: boolean
  connected: boolean
  needs_qr?: boolean
  session?: string
  status: string
  phone?: string | null
  display_name?: string | null
  message?: string
}

const STATUS_COPY: Record<string, string> = {
  NOT_CONFIGURED: 'Pronto para iniciar a conexão.',
  OFFLINE: 'O serviço WAHA ainda não está acessível.',
  STOPPED: 'A sessão está parada.',
  STARTING: 'Preparando o WhatsApp…',
  SCAN_QR_CODE: 'Escaneie o QR Code com o celular que será usado no atendimento.',
  WORKING: 'WhatsApp conectado e pronto para enviar e receber mensagens.',
  FAILED: 'A sessão perdeu a conexão. Desconecte e tente novamente.',
}

export function WhatsAppConfig() {
  const t = useTranslations('Settings.whatsapp')
  const supabase = createClient()
  const {
    account,
    accountId,
    canEditSettings,
    profile,
    profileLoading,
    refreshProfile,
  } = useAuth()
  const [connection, setConnection] = useState<WahaConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [preparing, setPreparing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [signatureEnabled, setSignatureEnabled] = useState(false)
  const [savingSignature, setSavingSignature] = useState(false)
  const [qrVersion, setQrVersion] = useState(0)

  useEffect(() => {
    setSignatureEnabled(account?.agent_signature_enabled ?? false)
  }, [account?.agent_signature_enabled])

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch('/api/whatsapp/config', { cache: 'no-store' })
      const data = (await response.json()) as WahaConnection & { error?: string }
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar o WhatsApp.')
      setConnection(data)
      if (data.needs_qr) setQrVersion(Date.now())
    } catch (error) {
      setConnection({
        configured: false,
        connected: false,
        status: 'OFFLINE',
        message: error instanceof Error ? error.message : 'WAHA indisponível.',
      })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!connection?.configured || connection.connected) return
    const timer = window.setInterval(() => void refresh(true), 3000)
    return () => window.clearInterval(timer)
  }, [connection?.configured, connection?.connected, refresh])

  async function prepareConnection() {
    setPreparing(true)
    try {
      const response = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = (await response.json()) as WahaConnection & { error?: string }
      if (!response.ok) throw new Error(data.error || 'Não foi possível preparar a conexão.')
      setConnection(data)
      setQrVersion(Date.now())
      toast.success(data.connected ? 'WhatsApp conectado.' : 'Conexão preparada. Escaneie o QR Code.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao iniciar o WAHA.')
      await refresh(true)
    } finally {
      setPreparing(false)
    }
  }

  async function disconnect() {
    if (!window.confirm('Desconectar este WhatsApp do CRM?')) return
    setDisconnecting(true)
    try {
      const response = await fetch('/api/whatsapp/config', { method: 'DELETE' })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(data.error || 'Não foi possível desconectar.')
      setConnection({ configured: false, connected: false, status: 'NOT_CONFIGURED' })
      toast.success('WhatsApp desconectado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao desconectar.')
    } finally {
      setDisconnecting(false)
    }
  }

  async function updateAgentSignature(checked: boolean) {
    if (!accountId || !canEditSettings) return

    const previous = signatureEnabled
    setSignatureEnabled(checked)
    setSavingSignature(true)

    const { error } = await supabase
      .from('accounts')
      .update({ agent_signature_enabled: checked })
      .eq('id', accountId)

    if (error) {
      setSignatureEnabled(previous)
      toast.error(t('agentSignatureSaveFailed'))
      setSavingSignature(false)
      return
    }

    await refreshProfile()
    setSavingSignature(false)
    toast.success(
      checked ? t('agentSignatureEnabledToast') : t('agentSignatureDisabledToast'),
    )
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description="Conecte seu WhatsApp ao CRM pelo WAHA." />
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    )
  }

  const status = connection?.status || 'NOT_CONFIGURED'
  const statusText = connection?.message || STATUS_COPY[status] || 'Verificando a conexão…'
  const showQr = Boolean(connection?.configured && !connection.connected && connection.needs_qr)
  const agentName = resolveAgentDisplayName(profile?.full_name, profile?.email)

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description="Conexão direta pelo WAHA, sem a API oficial da Meta."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Alert className={connection?.connected ? 'border-emerald-700/50 bg-emerald-950/20' : ''}>
            {connection?.connected ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <Smartphone className="size-4" />
            )}
            <AlertTitle>
              {connection?.connected ? 'WhatsApp conectado' : 'WhatsApp ainda não conectado'}
            </AlertTitle>
            <AlertDescription>{statusText}</AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareText className="size-5 text-primary" />
                {t('agentSignatureTitle')}
              </CardTitle>
              <CardDescription>{t('agentSignatureDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/40 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {t('agentSignatureToggle')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('agentSignatureHint')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {savingSignature ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : null}
                  <Switch
                    checked={signatureEnabled}
                    onCheckedChange={(checked) => void updateAgentSignature(checked)}
                    disabled={
                      savingSignature || profileLoading || !canEditSettings
                    }
                    aria-label={t('agentSignatureToggle')}
                  />
                </div>
              </div>

              <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                <p className="mb-1 text-xs font-medium tracking-wide uppercase">
                  {t('agentSignaturePreview')}
                </p>
                <p className="whitespace-pre-line text-foreground">
                  {`*${agentName}:*\n${t('agentSignaturePreviewMessage')}`}
                </p>
              </div>

              {!canEditSettings ? (
                <p className="text-xs text-muted-foreground">
                  {t('agentSignatureAdminOnly')}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {showQr && (
            <Card>
              <CardHeader className="text-center">
                <CardTitle>Escaneie o QR Code</CardTitle>
                <CardDescription>
                  No celular, abra WhatsApp → Aparelhos conectados → Conectar um aparelho.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <div className="rounded-xl bg-white p-4 shadow-sm">
                  <Image
                    key={qrVersion}
                    src={`/api/whatsapp/config/qr?v=${qrVersion}`}
                    alt="QR Code para conectar o WhatsApp"
                    width={280}
                    height={280}
                    unoptimized
                    className="size-[280px]"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => setQrVersion(Date.now())}>
                  <RefreshCw className="size-4" />
                  Atualizar QR Code
                </Button>
              </CardContent>
            </Card>
          )}

          {connection?.connected && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="size-5" />
                  Aparelho conectado
                </CardTitle>
                <CardDescription>
                  {connection.display_name || 'WhatsApp'}
                  {connection.phone ? ` · +${connection.phone}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  O inbox, o bot com OpenRouter, as automações e o funil usam esta sessão.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap gap-3">
            {!connection?.connected && (
              <Button onClick={prepareConnection} disabled={preparing}>
                {preparing ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
                {connection?.configured ? 'Reiniciar conexão' : 'Preparar conexão'}
              </Button>
            )}
            <Button variant="outline" onClick={() => refresh()}>
              <RefreshCw className="size-4" />
              Verificar agora
            </Button>
            {connection?.configured && (
              <Button
                variant="outline"
                className="border-red-900 text-red-500 hover:bg-red-950/30"
                onClick={disconnect}
                disabled={disconnecting}
              >
                {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
                Desconectar
              </Button>
            )}
          </div>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Como funciona</CardTitle>
            <CardDescription>Uma conexão simples, feita pelo próprio celular.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">1</span>
              <p>Clique em <strong className="text-foreground">Preparar conexão</strong>.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">2</span>
              <p>Escaneie o QR Code com o WhatsApp do atendimento.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">3</span>
              <p>Mantenha o celular e o servidor conectados à internet.</p>
            </div>
            <p className="border-t pt-4 text-xs">
              Esta integração não é oficial. Para reduzir o risco de bloqueio, evite disparos agressivos e mensagens sem consentimento.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
