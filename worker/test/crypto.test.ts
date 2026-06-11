import { describe, expect, it } from "vitest";
import { constantTimeEqual, generateToken, sha256Hex } from "../src/lib/crypto";

describe("generateToken", () => {
  it("returns a 43-char base64url string, unique per call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe("sha256Hex", () => {
  it("hashes deterministically to 64 hex chars", async () => {
    const h1 = await sha256Hex("hello");
    const h2 = await sha256Hex("hello");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("constantTimeEqual", () => {
  it("compares correctly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
