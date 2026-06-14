import { describe, expect, it } from "vitest";
import { normalizeImageForUpload } from "../src/lib/image";

describe("normalizeImageForUpload", () => {
  it("returns the original file when the browser cannot process it (no canvas)", async () => {
    // node test env has no createImageBitmap/document → graceful fallback
    const file = new File([new Uint8Array([1, 2, 3])], "photo.heic", {
      type: "image/heic",
    });
    const out = await normalizeImageForUpload(file);
    expect(out).toBe(file);
  });

  it("returns the original file for non-image inputs", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "notes.txt", {
      type: "text/plain",
    });
    const out = await normalizeImageForUpload(file);
    expect(out).toBe(file);
  });
});
