import { describe, expect, it } from 'vitest';

import { AUDIT_NOTE_MAX_CHARS, AUDIT_NOTE_PREFIX } from './audit-constants';
import {
  buildAuditNote,
  filterCompetitorResults,
  normalizeGoogleMapsUrl,
  normalizeLinkedInUrl,
  normalizeWebsiteUrl,
  type AuditInputs,
  type CompetitorResearch,
  type SourceSnapshot,
} from './profile-audit';

describe('normalizeWebsiteUrl', () => {
  it('accepts bare domains and canonicalizes them', () => {
    expect(normalizeWebsiteUrl('acme.com.br')).toBe('https://acme.com.br/');
    expect(normalizeWebsiteUrl('http://acme.com/path?x=1#frag')).toBe(
      'http://acme.com/path?x=1',
    );
  });

  it('rejects credentials, odd ports, non-http schemes, and hostless input', () => {
    expect(normalizeWebsiteUrl('https://user:pass@acme.com')).toBeNull();
    expect(normalizeWebsiteUrl('https://acme.com:8080')).toBeNull();
    expect(normalizeWebsiteUrl('ftp://acme.com')).toBeNull();
    expect(normalizeWebsiteUrl('localhost')).toBeNull();
    expect(normalizeWebsiteUrl('')).toBeNull();
  });
});

describe('normalizeLinkedInUrl', () => {
  it('accepts /in/ and /company/ profiles in any input form', () => {
    expect(normalizeLinkedInUrl('https://linkedin.com/in/john-doe')).toBe(
      'https://www.linkedin.com/in/john-doe/',
    );
    expect(normalizeLinkedInUrl('company/acme-inc')).toBe(
      'https://www.linkedin.com/company/acme-inc/',
    );
    expect(normalizeLinkedInUrl('https://br.linkedin.com/in/maria?trk=x')).toBe(
      'https://www.linkedin.com/in/maria/',
    );
  });

  it('rejects foreign hosts and non-profile paths', () => {
    expect(normalizeLinkedInUrl('https://example.com/in/john')).toBeNull();
    expect(normalizeLinkedInUrl('https://linkedin.com/feed/')).toBeNull();
    expect(normalizeLinkedInUrl('https://linkedin.com/in/')).toBeNull();
  });
});

describe('normalizeGoogleMapsUrl', () => {
  it('accepts google.com/maps and the short link hosts', () => {
    expect(
      normalizeGoogleMapsUrl('https://www.google.com/maps/place/Acme'),
    ).toBe('https://www.google.com/maps/place/Acme');
    expect(normalizeGoogleMapsUrl('https://maps.app.goo.gl/abc123')).toBe(
      'https://maps.app.goo.gl/abc123',
    );
  });

  it('rejects other hosts, non-maps paths, and bare handles', () => {
    expect(normalizeGoogleMapsUrl('https://google.com/search?q=acme')).toBeNull();
    expect(normalizeGoogleMapsUrl('https://evil.com/maps')).toBeNull();
    expect(normalizeGoogleMapsUrl('acme maps')).toBeNull();
  });
});

describe('filterCompetitorResults', () => {
  it('drops own domain and denylisted hosts, dedupes, and caps at 5', () => {
    const raw = [
      { title: 'Acme (own)', url: 'https://www.acme.com/' },
      { title: 'FB', url: 'https://facebook.com/acme' },
      { title: 'Comp One', url: 'https://comp-one.com/a' },
      { title: 'Comp One dup', url: 'https://comp-one.com/b' },
      { title: 'Comp Two', url: 'https://comp-two.com.br/' },
      { title: 'Comp Three', url: 'https://comp-three.com/' },
      { title: 'Comp Four', url: 'https://comp-four.com/' },
      { title: 'Comp Five', url: 'https://comp-five.com/' },
      { title: 'Comp Six', url: 'https://comp-six.com/' },
    ];
    const filtered = filterCompetitorResults(raw, ['acme.com']);
    expect(filtered).toHaveLength(5);
    const hosts = filtered.map((f) => new URL(f.url).hostname);
    expect(hosts).not.toContain('www.acme.com');
    expect(hosts).not.toContain('facebook.com');
    // comp-one appears once despite two results
    expect(hosts.filter((h) => h === 'comp-one.com')).toHaveLength(1);
  });

  it('normalizes candidate urls to bare https homepages', () => {
    const filtered = filterCompetitorResults(
      [{ title: 'X', url: 'https://www.example.org/deep/path?q=1' }],
      [],
    );
    expect(filtered[0].url).toBe('https://example.org/');
  });
});

describe('buildAuditNote', () => {
  const inputs: AuditInputs = {
    contactName: 'Ana',
    company: 'Acme',
    segmento: 'Padaria',
    cidade: 'Rio de Janeiro',
    urls: {},
  };

  it('has the marker prefix and all three sections, listing failures', () => {
    const snapshots: SourceSnapshot[] = [
      {
        source: 'instagram',
        url: 'https://www.instagram.com/acme/',
        ok: true,
        title: 'Acme',
        description: 'Padaria artesanal',
        excerpt: 'pães e cafés',
        error: null,
      },
      {
        source: 'linkedin',
        url: 'https://www.linkedin.com/company/acme/',
        ok: false,
        title: null,
        description: null,
        excerpt: null,
        error: 'blocked_or_empty',
      },
    ];
    const research: CompetitorResearch = { competitors: [], skippedReason: null };
    const note = buildAuditNote({
      inputs,
      snapshots,
      improvements: 'Criar CTA no perfil.',
      research,
      competitorStrengths: 'Concorrente X: bom portfólio.',
    });

    expect(note.startsWith(AUDIT_NOTE_PREFIX)).toBe(true);
    expect(note).toContain('📋 Perfis analisados');
    expect(note).toContain('💡 Melhorias sugeridas');
    expect(note).toContain('🏆 Concorrentes e pontos fortes');
    expect(note).toContain('Instagram: ✓');
    expect(note).toContain('LinkedIn: ✗');
    expect(note).toContain('Criar CTA no perfil.');
    expect(note).toContain('Concorrente X: bom portfólio.');
  });

  it('explains why competitors were not researched', () => {
    const note = buildAuditNote({
      inputs: { ...inputs, segmento: null },
      snapshots: [],
      improvements: null,
      research: { competitors: [], skippedReason: 'segmento_ausente' },
      competitorStrengths: null,
    });
    expect(note).toContain('Concorrentes não pesquisados');
    expect(note).toContain('segmento');
  });

  it('respects the char cap', () => {
    const huge = 'x'.repeat(10_000);
    const note = buildAuditNote({
      inputs,
      snapshots: [],
      improvements: huge,
      research: { competitors: [], skippedReason: null },
      competitorStrengths: huge,
    });
    expect(note.length).toBeLessThanOrEqual(AUDIT_NOTE_MAX_CHARS);
  });
});
