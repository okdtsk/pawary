import { fetchMock, SELF } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, expect, it } from "vitest";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

it("GET /api/auth/google redirects to Google with state + PKCE", async () => {
  const res = await SELF.fetch("https://app.local/api/auth/google", {
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("Location")!);
  expect(loc.origin).toBe("https://accounts.google.com");
  expect(loc.searchParams.get("client_id")).toBe("test-client-id");
  expect(loc.searchParams.get("redirect_uri")).toBe(
    "https://app.local/api/auth/google/callback",
  );
  expect(loc.searchParams.get("state")).toBeTruthy();
  expect(loc.searchParams.get("code_challenge")).toBeTruthy();
  expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
  expect(res.headers.get("Set-Cookie")).toContain("oauth_state=");
});

it("callback rejects a mismatched state", async () => {
  const start = await SELF.fetch("https://app.local/api/auth/google", {
    redirect: "manual",
  });
  const stateCookie = start.headers.get("Set-Cookie")!.split(";")[0]!;
  const res = await SELF.fetch(
    "https://app.local/api/auth/google/callback?code=abc&state=WRONG",
    { headers: { Cookie: stateCookie }, redirect: "manual" },
  );
  expect(res.status).toBe(400);
});

it("completes the full flow: callback sets a session; /api/me works; logout revokes", async () => {
  // 1. start: capture state + cookie
  const start = await SELF.fetch("https://app.local/api/auth/google", {
    redirect: "manual",
  });
  const loc = new URL(start.headers.get("Location")!);
  const state = loc.searchParams.get("state")!;
  const stateCookie = start.headers.get("Set-Cookie")!.split(";")[0]!;

  // 2. mock Google: token endpoint returns a signed id_token; JWKS serves the key
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const idToken = await new SignJWT({
    email: "pat@example.com",
    name: "Pat",
    picture: "https://lh3.googleusercontent.com/x",
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setSubject("google-sub-1")
    .setIssuer("https://accounts.google.com")
    .setAudience("test-client-id")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

  fetchMock
    .get("https://oauth2.googleapis.com")
    .intercept({ method: "POST", path: "/token" })
    .reply(200, JSON.stringify({ id_token: idToken }), {
      headers: { "Content-Type": "application/json" },
    });
  fetchMock
    .get("https://www.googleapis.com")
    .intercept({ path: "/oauth2/v3/certs" })
    .reply(200, JSON.stringify({ keys: [jwk] }), {
      headers: { "Content-Type": "application/json" },
    });

  // 3. callback → session cookie + redirect to /
  const cb = await SELF.fetch(
    `https://app.local/api/auth/google/callback?code=test-code&state=${state}`,
    { headers: { Cookie: stateCookie }, redirect: "manual" },
  );
  expect(cb.status).toBe(302);
  expect(cb.headers.get("Location")).toBe("/");
  const setCookies = cb.headers.getSetCookie();
  const sessionSet = setCookies.find((v) => v.startsWith("session="));
  expect(sessionSet).toBeTruthy();
  const sessionCookie = sessionSet!.split(";")[0]!;

  // 4. session works
  const me = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: sessionCookie },
  });
  expect(me.status).toBe(200);
  const meBody = (await me.json()) as {
    data: { user: { email: string }; csrfToken: string };
  };
  expect(meBody.data.user.email).toBe("pat@example.com");

  // 5. logout revokes
  const out = await SELF.fetch("https://app.local/api/auth/logout", {
    method: "POST",
    headers: { Cookie: sessionCookie, "X-CSRF-Token": meBody.data.csrfToken },
  });
  expect(out.status).toBe(200);
  const meAfter = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: sessionCookie },
  });
  expect(meAfter.status).toBe(401);
});

it("callback redirects into the spa with auth_error when google reports an error", async () => {
  const res = await SELF.fetch(
    "https://app.local/api/auth/google/callback?error=access_denied&state=whatever",
    { redirect: "manual" },
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/?auth_error=access_denied");
});
