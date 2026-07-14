import { describe, expect, it } from 'vitest';

import {
  buildQualificationNote,
  normalizeInstagramProfileUrl,
  parsePublicProfileHtml,
} from './enrichment';

describe('normalizeInstagramProfileUrl', () => {
  it('normalizes handles and Instagram URLs', () => {
    expect(normalizeInstagramProfileUrl('@jota6agencia')).toBe(
      'https://www.instagram.com/jota6agencia/'
    );
    expect(
      normalizeInstagramProfileUrl(
        'https://instagram.com/jota6.agencia/?hl=pt-br'
      )
    ).toBe('https://www.instagram.com/jota6.agencia/');
  });

  it('rejects external hosts, reserved paths, and invalid handles', () => {
    expect(
      normalizeInstagramProfileUrl('https://example.com/profile')
    ).toBeNull();
    expect(
      normalizeInstagramProfileUrl('https://instagram.com/explore/')
    ).toBeNull();
    expect(normalizeInstagramProfileUrl('invalid handle')).toBeNull();
  });
});

describe('parsePublicProfileHtml', () => {
  it('reads Open Graph metadata regardless of attribute order', () => {
    const snapshot = parsePublicProfileHtml(
      'https://www.instagram.com/example/',
      `<html><head>
        <meta content="Example &amp; Co" property="og:title">
        <meta property="og:description" content="Marketing &quot;criativo&quot;">
      </head></html>`
    );
    expect(snapshot.title).toBe('Example & Co');
    expect(snapshot.description).toBe('Marketing "criativo"');
  });
});

describe('buildQualificationNote', () => {
  it('includes captured lead details and profile analysis', () => {
    const note = buildQualificationNote(
      {
        nome: 'Ana',
        empresa: 'Acme',
        segmento: 'Varejo',
        objetivo: 'Gerar leads',
        instagram: '@acme',
        email: 'ana@acme.test',
      },
      {
        url: 'https://www.instagram.com/acme/',
        title: 'Acme',
        description: 'Loja',
      },
      'Perfil comunica produtos, mas não apresenta chamada clara para contato.'
    );
    expect(note).toContain('Empresa: Acme');
    expect(note).toContain('Objetivo: Gerar leads');
    expect(note).toContain('Análise pública do perfil:');
  });
});
