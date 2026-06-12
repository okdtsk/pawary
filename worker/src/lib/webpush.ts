/**
 * In-house Web Push sender: VAPID (RFC 8292) ES256 JWT + RFC 8291 payload
 * encryption (aes128gcm content coding, RFC 8188). WebCrypto only.
 */

export const VAPID_SUBJECT = "mailto:okdtsk@gmail.com";

const VAPID_EXPIRY_SECONDS = 12 * 3600;
const RECORD_SIZE = 4096;
const PUSH_TTL_SECONDS = 300;

const encoder = new TextEncoder();

function b64uDecode(s: string): Uint8Array {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/");
  let bin: string;
  try {
    bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  } catch {
    throw new Error("invalid base64url input");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function decodeUncompressedP256(b64u: string, label: string): Uint8Array {
  const bytes = b64uDecode(b64u);
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error(`${label} must be a 65-byte uncompressed P-256 point`);
  }
  return bytes;
}

/** One HKDF-SHA256 extract+expand (WebCrypto HKDF combines both). */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Build the `Authorization: vapid t=<jwt>, k=<key>` header for a push service
 * origin. The ES256 signing key is reassembled from the env keypair (JWK needs
 * x/y, taken from the uncompressed public point).
 */
export async function vapidHeaders(
  endpointOrigin: string,
  publicKeyB64u: string,
  privateKeyB64u: string,
): Promise<{ Authorization: string }> {
  const publicBytes = decodeUncompressedP256(publicKeyB64u, "VAPID public key");
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: privateKeyB64u,
      x: b64uEncode(publicBytes.slice(1, 33)),
      y: b64uEncode(publicBytes.slice(33, 65)),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64uEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64uEncode(
    encoder.encode(
      JSON.stringify({
        aud: endpointOrigin,
        exp: Math.floor(Date.now() / 1000) + VAPID_EXPIRY_SECONDS,
        sub: VAPID_SUBJECT,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  // WebCrypto ECDSA emits the raw r||s (64-byte) signature JWS expects.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      encoder.encode(signingInput),
    ),
  );
  return {
    Authorization: `vapid t=${signingInput}.${b64uEncode(signature)}, k=${publicKeyB64u}`,
  };
}

/**
 * RFC 8291 encryption with caller-provided application-server keys and salt.
 * Internal seam so tests can drive it with the Appendix A vector;
 * production callers use `encryptPayload`.
 */
export async function encryptWithKeys(
  payload: string,
  p256dhB64u: string,
  authB64u: string,
  asKeys: { privateKey: CryptoKey; publicKey: CryptoKey },
  salt: Uint8Array,
): Promise<Uint8Array> {
  const uaPublicBytes = decodeUncompressedP256(p256dhB64u, "p256dh");
  const authSecret = b64uDecode(authB64u);
  if (authSecret.length !== 16) {
    throw new Error("auth secret must be 16 bytes");
  }
  if (salt.length !== 16) {
    throw new Error("salt must be 16 bytes");
  }

  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublicBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const asPublicBytes = new Uint8Array(
    (await crypto.subtle.exportKey("raw", asKeys.publicKey)) as ArrayBuffer,
  );
  // workers-types names the ECDH peer-key field `$public`, but the runtime
  // property is `public` — cast through unknown to satisfy both.
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaPublicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      asKeys.privateKey,
      256,
    ),
  );

  // RFC 8291 §3.3–3.4: IKM = HKDF(salt=auth_secret, ecdh_secret, key_info, 32)
  const keyInfo = concat(encoder.encode("WebPush: info\0"), uaPublicBytes, asPublicBytes);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  // RFC 8188 §2.2–2.3: CEK and nonce from HKDF(salt, IKM, ...)
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  // Single record: plaintext || 0x02 last-record delimiter (no extra padding).
  const record = concat(encoder.encode(payload), Uint8Array.of(0x02));
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record),
  );

  // Coded header: salt(16) || rs(4, BE) || idlen(1) || keyid(as_public, 65)
  const header = new Uint8Array(16 + 4 + 1 + asPublicBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublicBytes.length;
  header.set(asPublicBytes, 21);
  return concat(header, ciphertext);
}

/** RFC 8291 aes128gcm encryption with a fresh ephemeral keypair and salt. */
export async function encryptPayload(
  payload: string,
  p256dhB64u: string,
  authB64u: string,
): Promise<Uint8Array> {
  const asKeys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return encryptWithKeys(payload, p256dhB64u, authB64u, asKeys, salt);
}

/** Encrypt and POST a push message; returns the push service HTTP status. */
export async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  env: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string },
): Promise<number> {
  const body = await encryptPayload(payload, sub.p256dh, sub.auth);
  const { Authorization } = await vapidHeaders(
    new URL(sub.endpoint).origin,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization,
      TTL: String(PUSH_TTL_SECONDS),
      "Content-Encoding": "aes128gcm",
      Urgency: "normal",
      "Content-Type": "application/octet-stream",
    },
    body,
  });
  // Drain the response so the connection is released; never read push bodies.
  await res.body?.cancel();
  return res.status;
}
