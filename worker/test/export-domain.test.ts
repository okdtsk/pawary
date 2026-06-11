import { expect, it } from "vitest";
import { csvLine, isoWithOffset } from "../src/domain/export";

it("csvLine quotes fields containing commas, quotes, or newlines", () => {
  expect(csvLine(["plain", "with,comma"])).toBe('plain,"with,comma"');
  expect(csvLine(['say "hi"'])).toBe('"say ""hi"""');
  expect(csvLine(["line\nbreak"])).toBe('"line\nbreak"');
  expect(csvLine(["", "b"])).toBe(",b");
});

it("isoWithOffset renders household time with the offset suffix", () => {
  expect(isoWithOffset(Date.UTC(2026, 0, 1, 12, 0), 540)).toBe(
    "2026-01-01T21:00:00.000+09:00",
  );
  expect(isoWithOffset(Date.UTC(2026, 0, 1, 12, 0), -330)).toBe(
    "2026-01-01T06:30:00.000-05:30",
  );
  expect(isoWithOffset(Date.UTC(2026, 0, 1, 12, 0), 0)).toBe(
    "2026-01-01T12:00:00.000+00:00",
  );
});
