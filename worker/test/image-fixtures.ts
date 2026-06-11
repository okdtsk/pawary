// Hand-crafted minimal image byte fixtures for image.ts tests and photo
// route tests. All fixtures decode as 120x80.

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u16le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function ascii(s: string): number[] {
  return [...s].map((ch) => ch.charCodeAt(0));
}

export function buildJpeg(opts: { withExif?: boolean } = {}): Uint8Array {
  const bytes: number[] = [0xff, 0xd8]; // SOI
  if (opts.withExif ?? true) {
    const payload = [...ascii("Exif"), 0, 0, 0x12, 0x34, 0x56, 0x78];
    bytes.push(0xff, 0xe1, ...u16be(payload.length + 2), ...payload); // APP1
  }
  const dqt = [0, ...Array<number>(64).fill(1)];
  bytes.push(0xff, 0xdb, ...u16be(dqt.length + 2), ...dqt); // DQT (must survive)
  const sof0 = [8, ...u16be(80), ...u16be(120), 1, 0x11, 0x11, 0]; // h=80 w=120
  bytes.push(0xff, 0xc0, ...u16be(sof0.length + 2), ...sof0);
  const sos = [1, 0x11, 0, 0, 63, 0];
  bytes.push(0xff, 0xda, ...u16be(sos.length + 2), ...sos);
  bytes.push(0xaa, 0xbb, 0xcc); // fake entropy-coded data
  bytes.push(0xff, 0xd9); // EOI
  return new Uint8Array(bytes);
}

export function buildPng(opts: { withText?: boolean } = {}): Uint8Array {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[]): number[] => [
    ...u32be(data.length),
    ...ascii(type),
    ...data,
    0, 0, 0, 0, // fake CRC (never validated)
  ];
  const ihdr = [...u32be(120), ...u32be(80), 8, 6, 0, 0, 0]; // w=120 h=80
  bytes.push(...chunk("IHDR", ihdr));
  if (opts.withText ?? true) {
    bytes.push(...chunk("tEXt", [...ascii("Comment"), 0, ...ascii("gps secret")]));
  }
  bytes.push(...chunk("IDAT", [1, 2, 3, 4]));
  bytes.push(...chunk("IEND", []));
  return new Uint8Array(bytes);
}

function webpChunk(cc: string, data: number[]): number[] {
  const out = [...ascii(cc), ...u32le(data.length), ...data];
  if (data.length % 2 === 1) out.push(0); // 2-byte alignment padding
  return out;
}

function riff(body: number[]): Uint8Array {
  return new Uint8Array([
    ...ascii("RIFF"),
    ...u32le(4 + body.length), // "WEBP" + chunks
    ...ascii("WEBP"),
    ...body,
  ]);
}

/** Extended (VP8X) WebP, EXIF+XMP flags set, optional EXIF chunk. */
export function buildWebp(opts: { withExif?: boolean } = {}): Uint8Array {
  const body: number[] = [];
  // VP8X data: flags, 3 reserved, width-1 (24le), height-1 (24le)
  body.push(...webpChunk("VP8X", [0x0c, 0, 0, 119, 0, 0, 79, 0, 0, 0]));
  if (opts.withExif ?? true) {
    body.push(...webpChunk("EXIF", [1, 2, 3, 4, 5])); // odd size → padded
  }
  body.push(
    ...webpChunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(120), ...u16le(80)]),
  );
  return riff(body);
}

/** Simple lossy WebP: a lone VP8 chunk, no VP8X. */
export function buildWebpLossy(): Uint8Array {
  return riff(
    webpChunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(120), ...u16le(80)]),
  );
}

/** Simple lossless WebP: a lone VP8L chunk. */
export function buildWebpLossless(): Uint8Array {
  // bits 0-13 = width-1 = 119, bits 14-27 = height-1 = 79
  const bits = 119 | (79 << 14);
  return riff(webpChunk("VP8L", [0x2f, ...u32le(bits)]));
}

export function buildGif(): Uint8Array {
  return new Uint8Array([...ascii("GIF89a"), 1, 0, 1, 0, 0, 0, 0]);
}

export function containsSeq(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
