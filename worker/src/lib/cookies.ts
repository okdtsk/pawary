import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env } from "../env";
import { SESSION_TTL_MS } from "../domain/sessions";

type AnyAppCtx = Context<AppEnv>;

export function sessionCookieName(env: Env): string {
  return env.ENVIRONMENT === "production" ? "__Host-session" : "session";
}

export function setSessionCookie(c: AnyAppCtx, token: string): void {
  setCookie(c, sessionCookieName(c.env), token, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function getSessionToken(c: AnyAppCtx): string | undefined {
  return getCookie(c, sessionCookieName(c.env));
}

export function clearSessionCookie(c: AnyAppCtx): void {
  deleteCookie(c, sessionCookieName(c.env), { path: "/" });
}
