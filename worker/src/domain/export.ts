/** RFC 4180 escaping: wrap in quotes when needed, double inner quotes. */
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function csvLine(fields: string[]): string {
  return fields.map(csvEscape).join(",");
}

/** Epoch ms + household offset → "YYYY-MM-DDTHH:mm:ss.SSS±HH:MM". */
export function isoWithOffset(epochMs: number, tzOffsetMin: number): string {
  const shifted = new Date(epochMs + tzOffsetMin * 60000).toISOString();
  const sign = tzOffsetMin < 0 ? "-" : "+";
  const abs = Math.abs(tzOffsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${shifted.slice(0, 23)}${sign}${hh}:${mm}`;
}
