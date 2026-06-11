import { describe, expect, it } from "vitest";
import {
  imageDimensions,
  sniffImage,
  stripImageMetadata,
} from "../src/lib/image";
import {
  buildGif,
  buildJpeg,
  buildPng,
  buildWebp,
  buildWebpLossless,
  buildWebpLossy,
  containsSeq,
} from "./image-fixtures";

describe("sniffImage", () => {
  it("recognizes jpeg, png, and webp by magic bytes", () => {
    expect(sniffImage(buildJpeg())).toBe("image/jpeg");
    expect(sniffImage(buildPng())).toBe("image/png");
    expect(sniffImage(buildWebp())).toBe("image/webp");
  });

  it("rejects gif, truncated, and empty inputs", () => {
    expect(sniffImage(buildGif())).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull(); // jpeg needs 3
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("jpeg", () => {
  it("strips the APP1 segment but keeps DQT, SOF, SOS, and entropy data", () => {
    const original = buildJpeg();
    const stripped = stripImageMetadata(original, "image/jpeg");
    expect(stripped.length).toBe(original.length - 14); // APP1: 2+2+10 bytes
    expect(containsSeq(stripped, [0xff, 0xe1])).toBe(false);
    expect(containsSeq(stripped, [0x45, 0x78, 0x69, 0x66])).toBe(false); // "Exif"
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    expect(containsSeq(stripped, [0xff, 0xdb])).toBe(true); // DQT survives
    // trailing entropy data + EOI intact
    expect([...stripped.slice(-5)]).toEqual([0xaa, 0xbb, 0xcc, 0xff, 0xd9]);
  });

  it("is a no-op on an already-clean jpeg (idempotent)", () => {
    const clean = buildJpeg({ withExif: false });
    expect([...stripImageMetadata(clean, "image/jpeg")]).toEqual([...clean]);
  });

  it("reads dimensions from SOF0, before and after stripping", () => {
    const original = buildJpeg();
    expect(imageDimensions(original, "image/jpeg")).toEqual({
      width: 120,
      height: 80,
    });
    const stripped = stripImageMetadata(original, "image/jpeg");
    expect(imageDimensions(stripped, "image/jpeg")).toEqual({
      width: 120,
      height: 80,
    });
  });
});

describe("png", () => {
  it("strips tEXt but keeps IHDR, IDAT, IEND byte-for-byte", () => {
    const original = buildPng();
    const stripped = stripImageMetadata(original, "image/png");
    expect(containsSeq(stripped, [0x74, 0x45, 0x58, 0x74])).toBe(false); // "tEXt"
    expect(
      containsSeq(stripped, [...("gps secret".split("").map((c) => c.charCodeAt(0)))]),
    ).toBe(false);
    for (const type of ["IHDR", "IDAT", "IEND"]) {
      expect(
        containsSeq(stripped, [...type].map((c) => c.charCodeAt(0))),
      ).toBe(true);
    }
    // signature intact
    expect([...stripped.slice(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("is idempotent and reads IHDR dimensions", () => {
    const clean = buildPng({ withText: false });
    expect([...stripImageMetadata(clean, "image/png")]).toEqual([...clean]);
    expect(imageDimensions(clean, "image/png")).toEqual({
      width: 120,
      height: 80,
    });
  });
});

describe("webp", () => {
  it("drops the EXIF chunk, fixes the RIFF size, clears VP8X flags", () => {
    const original = buildWebp();
    const stripped = stripImageMetadata(original, "image/webp");
    expect(containsSeq(stripped, [0x45, 0x58, 0x49, 0x46])).toBe(false); // "EXIF"
    // RIFF size field == total length - 8
    const riffSize =
      stripped[4]! |
      (stripped[5]! << 8) |
      (stripped[6]! << 16) |
      (stripped[7]! << 24);
    expect(riffSize).toBe(stripped.length - 8);
    // VP8X EXIF (0x08) and XMP (0x04) flag bits cleared
    expect(stripped[20]! & 0x0c).toBe(0);
    // pixel chunk survives
    expect(containsSeq(stripped, [0x56, 0x50, 0x38, 0x20])).toBe(true); // "VP8 "
  });

  it("is idempotent on a clean file", () => {
    const clean = stripImageMetadata(buildWebp(), "image/webp");
    expect([...stripImageMetadata(clean, "image/webp")]).toEqual([...clean]);
  });

  it("reads dimensions from VP8X, VP8, and VP8L", () => {
    expect(imageDimensions(buildWebp(), "image/webp")).toEqual({
      width: 120,
      height: 80,
    });
    expect(imageDimensions(buildWebpLossy(), "image/webp")).toEqual({
      width: 120,
      height: 80,
    });
    expect(imageDimensions(buildWebpLossless(), "image/webp")).toEqual({
      width: 120,
      height: 80,
    });
  });
});

it("dimension parsers return null on garbage rather than throwing", () => {
  const junk = new Uint8Array(64).fill(0x42);
  expect(imageDimensions(junk, "image/jpeg")).toBeNull();
  expect(imageDimensions(junk, "image/png")).toBeNull();
  expect(imageDimensions(junk, "image/webp")).toBeNull();
});
