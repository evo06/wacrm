import { afterEach, describe, expect, it, vi } from 'vitest'
import { serverManagedApiKey } from './server-key'

afterEach(() => vi.unstubAllEnvs())

describe('serverManagedApiKey', () => {
  it('returns the trimmed OpenRouter server key', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '  sk-or-test  ')
    expect(serverManagedApiKey('openrouter')).toBe('sk-or-test')
  })

  it('never exposes the server key to other providers', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test')
    expect(serverManagedApiKey('openai')).toBeNull()
    expect(serverManagedApiKey('anthropic')).toBeNull()
  })
})
