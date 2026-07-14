const FALLBACK_AGENT_NAME = 'Atendente';

export function resolveAgentDisplayName(
  fullName?: string | null,
  email?: string | null
): string {
  const profileName = fullName?.replace(/\s+/g, ' ').replace(/\*/g, '').trim();
  if (profileName) return profileName;

  const emailName = email
    ?.split('@')[0]
    ?.replace(/\s+/g, ' ')
    .replace(/\*/g, '')
    .trim();
  return emailName || FALLBACK_AGENT_NAME;
}

export function applyAgentSignature(
  content: string | null | undefined,
  agentName: string
): string | null | undefined {
  if (!content) return content;
  return `*${agentName}:*\n${content}`;
}
