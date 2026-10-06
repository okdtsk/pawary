import type { Env } from '../env';

/** A missing allowlist never makes production or previews public. */
export function isAllowedEmail(env: Pick<Env, 'ALLOWED_EMAILS' | 'ENVIRONMENT'>, email: string): boolean {
  const allowed = (env.ALLOWED_EMAILS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return env.ENVIRONMENT === 'development';
  return allowed.includes(email.trim().toLowerCase());
}
