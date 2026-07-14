import { NextResponse, after } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadAiConfig } from '@/lib/ai/config';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/leads/admin-client';
import {
  isScraperConfigured,
  runProfileAudit,
  type AuditSource,
} from '@/lib/leads/profile-audit';

// The audit scrapes 4 sources + several competitors + two AI calls, which
// takes 1-3 min. We respond 202 immediately and run the work in `after()`,
// which keeps executing within this route's max duration.
export const maxDuration = 300;

const SOURCES: AuditSource[] = ['instagram', 'website', 'linkedin', 'google_maps'];

interface AuditBody {
  contact_id?: unknown;
  urls?: Record<string, unknown>;
  segmento?: unknown;
  cidade?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request) {
  let ctx;
  try {
    // Explicit agent gate: the background work runs under the service role
    // (bypassing RLS), and 'agent' matches the contact_notes insert policy.
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  const { userId, accountId, supabase } = ctx;

  // Rate limits: per user, per account, and a single-flight guard per contact.
  const userLimit = checkRateLimit(`profile-audit:${userId}`, RATE_LIMITS.profileAudit);
  if (!userLimit.success) return rateLimitResponse(userLimit);
  const accountLimit = checkRateLimit(
    `profile-audit-account:${accountId}`,
    RATE_LIMITS.profileAuditAccount,
  );
  if (!accountLimit.success) return rateLimitResponse(accountLimit);

  let body: AuditBody;
  try {
    body = (await request.json()) as AuditBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const contactId = str(body.contact_id);
  if (!contactId) {
    return NextResponse.json({ error: 'contact_id é obrigatório' }, { status: 400 });
  }

  // Confirm the contact is in the caller's account (RLS-scoped select).
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .maybeSingle();
  if (contactError || !contact) {
    return NextResponse.json({ error: 'Contato não encontrado' }, { status: 404 });
  }

  // Preflight — fail fast before we return 202 and schedule the work.
  if (!isScraperConfigured()) {
    return NextResponse.json(
      { error: 'Serviço de análise de perfil não configurado. Inicie o scraper (npm run scraper:up).' },
      { status: 503 },
    );
  }
  const admin = supabaseAdmin();
  const aiConfig = await loadAiConfig(admin, accountId).catch(() => null);
  if (!aiConfig) {
    return NextResponse.json(
      { error: 'Configure o assistente de IA em Configurações antes de analisar perfis.' },
      { status: 409 },
    );
  }

  // Single-flight per contact: only claim the slot once we know we'll run.
  const contactLimit = checkRateLimit(
    `profile-audit-contact:${contactId}`,
    RATE_LIMITS.profileAuditContact,
  );
  if (!contactLimit.success) {
    return NextResponse.json(
      { error: 'Já existe uma auditoria em andamento para este contato.' },
      { status: 429 },
    );
  }

  // Collect overrides from the request body (optional).
  const urlOverrides: Partial<Record<AuditSource, string>> = {};
  if (body.urls && typeof body.urls === 'object') {
    for (const source of SOURCES) {
      const value = str(body.urls[source]);
      if (value) urlOverrides[source] = value;
    }
  }
  const overrides = {
    urls: Object.keys(urlOverrides).length ? urlOverrides : undefined,
    segmento: str(body.segmento),
    cidade: str(body.cidade),
  };

  after(async () => {
    try {
      await runProfileAudit({ db: admin, accountId, userId, contactId, overrides });
    } catch (error) {
      console.error(
        '[profile-audit route] audit failed:',
        error instanceof Error ? error.message : error,
      );
    }
  });

  return NextResponse.json({ started: true }, { status: 202 });
}
