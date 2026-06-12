import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "../src/lib/pushClient";

// A real uncompressed ECDH P-256 public key is 65 bytes.
// base64url of 65 zero bytes (87 chars, no padding needed since 65*4/3 rounds to 87).
const ZEROES_65_B64URL =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("urlBase64ToUint8Array", () => {
  it("produces the expected length for a 65-byte VAPID key", () => {
    const result = urlBase64ToUint8Array(ZEROES_65_B64URL);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(65);
  });

  it("round-trips a known base64url string", () => {
    // "hello world" in base64url = "aGVsbG8gd29ybGQ"
    const result = urlBase64ToUint8Array("aGVsbG8gd29ybGQ");
    const decoded = String.fromCharCode(...result);
    expect(decoded).toBe("hello world");
  });

  it("handles URL-safe characters (- and _) correctly", () => {
    // Standard base64 of 3 bytes [0xfb, 0xff, 0xfe] is "+//+"
    // URL-safe base64 of the same bytes is "-__-"
    const result = urlBase64ToUint8Array("-__-");
    expect(result[0]).toBe(0xfb);
    expect(result[1]).toBe(0xff);
    expect(result[2]).toBe(0xfe);
  });

  it("handles missing padding gracefully", () => {
    // base64url of [0x01] without padding is "AQ"
    const result = urlBase64ToUint8Array("AQ");
    expect(result.length).toBe(1);
    expect(result[0]).toBe(0x01);
  });

  it("handles already-padded input without double-padding", () => {
    // base64url of [0x01] with padding is "AQ=="
    const result = urlBase64ToUint8Array("AQ==");
    expect(result.length).toBe(1);
    expect(result[0]).toBe(0x01);
  });
});
