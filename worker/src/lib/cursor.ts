/** Opaque keyset cursor: base64url(JSON {o: occurredAt, i: id}). */

export function encodeCursor(occurredAt: number, id: string): string {
  return btoa(JSON.stringify({ o: occurredAt, i: id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeCursor(raw: string): { o: number; i: string } | null {
  try {
    const padded =
      raw.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (raw.length % 4)) % 4);
    const value = JSON.parse(atob(padded)) as { o?: unknown; i?: unknown };
    if (typeof value.o !== "number" || typeof value.i !== "string") return null;
    return { o: value.o, i: value.i };
  } catch {
    return null;
  }
}
