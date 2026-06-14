// Client-side image normalization for uploads.
//
// iPhone photos store pixels in the sensor's orientation plus an EXIF
// `Orientation` tag. The Worker strips all EXIF metadata (incl. orientation)
// without re-encoding, so a portrait photo would render rotated once served.
// Baking the orientation into the pixels here fixes that, and re-encoding also
// downscales the image (avatars don't need full-resolution originals).

const DEFAULT_MAX_DIM = 1024;
const JPEG_QUALITY = 0.85;

/**
 * Returns a normalized JPEG `File`: EXIF orientation baked into pixels,
 * longest edge capped at `maxDim`, all metadata dropped. Falls back to the
 * original file whenever the browser can't process it (no canvas support,
 * unsupported codec, decode failure, etc.).
 */
export async function normalizeImageForUpload(
  file: File,
  maxDim = DEFAULT_MAX_DIM,
): Promise<File> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined" ||
    !file.type.startsWith("image/")
  ) {
    return file;
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxDim ? maxDim / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return file;

    const name = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
