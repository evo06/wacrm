import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildInstagramGraphSnapshot,
  extractInstagramHandle,
  fetchInstagramBusinessProfile,
  isInstagramGraphConfigured,
  parseBusinessDiscoveryResponse,
  type InstagramProfile,
} from './instagram-graph';

describe('extractInstagramHandle', () => {
  it('pulls the handle from the canonical profile URL', () => {
    expect(extractInstagramHandle('https://www.instagram.com/acme.br/')).toBe('acme.br');
    expect(extractInstagramHandle('https://instagram.com/acme/')).toBe('acme');
  });

  it('rejects non-instagram hosts and malformed handles', () => {
    expect(extractInstagramHandle('https://example.com/acme/')).toBeNull();
    expect(extractInstagramHandle('https://www.instagram.com//')).toBeNull();
    expect(extractInstagramHandle('not a url')).toBeNull();
  });
});

describe('isInstagramGraphConfigured', () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
  });

  it('is true only when both token and user id are set', () => {
    delete process.env.META_GRAPH_TOKEN;
    delete process.env.META_IG_USER_ID;
    expect(isInstagramGraphConfigured()).toBe(false);
    process.env.META_GRAPH_TOKEN = 'tok';
    expect(isInstagramGraphConfigured()).toBe(false);
    process.env.META_IG_USER_ID = '123';
    expect(isInstagramGraphConfigured()).toBe(true);
  });
});

describe('parseBusinessDiscoveryResponse', () => {
  it('parses a successful payload including recent media', () => {
    const json = {
      business_discovery: {
        username: 'acme',
        name: 'Acme Padaria',
        biography: 'Pães artesanais no Rio',
        website: 'https://acme.com.br',
        followers_count: 12000,
        follows_count: 300,
        media_count: 540,
        media: {
          data: [
            {
              caption: 'Novo croissant!',
              like_count: 120,
              comments_count: 8,
              timestamp: '2026-06-01T10:00:00+0000',
              media_type: 'IMAGE',
              permalink: 'https://instagram.com/p/abc',
            },
          ],
        },
        id: '999',
      },
    };
    const result = parseBusinessDiscoveryResponse(json);
    expect(result.ok).toBe(true);
    expect(result.profile?.followersCount).toBe(12000);
    expect(result.profile?.media).toHaveLength(1);
    expect(result.profile?.media[0].likeCount).toBe(120);
  });

  it('maps error codes to classified failures', () => {
    expect(parseBusinessDiscoveryResponse({ error: { code: 190 } }).error).toBe('auth');
    expect(parseBusinessDiscoveryResponse({ error: { code: 4 } }).error).toBe('rate_limited');
    expect(parseBusinessDiscoveryResponse({ error: { code: 100 } }).error).toBe(
      'not_business_or_not_found',
    );
    expect(parseBusinessDiscoveryResponse({ error: { code: 2 } }).error).toBe('graph_error');
  });

  it('treats a missing business_discovery block as not found', () => {
    expect(parseBusinessDiscoveryResponse({}).error).toBe('not_business_or_not_found');
    expect(parseBusinessDiscoveryResponse(null).error).toBe('bad_response');
  });
});

describe('fetchInstagramBusinessProfile', () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
    vi.restoreAllMocks();
  });

  it('returns not_configured when env is missing', async () => {
    delete process.env.META_GRAPH_TOKEN;
    delete process.env.META_IG_USER_ID;
    const result = await fetchInstagramBusinessProfile('acme');
    expect(result.error).toBe('not_configured');
  });

  it('builds the Business Discovery URL and parses the response', async () => {
    process.env.META_GRAPH_TOKEN = 'secret-token';
    process.env.META_IG_USER_ID = '17841400000000000';
    process.env.META_GRAPH_API_VERSION = 'v22.0';

    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        business_discovery: { username: 'acme', followers_count: 10, media: { data: [] } },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchInstagramBusinessProfile('acme');
    expect(result.ok).toBe(true);
    expect(result.profile?.username).toBe('acme');

    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain('https://graph.facebook.com/v22.0/17841400000000000');
    // The handle is embedded inside the (url-encoded) fields param.
    expect(decodeURIComponent(calledUrl)).toContain('business_discovery.username(acme)');
    expect(calledUrl).toContain('access_token=secret-token');
  });

  it('rejects a malformed handle without calling the network', async () => {
    process.env.META_GRAPH_TOKEN = 'secret-token';
    process.env.META_IG_USER_ID = '123';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchInstagramBusinessProfile('bad handle!');
    expect(result.error).toBe('invalid_handle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('buildInstagramGraphSnapshot', () => {
  const profile: InstagramProfile = {
    username: 'acme',
    name: 'Acme Padaria',
    biography: 'Pães artesanais',
    website: 'https://acme.com.br',
    followersCount: 12000,
    followsCount: 300,
    mediaCount: 540,
    media: [
      {
        caption: 'Novo croissant!',
        likeCount: 120,
        commentsCount: 8,
        timestamp: '2026-06-01T10:00:00+0000',
        mediaType: 'IMAGE',
        permalink: 'https://instagram.com/p/abc',
      },
    ],
  };

  it('produces a rich, api-tagged snapshot', () => {
    const snap = buildInstagramGraphSnapshot('https://www.instagram.com/acme/', profile);
    expect(snap.ok).toBe(true);
    expect(snap.via).toBe('api');
    expect(snap.title).toBe('Acme Padaria');
    expect(snap.description).toBe('Pães artesanais');
    expect(snap.excerpt).toContain('seguidores');
    expect(snap.excerpt).toContain('Novo croissant!');
    expect(snap.excerpt).toContain('❤ 120');
  });

  it('caps the excerpt length', () => {
    const huge: InstagramProfile = {
      ...profile,
      biography: 'x'.repeat(5000),
      media: [],
    };
    const snap = buildInstagramGraphSnapshot('https://www.instagram.com/acme/', huge);
    expect((snap.excerpt ?? '').length).toBeLessThanOrEqual(3000);
  });
});
