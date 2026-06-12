import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  encryptPayload,
  encryptWithKeys,
  sendPush,
  VAPID_SUBJECT,
  vapidHeaders,
} from "../src/lib/webpush";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

function b64uDecode(s: string): Uint8Array {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** RFC 8291 Appendix A — official test vector (do NOT modify these values). */
const VECTOR = {
  plaintext: "When I grow up, I want to be a watermelon",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

async function importEcdhPrivate(
  privateB64u: string,
  publicB64u: string,
): Promise<CryptoKey> {
  const pub = b64uDecode(publicB64u);
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: privateB64u,
      x: b64uEncode(pub.slice(1, 33)),
      y: b64uEncode(pub.slice(33, 65)),
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      key,
      length * 8,
    ),
  );
}

/** Independent decryptor (user-agent side of RFC 8291) used to verify the random path. */
async function decryptBody(
  body: Uint8Array,
  uaPrivateB64u: string,
  uaPublicB64u: string,
  authB64u: string,
): Promise<{ plaintext: string; rs: number; idlen: number }> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20] ?? 0;
  const asPublicBytes = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const uaPrivate = await importEcdhPrivate(uaPrivateB64u, uaPublicB64u);
  const asPublic = await crypto.subtle.importKey(
    "raw",
    asPublicBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: asPublic } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      uaPrivate,
      256,
    ),
  );
  const te = new TextEncoder();
  const keyInfo = new Uint8Array([
    ...te.encode("WebPush: info\0"),
    ...b64uDecode(uaPublicB64u),
    ...asPublicBytes,
  ]);
  const ikm = await hkdf(b64uDecode(authB64u), ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext),
  );
  if (record[record.length - 1] !== 0x02) {
    throw new Error("missing last-record delimiter");
  }
  return {
    plaintext: new TextDecoder().decode(record.slice(0, -1)),
    rs,
    idlen,
  };
}

describe("encryptWithKeys (RFC 8291 Appendix A vector)", () => {
  it("produces the official expected message body byte-exact", async () => {
    const asPrivate = await importEcdhPrivate(VECTOR.asPrivate, VECTOR.asPublic);
    const asPublic = await crypto.subtle.importKey(
      "raw",
      b64uDecode(VECTOR.asPublic),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    );
    const body = await encryptWithKeys(
      VECTOR.plaintext,
      VECTOR.uaPublic,
      VECTOR.authSecret,
      { privateKey: asPrivate, publicKey: asPublic },
      b64uDecode(VECTOR.salt),
    );
    expect(b64uEncode(body)).toBe(VECTOR.body);
  });
});

describe("encryptPayload", () => {
  it("encrypts with a random ephemeral key/salt that the user agent can decrypt", async () => {
    const payload = '{"title":"Mochi","body":"Food is due","url":"/health"}';
    const body = await encryptPayload(payload, VECTOR.uaPublic, VECTOR.authSecret);
    // header(16+4+1+65) + record(payload+delimiter) + GCM tag(16)
    expect(body.length).toBe(86 + payload.length + 1 + 16);
    const decrypted = await decryptBody(
      body,
      VECTOR.uaPrivate,
      VECTOR.uaPublic,
      VECTOR.authSecret,
    );
    expect(decrypted.plaintext).toBe(payload);
    expect(decrypted.rs).toBe(4096);
    expect(decrypted.idlen).toBe(65);
  });

  it("produces a different body each call (random salt + ephemeral key)", async () => {
    const a = await encryptPayload("x", VECTOR.uaPublic, VECTOR.authSecret);
    const b = await encryptPayload("x", VECTOR.uaPublic, VECTOR.authSecret);
    expect(b64uEncode(a)).not.toBe(b64uEncode(b));
  });

  it("rejects an invalid auth secret length", async () => {
    await expect(
      encryptPayload("x", VECTOR.uaPublic, "AAAA"),
    ).rejects.toThrow();
  });
});

describe("vapidHeaders", () => {
  it("emits a vapid Authorization header with a verifiable ES256 JWT", async () => {
    const origin = "https://push.example";
    const before = Math.floor(Date.now() / 1000);
    const { Authorization } = await vapidHeaders(
      origin,
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(Authorization);
    expect(match).not.toBeNull();
    const jwt = match?.[1] ?? "";
    const k = match?.[2] ?? "";
    expect(k).toBe(env.VAPID_PUBLIC_KEY);

    const [h = "", c = "", s = ""] = jwt.split(".");
    expect(h && c && s).toBeTruthy();
    const header = JSON.parse(new TextDecoder().decode(b64uDecode(h)));
    expect(header).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(new TextDecoder().decode(b64uDecode(c)));
    expect(claims.aud).toBe(origin);
    expect(claims.sub).toBe(VAPID_SUBJECT);
    expect(claims.exp).toBeGreaterThanOrEqual(before + 12 * 3600);
    expect(claims.exp).toBeLessThanOrEqual(before + 12 * 3600 + 60);

    const verifyKey = await crypto.subtle.importKey(
      "raw",
      b64uDecode(env.VAPID_PUBLIC_KEY),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      b64uDecode(s),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it("rejects a malformed public key", async () => {
    await expect(
      vapidHeaders("https://push.example", "AAAA", env.VAPID_PRIVATE_KEY),
    ).rejects.toThrow();
  });
});

describe("sendPush", () => {
  const SUB = {
    endpoint: "https://push.example/sub1",
    p256dh: VECTOR.uaPublic,
    auth: VECTOR.authSecret,
  };
  const PUSH_ENV = {
    VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
  };

  function headerOf(headers: unknown, name: string): string | undefined {
    if (Array.isArray(headers)) {
      for (let i = 0; i < headers.length; i += 2) {
        if (String(headers[i]).toLowerCase() === name) return String(headers[i + 1]);
      }
      return undefined;
    }
    const obj = headers as Record<string, string>;
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() === name) return obj[key];
    }
    return undefined;
  }

  it("POSTs the encrypted body with web push headers and returns the status", async () => {
    let captured: { headers?: unknown; body?: unknown } | undefined;
    fetchMock
      .get("https://push.example")
      .intercept({ path: "/sub1", method: "POST" })
      .reply(201, (opts) => {
        captured = opts as { headers?: unknown; body?: unknown };
        return "";
      });
    const status = await sendPush(SUB, '{"title":"x"}', PUSH_ENV);
    expect(status).toBe(201);
    expect(captured).toBeDefined();
    expect(headerOf(captured?.headers, "ttl")).toBe("300");
    expect(headerOf(captured?.headers, "content-encoding")).toBe("aes128gcm");
    expect(headerOf(captured?.headers, "urgency")).toBe("normal");
    expect(headerOf(captured?.headers, "authorization")).toMatch(/^vapid t=.+, k=.+$/);
    expect(captured?.body).toBeTruthy();
  });

  it("passes through non-success statuses (410 gone)", async () => {
    fetchMock
      .get("https://push.example")
      .intercept({ path: "/sub1", method: "POST" })
      .reply(410, "");
    const status = await sendPush(SUB, '{"title":"x"}', PUSH_ENV);
    expect(status).toBe(410);
  });
});
