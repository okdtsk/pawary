import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireSession } from '../src/middleware/session';
import type { AppEnv, Env } from '../src/env';
import { seedUserWithSession } from './helpers';

const app = new Hono<AppEnv>().use(requireSession).get('/', c => c.json({ userId: c.get('user').id }));
describe('private access for existing sessions', () => {
  it('denies a valid session for a user outside the configured allowlist', async () => {
    const user = await seedUserWithSession({ email: 'outside@example.com' });
    const res = await app.request('http://localhost/', { headers: { Cookie: user.cookie } }, { ...env, ALLOWED_EMAILS: 'owner@example.com,wife@example.com' } as Env);
    expect(res.status).toBe(403);
  });
  it('keeps the wife account authorized', async () => {
    const user = await seedUserWithSession({ email: 'wife@example.com' });
    const res = await app.request('http://localhost/', { headers: { Cookie: user.cookie } }, { ...env, ALLOWED_EMAILS: 'owner@example.com,wife@example.com' } as Env);
    expect(res.status).toBe(200);
  });
  it('fails closed when the production allowlist is missing', async () => {
    const user = await seedUserWithSession({ email: 'owner@example.com' });
    const res = await app.request('https://example.com/', { headers: { Cookie: user.cookie.replace(/^session=/, '__Host-session=') } }, { ...env, ENVIRONMENT: 'production', ALLOWED_EMAILS: undefined } as Env);
    expect(res.status).toBe(403);
  });
});
