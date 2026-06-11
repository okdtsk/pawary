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
import {
  buildAuthUrl,
  exchangeCode,
  generatePkce,
  verifyGoogleIdToken,
} from "../lib/oauth";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requireSession } from "../middleware/session";

export const authRoutes = new Hono<AppEnv>();

const STATE_COOKIE = "oauth_state";

function redirectUri(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}/api/auth/google/callback`;
}

authRoutes.get("/google", async (c) => {
  const state = generateToken();
  const { verifier, challenge } = await generatePkce();
  setCookie(c, STATE_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === "production",
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

authRoutes.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const raw = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });

  if (!code || !state || !raw) {
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
