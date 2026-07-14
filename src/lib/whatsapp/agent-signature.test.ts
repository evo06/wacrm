import { describe, expect, it } from 'vitest';

import {
  applyAgentSignature,
  resolveAgentDisplayName,
} from './agent-signature';

describe('agent message signature', () => {
  it('formats a WhatsApp-friendly agent heading', () => {
    expect(applyAgentSignature('Olá! Como posso ajudar?', 'Maria Silva')).toBe(
      '*Maria Silva:*\nOlá! Como posso ajudar?'
    );
  });

  it('keeps an empty caption empty', () => {
    expect(applyAgentSignature(null, 'Maria Silva')).toBeNull();
  });

  it('normalizes profile names and falls back to the email name', () => {
    expect(resolveAgentDisplayName('  Maria   *Silva*  ', null)).toBe(
      'Maria Silva'
    );
    expect(resolveAgentDisplayName('', 'joao.souza@example.com')).toBe(
      'joao.souza'
    );
  });
});
