import { describe, expect, it } from "vitest";
import { categoryLabel } from "../src/domain/push/labels";

describe("categoryLabel", () => {
  it("returns EN labels", () => {
    expect(categoryLabel("food", "en")).toBe("Food");
    expect(categoryLabel("vet_visit", "en")).toBe("Vet visit");
  });
  it("returns JA labels", () => {
    expect(categoryLabel("food", "ja")).toBe("ごはん");
    expect(categoryLabel("vet_visit", "ja")).toBe("通院");
  });
  it("falls back to EN for non-ja locales", () => {
    expect(categoryLabel("note", "system")).toBe("Note");
  });
});
