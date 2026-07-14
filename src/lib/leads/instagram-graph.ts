// ============================================================
// Instagram Graph API — Business Discovery.
//
// Given a public Instagram *Business/Creator* username, Meta's Business
// Discovery endpoint returns structured public data (bio, follower/media
// counts, website, recent posts with engagement) WITHOUT the target account
// authorizing us. This is far richer and more reliable than scraping OG meta
// tags, so the profile audit prefers it for Instagram when a Meta token is
// configured, falling back to the Scrapling stealth scrape otherwise (or for
// personal accounts, which Business Discovery can't read).
//
// Requires (agency side): a Meta app, an IG Business account linked to a
// Facebook Page, and a long-lived token with instagram_basic,
// instagram_manage_insights, pages_read_engagement. Config comes from env
// (META_GRAPH_TOKEN / META_IG_USER_ID / optional META_GRAPH_API_VERSION).
//
// The endpoint host is fixed (graph.facebook.com), so there is no SSRF
// surface here. The token is a secret: it is never logged nor written to the
// note.
// ============================================================

import type { SourceSnapshot } from './profile-audit';

const GRAPH_HOST = 'https://graph.facebook.com';
const DEFAULT_VERSION = 'v22.0';
// Mirrors PER_SOURCE_EXCERPT_CHARS in profile-audit.ts. Kept local to avoid a
// runtime import cycle (profile-audit imports this module's functions).
const IG_EXCERPT_CHARS = 3_000;
const MEDIA_LIMIT = 12;
const FETCH_TIMEOUT_MS = 10_000;
const HANDLE_RE = /^[a-zA-Z0-9._]{1,30}$/;

export interface InstagramMedia {
  caption: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  timestamp: string | null;
  mediaType: string | null;
  permalink: string | null;
}

export interface InstagramProfile {
  username: string | null;
  name: string | null;
  biography: string | null;
  website: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
  media: InstagramMedia[];
}

export type InstagramGraphError =
  | 'not_configured'
  | 'invalid_handle'
  | 'not_business_or_not_found'
  | 'rate_limited'
  | 'auth'
  | 'graph_error'
  | 'timeout'
  | 'network'
  | 'bad_response';

export interface InstagramGraphResult {
  ok: boolean;
  error: InstagramGraphError | null;
  profile: InstagramProfile | null;
}

function fail(error: InstagramGraphError): InstagramGraphResult {
  return { ok: false, error, profile: null };
}

/** True when both the token and the agency IG user id are set. */
export function isInstagramGraphConfigured(): boolean {
  return Boolean(process.env.META_GRAPH_TOKEN && process.env.META_IG_USER_ID);
}

/** Pull the handle out of the canonical `https://www.instagram.com/{handle}/`. */
export function extractInstagramHandle(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'instagram.com') return null;
    const handle = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    return HANDLE_RE.test(handle) ? handle : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Interpret a Business Discovery JSON response. Pure — the network call in
 * `fetchInstagramBusinessProfile` delegates here so parsing is unit-testable.
 */
export function parseBusinessDiscoveryResponse(json: unknown): InstagramGraphResult {
  if (!json || typeof json !== 'object') return fail('bad_response');
  const obj = json as Record<string, unknown>;

  if (obj.error && typeof obj.error === 'object') {
    const code = Number((obj.error as Record<string, unknown>).code);
    if (code === 190) return fail('auth'); // invalid/expired token
    if ([4, 17, 32, 613].includes(code)) return fail('rate_limited');
    // 100 = invalid parameter: username not found or not a Business/Creator account.
    if (code === 100) return fail('not_business_or_not_found');
    return fail('graph_error');
  }

  const bd = obj.business_discovery;
  if (!bd || typeof bd !== 'object') return fail('not_business_or_not_found');
  const d = bd as Record<string, unknown>;

  const rawMedia = (d.media as Record<string, unknown> | undefined)?.data;
  const media: InstagramMedia[] = Array.isArray(rawMedia)
    ? rawMedia.slice(0, MEDIA_LIMIT).map((item) => {
        const m = (item ?? {}) as Record<string, unknown>;
        return {
          caption: asString(m.caption),
          likeCount: asNumber(m.like_count),
          commentsCount: asNumber(m.comments_count),
          timestamp: asString(m.timestamp),
          mediaType: asString(m.media_type),
          permalink: asString(m.permalink),
        };
      })
    : [];

  const profile: InstagramProfile = {
    username: asString(d.username),
    name: asString(d.name),
    biography: asString(d.biography),
    website: asString(d.website),
    followersCount: asNumber(d.followers_count),
    followsCount: asNumber(d.follows_count),
    mediaCount: asNumber(d.media_count),
    media,
  };
  return { ok: true, error: null, profile };
}

/** Fetch structured public data for a Business/Creator handle. Never throws. */
export async function fetchInstagramBusinessProfile(
  handle: string,
): Promise<InstagramGraphResult> {
  const token = process.env.META_GRAPH_TOKEN;
  const igUserId = process.env.META_IG_USER_ID;
  if (!token || !igUserId) return fail('not_configured');
  if (!HANDLE_RE.test(handle)) return fail('invalid_handle');

  const version = process.env.META_GRAPH_API_VERSION || DEFAULT_VERSION;
  const fields =
    `business_discovery.username(${handle})` +
    '{username,name,biography,website,followers_count,follows_count,media_count,' +
    `media.limit(${MEDIA_LIMIT}){caption,like_count,comments_count,timestamp,media_type,permalink}}`;
  const url =
    `${GRAPH_HOST}/${version}/${encodeURIComponent(igUserId)}` +
    `?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Graph returns 200 on success and 400 on error, but both carry a JSON
    // body — parse regardless of status and let the parser classify errors.
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const json = await response.json().catch(() => null);
    if (json === null) return fail('bad_response');
    return parseBusinessDiscoveryResponse(json);
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network';
    return fail(reason);
  } finally {
    clearTimeout(timer);
  }
}

function formatCount(value: number | null): string | null {
  return value == null ? null : value.toLocaleString('pt-BR');
}

/**
 * Turn structured Business Discovery data into a SourceSnapshot with a
 * high-signal excerpt for the AI. Pure — exported for tests.
 */
export function buildInstagramGraphSnapshot(
  url: string,
  profile: InstagramProfile,
): SourceSnapshot {
  const handle = profile.username ? `@${profile.username}` : null;
  const title = profile.name || handle || 'Perfil do Instagram';

  const lines: string[] = [];
  if (profile.biography) lines.push(`Bio: ${profile.biography}`);
  const stats = [
    formatCount(profile.followersCount) &&
      `${formatCount(profile.followersCount)} seguidores`,
    formatCount(profile.followsCount) && `seguindo ${formatCount(profile.followsCount)}`,
    formatCount(profile.mediaCount) && `${formatCount(profile.mediaCount)} posts`,
  ].filter(Boolean);
  if (stats.length) lines.push(stats.join(' · '));
  if (profile.website) lines.push(`Site: ${profile.website}`);
  if (profile.media.length) {
    lines.push('Posts recentes:');
    for (const m of profile.media) {
      const date = m.timestamp ? m.timestamp.slice(0, 10) : '—';
      const caption = (m.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const eng = `❤ ${m.likeCount ?? 0} 💬 ${m.commentsCount ?? 0}`;
      lines.push(`- [${date}] ${caption || '(sem legenda)'} (${eng})`);
    }
  }
  const excerpt = lines.join('\n').slice(0, IG_EXCERPT_CHARS) || null;

  return {
    source: 'instagram',
    url,
    ok: true,
    title,
    description: profile.biography,
    excerpt,
    error: null,
    via: 'api',
  };
}
