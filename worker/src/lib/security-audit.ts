export const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export type SecurityAuditEvent = {
  actorId: string | null;
  action: 'read' | 'write' | 'export' | 'auth' | 'mcp_tool';
  category: string;
  operation?: string;
  status: number;
};

/** Only caller-selected metadata enters the table; never a Request or payload. */
export async function recordSecurityAudit(db: D1Database, event: SecurityAuditEvent): Promise<void> {
  try {
    await db.prepare('INSERT INTO security_audit_events (id, occurred_at, actor_id, action, category, operation, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), Date.now(), event.actorId, event.action, event.category, event.operation ?? null, event.status).run();
  } catch {
    // Do not log database errors, request URLs, headers, arguments, or returned data.
    console.error({ event: 'security_audit_write_failed' });
  }
}

export async function purgeSecurityAudit(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM security_audit_events WHERE occurred_at < ?')
    .bind(now - AUDIT_RETENTION_MS).run();
}

const categories = new Set(['me', 'exercises', 'templates', 'workouts', 'meals', 'sleep', 'measurements', 'trends', 'ai', 'account', 'pets', 'activities', 'photos', 'presets', 'schedules', 'insights', 'members', 'invites', 'advisor', 'push', 'audit']);

export function auditClassification(path: string, method: string): Pick<SecurityAuditEvent, 'action' | 'category'> | null {
  if (path === '/authorize' || path.startsWith('/auth/') || path.startsWith('/api/auth/')) {
    return { action: 'auth', category: 'authentication' };
  }
  if (!path.startsWith('/api/') || path === '/api/health') return null;
  const parts = path.split('/').filter(Boolean).slice(1);
  if (parts.includes('export')) return { action: 'export', category: 'export' };
  const category = [...parts].reverse().find(x => categories.has(x)) ?? 'unmatched';
  return { action: method === 'GET' || method === 'HEAD' ? 'read' : 'write', category };
}
