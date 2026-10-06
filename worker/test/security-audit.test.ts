import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { seedUserWithSession } from './helpers';

it('records reads without copying query strings or session credentials', async () => {
  await env.DB.exec('CREATE TABLE IF NOT EXISTS security_audit_events (id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, actor_id TEXT, action TEXT NOT NULL, category TEXT NOT NULL, operation TEXT, status INTEGER NOT NULL)');
  const { userId, cookie } = await seedUserWithSession();
  const res = await SELF.fetch('http://localhost/api/me?token=never-log-this', { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const rows = await env.DB.prepare('SELECT * FROM security_audit_events').all();
  expect(rows.results).toHaveLength(1);
  expect(rows.results[0]).toMatchObject({ actor_id: userId, action: 'read', category: 'me', status: 200 });
  expect(JSON.stringify(rows.results)).not.toContain('never-log-this');
  expect(JSON.stringify(rows.results)).not.toContain(cookie);
});
