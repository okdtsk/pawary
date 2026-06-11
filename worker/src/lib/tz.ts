/**
 * Parses the `tz` query param (household offset in minutes, positive east of
 * UTC — same convention as activities' tzOffsetMin). Absent ⇒ 0.
 */
export function parseTzQuery(raw: string | undefined): number | "invalid" {
  if (raw === undefined) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= -840 && n <= 840 ? n : "invalid";
}
