import { describe, expect, it } from "vitest";
import { decryptKey, encryptKey } from "../src/lib/keycrypt";

const KEK = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 zero bytes
const OTHER_KEK = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="; // 32 0x01 bytes

describe("keycrypt", () => {
  it("round-trips a secret", async () => {
    const ct = await encryptKey("sk-ant-very-secret", KEK);
    expect(ct).not.toContain("sk-ant");
    expect(await decryptKey(ct, KEK)).toBe("sk-ant-very-secret");
  });

  it("produces a different ciphertext per call (random iv)", async () => {
    const a = await encryptKey("same", KEK);
    const b = await encryptKey("same", KEK);
    expect(a).not.toBe(b);
  });

  it("rejects tampered ciphertext and wrong keys", async () => {
    const ct = await encryptKey("secret", KEK);
    const tampered = ct.slice(0, -4) + (ct.endsWith("AAA=") ? "BBB=" : "AAA=");
    await expect(decryptKey(tampered, KEK)).rejects.toThrow();
    await expect(decryptKey(ct, OTHER_KEK)).rejects.toThrow();
  });

  it("rejects a malformed kek", async () => {
    await expect(encryptKey("x", "not-base64-32-bytes")).rejects.toThrow(/ADVISOR_KEK/);
  });
});
