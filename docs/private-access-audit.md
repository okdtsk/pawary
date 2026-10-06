# Private family access and security audit

Production and previews require the `ALLOWED_EMAILS` secret: comma-separated exact Google account emails. Missing configuration fails closed outside `ENVIRONMENT=development`. Google login, preview login, and every existing session check the current list. Keep both family members in the production list; changing it does not delete their records or pet memberships.

Cloudflare Access must protect the Worker tags for both production and preview, with an exact-email allow policy for the family. Worker destinations cover custom domains, workers.dev, and preview URLs. The application allowlist is a second check, including when an existing session is reused. Preview publication is disabled in Wrangler configuration and the preview workflow has been removed.

Before deploying, apply `worker/drizzle/0006_security_audit.sql` and configure the secret. The migration is additive and idempotent; the table/index creation was also applied directly to the production and preview databases. Running Wrangler migrations later remains safe.

`security_audit_events` records authenticated actor ID (or NULL), time, read/write/export/auth classification, a fixed category, and response status. It never receives request/response bodies, cookies, API keys, URL queries, or raw paths containing record IDs. The existing push schedule also removes audit records older than 365 days. Audit database failures emit only `security_audit_write_failed`; they do not fail the user action. This is application audit history, not a tamper-proof external archive.

Use an up-to-date Wrangler that supports `observability.redact_query_string`. Verify the live setting after every deployment; older bundled CLIs warn about and ignore this option. Existing Workers logs are not retroactively redacted.

Example read-only audit query:

```sql
SELECT datetime(occurred_at / 1000, 'unixepoch') AS time_utc,
       actor_id, action, category, operation, status
FROM security_audit_events
ORDER BY occurred_at DESC LIMIT 200;
```

Verify owner and spouse sign-in, both members' existing editor access, anonymous HTML/assets/API redirection to Access, outsider denial, and disabled preview URLs after deployment. Do not infer successful family sign-in solely from an Access policy response.
