/**
 * AES-GCM-256 encryption for BYO provider API keys at rest.
 * Wire format: base64( iv(12 bytes) ‖ ciphertext+tag ).
 * The KEK comes from the ADVISOR_KEK secret (32-byte base64).
 */

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function importKek(kekBase64: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = b64decode(kekBase64);
  } catch {
    throw new Error("ADVISOR_KEK is not valid base64");
  }
  if (raw.length !== 32) {
    throw new Error("ADVISOR_KEK must decode to exactly 32 bytes");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptKey(plaintext: string, kekBase64: string): Promise<string> {
  const key = await importKek(kekBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv);
  packed.set(ct, iv.length);
  return b64encode(packed);
}

export async function decryptKey(packedBase64: string, kekBase64: string): Promise<string> {
  const key = await importKek(kekBase64);
  const packed = b64decode(packedBase64);
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
