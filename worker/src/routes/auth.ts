import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createSession, deleteSessionByToken } from "../domain/sessions";
import { upsertUserFromGoogle } from "../domain/users";
import type { AppEnv } from "../env";
import {
  clearSessionCookie,
  getSessionToken,
  setSessionCookie,
} from "../lib/cookies";
import { constantTimeEqual, generateToken } from "../lib/crypto";
import { isProdLike } from "../lib/environment";
import {
  buildAuthUrl,
  exchangeCode,
  generatePkce,
  verifyGoogleIdToken,
} from "../lib/oauth";
import { rateLimit } from "../lib/rate-limit";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requireSession } from "../middleware/session";

export const authRoutes = new Hono<AppEnv>();

const STATE_COOKIE = "oauth_state";

function redirectUri(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}/api/auth/google/callback`;
}

authRoutes.get("/google", rateLimit("auth-google", 10, 60_000), async (c) => {
  const state = generateToken();
  const { verifier, challenge } = await generatePkce();
  setCookie(c, STATE_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: isProdLike(c.env),
    sameSite: "Lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return c.redirect(
    buildAuthUrl({
      clientId: c.env.GOOGLE_CLIENT_ID,
      redirectUri: redirectUri(c.req.url),
      state,
      codeChallenge: challenge,
    }),
  );
});

authRoutes.get("/google/callback", rateLimit("auth-callback", 10, 60_000), async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const raw = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });

  // User-facing OAuth failures (consent denied, expired prompt) arrive as a
  // top-level browser navigation — redirect into the SPA with a marker query
  // instead of stranding the user on raw JSON. State mismatches and malformed
  // cookies below stay hard 400s (suspicious, not user-recoverable).
  const oauthError = c.req.query("error");
  if (oauthError !== undefined || !code) {
    return c.redirect(
      `/?auth_error=${encodeURIComponent(oauthError ?? "missing_code")}`,
    );
  }
  if (!state || !raw) {
    return err(c, 400, "oauth_invalid", "Missing OAuth parameters");
  }
  let saved: { state: string; verifier: string };
  try {
    saved = JSON.parse(raw) as { state: string; verifier: string };
  } catch {
    return err(c, 400, "oauth_invalid", "Malformed OAuth state");
  }
  if (!constantTimeEqual(saved.state, state)) {
    return err(c, 400, "oauth_invalid", "OAuth state mismatch");
  }

  const { idToken } = await exchangeCode({
    code,
    clientId: c.env.GOOGLE_CLIENT_ID,
    clientSecret: c.env.GOOGLE_CLIENT_SECRET,
    redirectUri: redirectUri(c.req.url),
    codeVerifier: saved.verifier,
  });
  const claims = await verifyGoogleIdToken(idToken, c.env.GOOGLE_CLIENT_ID);

  const db = drizzle(c.env.DB);
  const user = await upsertUserFromGoogle(db, claims);
  const { token } = await createSession(db, user.id);
  setSessionCookie(c, token);
  return c.redirect("/");
});

authRoutes.post("/logout", requireSession, requireCsrf, async (c) => {
  const token = getSessionToken(c);
  if (token) {
    await deleteSessionByToken(drizzle(c.env.DB), token);
  }
  clearSessionCookie(c);
  return c.json({ data: { ok: true } });
});

authRoutes.post("/dev-login", rateLimit("auth-dev-login", 10, 60_000), async (c) => {
  const host = new URL(c.req.url).hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  if (c.env.ENVIRONMENT !== "development" || !isLocalhost) {
    return err(c, 404, "not_found", "Not found");
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
  };
  const email = body.email ?? "dev@example.com";
  const name = body.name ?? "Dev User";

  const db = drizzle(c.env.DB);
  const user = await upsertUserFromGoogle(db, {
    sub: `dev:${email}`,
    email,
    name,
    picture: null,
  });
  const { token } = await createSession(db, user.id);
  setSessionCookie(c, token);
  return c.json({ data: { ok: true } });
});
