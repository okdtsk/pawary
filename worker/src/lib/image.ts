// Pure-JS image handling for Workers (no native codec available).
// Strips metadata WITHOUT re-encoding:
//   JPEG: drops APP1/APP2 segments (EXIF/GPS/XMP/ICC live there).
//   PNG:  drops eXIf/tEXt/zTXt/iTXt chunks. Retained chunks keep their
//         original bytes, so their CRCs remain valid.
//   WebP: drops EXIF/"XMP " RIFF chunks, recomputes the RIFF size field,
//         and clears the VP8X EXIF/XMP flag bits.
// Malformed input is handled conservatively: the unparseable remainder is
// kept verbatim (the upload was already magic-byte-sniffed as an image).

export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";

export function sniffImage(bytes: Uint8Array): ImageContentType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    fourCC(bytes, 0) === "RIFF" &&
    fourCC(bytes, 8) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function readU16BE(b: Uint8Array, pos: number): number {
  return (b[pos]! << 8) | b[pos + 1]!;
}
function readU32BE(b: Uint8Array, pos: number): number {
  return (
    ((b[pos]! << 24) | (b[pos + 1]! << 16) | (b[pos + 2]! << 8) | b[pos + 3]!) >>>
    0
  );
}
function readU16LE(b: Uint8Array, pos: number): number {
  return b[pos]! | (b[pos + 1]! << 8);
}
function readU32LE(b: Uint8Array, pos: number): number {
  return (
    (b[pos]! | (b[pos + 1]! << 8) | (b[pos + 2]! << 16) | (b[pos + 3]! << 24)) >>>
    0
  );
}
function fourCC(b: Uint8Array, pos: number): string {
  return String.fromCharCode(b[pos]!, b[pos + 1]!, b[pos + 2]!, b[pos + 3]!);
}

function assemble(bytes: Uint8Array, keep: Array<[number, number]>): Uint8Array {
  const total = keep.reduce((n, [s, e]) => n + (e - s), 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const [s, e] of keep) {
    out.set(bytes.subarray(s, e), off);
    off += e - s;
  }
  return out;
}

// --- JPEG --------------------------------------------------------------

function isStandaloneJpegMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  const keep: Array<[number, number]> = [[0, 2]]; // SOI
  let pos = 2;
  while (pos + 2 <= bytes.length) {
    if (bytes[pos] !== 0xff) break; // malformed: keep remainder verbatim
    const marker = bytes[pos + 1]!;
    if (marker === 0xda || marker === 0xd9) {
      // SOS (entropy-coded data follows) or EOI: keep everything from here
      keep.push([pos, bytes.length]);
      return assemble(bytes, keep);
    }
    if (isStandaloneJpegMarker(marker)) {
      keep.push([pos, pos + 2]); // no length field
      pos += 2;
      continue;
    }
    if (pos + 4 > bytes.length) break;
    const len = readU16BE(bytes, pos + 2); // includes the 2 length bytes
    const segEnd = pos + 2 + len;
    if (len < 2 || segEnd > bytes.length) break;
    if (marker !== 0xe1 && marker !== 0xe2) keep.push([pos, segEnd]); // drop APP1/APP2
    pos = segEnd;
  }
  if (pos < bytes.length) keep.push([pos, bytes.length]);
  return assemble(bytes, keep);
}

function jpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1]!;
    if (marker === 0xda || marker === 0xd9) return null; // no SOF before scan
    if (isStandaloneJpegMarker(marker)) {
      pos += 2;
      continue;
    }
    const len = readU16BE(bytes, pos + 2);
    if (len < 2 || pos + 2 + len > bytes.length) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG extension
      marker !== 0xcc; // DAC
    if (isSof && len >= 7) {
      // payload: precision(1) height(2 BE) width(2 BE) ...
      return {
        height: readU16BE(bytes, pos + 5),
        width: readU16BE(bytes, pos + 7),
      };
    }
    pos += 2 + len;
  }
  return null;
}

// --- PNG ---------------------------------------------------------------

const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);

function stripPng(bytes: Uint8Array): Uint8Array {
  const keep: Array<[number, number]> = [[0, 8]]; // signature
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = readU32BE(bytes, pos);
    const type = fourCC(bytes, pos + 4);
    const chunkEnd = pos + 8 + len + 4; // len + type + data + crc
    if (chunkEnd > bytes.length) break;
    if (!PNG_METADATA_CHUNKS.has(type)) keep.push([pos, chunkEnd]);
    pos = chunkEnd;
    if (type === "IEND") break;
  }
  if (pos < bytes.length) keep.push([pos, bytes.length]);
  return assemble(bytes, keep);
}

function pngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 24 || fourCC(bytes, 12) !== "IHDR") return null;
  return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
}

// --- WebP --------------------------------------------------------------

const WEBP_METADATA_CHUNKS = new Set(["EXIF", "XMP "]);

function stripWebp(bytes: Uint8Array): Uint8Array {
  const keep: Array<[number, number]> = [];
  let pos = 12; // past "RIFF" + size + "WEBP"
  while (pos + 8 <= bytes.length) {
    const cc = fourCC(bytes, pos);
    const size = readU32LE(bytes, pos + 4);
    const chunkEnd = pos + 8 + size + (size % 2); // chunks are 2-byte aligned
    if (chunkEnd > bytes.length) break;
    if (!WEBP_METADATA_CHUNKS.has(cc)) keep.push([pos, chunkEnd]);
    pos = chunkEnd;
  }
  if (pos < bytes.length) keep.push([pos, bytes.length]);
  const bodySize = keep.reduce((n, [s, e]) => n + (e - s), 0);
  const out = new Uint8Array(12 + bodySize);
  out.set(bytes.subarray(0, 12), 0);
  const riffSize = 4 + bodySize; // "WEBP" + chunks
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >>> 8) & 0xff;
  out[6] = (riffSize >>> 16) & 0xff;
  out[7] = (riffSize >>> 24) & 0xff;
  let off = 12;
  for (const [s, e] of keep) {
    out.set(bytes.subarray(s, e), off);
    off += e - s;
  }
  // VP8X flags byte is the first data byte of the first chunk:
  // bit 0x08 = EXIF present, 0x04 = XMP present — both now false.
  if (out.length >= 21 && fourCC(out, 12) === "VP8X") {
    out[20] = out[20]! & ~0x0c;
  }
  return out;
}

function webpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const cc = fourCC(bytes, pos);
    const size = readU32LE(bytes, pos + 4);
    const data = pos + 8;
    if (data + size > bytes.length) return null;
    if (cc === "VP8X" && size >= 10) {
      // VP8X layout: flags(1) + reserved(2) + width-1(3 LE) + height-1(3 LE) + reserved(1)
      return {
        width:
          1 + (bytes[data + 3]! | (bytes[data + 4]! << 8) | (bytes[data + 5]! << 16)),
        height:
          1 + (bytes[data + 6]! | (bytes[data + 7]! << 8) | (bytes[data + 8]! << 16)),
      };
    }
    if (cc === "VP8 " && size >= 10) {
      // lossy key frame: 3-byte frame tag, start code 9D 01 2A, then dims
      if (
        bytes[data + 3] === 0x9d &&
        bytes[data + 4] === 0x01 &&
        bytes[data + 5] === 0x2a
      ) {
        return {
          width: readU16LE(bytes, data + 6) & 0x3fff,
          height: readU16LE(bytes, data + 8) & 0x3fff,
        };
      }
      return null;
    }
    if (cc === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const bits = readU32LE(bytes, data + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    pos = data + size + (size % 2);
  }
  return null;
}

// --- public API ---------------------------------------------------------

export function stripImageMetadata(
  bytes: Uint8Array,
  type: ImageContentType,
): Uint8Array {
  switch (type) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/webp":
      return stripWebp(bytes);
  }
}

export function imageDimensions(
  bytes: Uint8Array,
  type: ImageContentType,
): { width: number; height: number } | null {
  switch (type) {
    case "image/jpeg":
      return jpegDimensions(bytes);
    case "image/png":
      return pngDimensions(bytes);
    case "image/webp":
      return webpDimensions(bytes);
  }
}
