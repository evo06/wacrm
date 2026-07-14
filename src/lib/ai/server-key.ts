import type { AiProvider } from './types'

/**
 * Return a server-managed provider key when one is configured.
 *
 * This is intentionally kept in a server-only environment variable (no
 * NEXT_PUBLIC_ prefix). Accounts may still provide their own key in the
 * settings UI, but a self-hosted instance can centrally manage OpenRouter
 * without ever sending the secret to the browser.
 */
export function serverManagedApiKey(provider: AiProvider): string | null {
  if (provider !== 'openrouter') return null
  return process.env.OPENROUTER_API_KEY?.trim() || null
}
