import { createRemoteJWKSet, jwtVerify } from "jose";
import { generateToken, sha256Base64url } from "./crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

// Cached across requests within an isolate; jose refreshes keys as needed.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export async function generatePkce(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = generateToken(); // 43-char base64url — valid PKCE verifier
  const challenge = await sha256Base64url(verifier);
  return { verifier, challenge };
}

export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ idToken: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
      code_verifier: params.codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status}`);
  }
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("token response missing id_token");
  return { idToken: json.id_token };
}

export type GoogleClaims = {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
};

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<GoogleClaims> {
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  if (!payload.sub) throw new Error("id_token missing sub");
  const email = typeof payload.email === "string" ? payload.email : "";
  return {
    sub: payload.sub,
    email,
    name: typeof payload.name === "string" ? payload.name : email || "User",
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
