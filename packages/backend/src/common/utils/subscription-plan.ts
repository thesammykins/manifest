import { parseOAuthTokenBlob } from '../../routing/oauth/core';

const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth';
const SAFE_PLAN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Extract display-only subscription metadata from an OAuth access token.
 * The JWT is deliberately not verified here and must never be used for auth or
 * authorization; the provider already authenticated it when issuing the token.
 */
export function extractSubscriptionPlan(provider: string, rawCredential: string): string | null {
  if (provider.toLowerCase() !== 'openai') return null;
  const token = parseOAuthTokenBlob(rawCredential)?.t ?? rawCredential;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const namespaced = payload[OPENAI_AUTH_CLAIM];
  const nestedPlan =
    namespaced && typeof namespaced === 'object'
      ? (namespaced as Record<string, unknown>)['chatgpt_plan_type']
      : null;
  const value = nestedPlan ?? payload['chatgpt_plan_type'];
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return SAFE_PLAN.test(normalized) ? normalized : null;
}
