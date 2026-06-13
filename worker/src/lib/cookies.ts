import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env } from "../env";
import { SESSION_TTL_MS } from "../domain/sessions";
import { isProdLike } from "./environment";

type AnyAppCtx = Context<AppEnv>;

export function sessionCookieName(env: Env): string {
  return isProdLike(env) ? "__Host-session" : "session";
}

export function setSessionCookie(
  c: AnyAppCtx,
  token: string,
  maxAgeSeconds: number = Math.floor(SESSION_TTL_MS / 1000),
): void {
  setCookie(c, sessionCookieName(c.env), token, {
    httpOnly: true,
    secure: isProdLike(c.env),
    sameSite: "Lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function getSessionToken(c: AnyAppCtx): string | undefined {
  return getCookie(c, sessionCookieName(c.env));
}

export function clearSessionCookie(c: AnyAppCtx): void {
  deleteCookie(c, sessionCookieName(c.env), {
    path: "/",
    secure: isProdLike(c.env),
  });
}
