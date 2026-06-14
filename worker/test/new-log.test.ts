import { describe, expect, it } from "vitest";
import { categoryLabel } from "../src/domain/push/labels";
import { buildNewLogPayload, formatAuthors } from "../src/domain/push/new-log";

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

describe("formatAuthors", () => {
  it("EN joins", () => {
    expect(formatAuthors(["Alice"], "en")).toBe("Alice");
    expect(formatAuthors(["Alice", "Bob"], "en")).toBe("Alice & Bob");
    expect(formatAuthors(["Alice", "Bob", "Cara"], "en")).toBe("Alice & 2 others");
  });
  it("JA joins with honorific", () => {
    expect(formatAuthors(["愛子"], "ja")).toBe("愛子さん");
    expect(formatAuthors(["愛子", "太郎"], "ja")).toBe("愛子さんと太郎さん");
    expect(formatAuthors(["愛子", "太郎", "花子"], "ja")).toBe("愛子さん他2人");
  });
});

describe("buildNewLogPayload", () => {
  const base = { petName: "Rex", petId: "p1" };

  it("single item EN names the category", () => {
    const p = JSON.parse(
      buildNewLogPayload({ ...base, authorNames: ["Alice"], itemCount: 1, category: "food", locale: "en" }),
    );
    expect(p).toEqual({ title: "Rex", body: "Alice logged Food", url: "/log?pet=p1" });
  });

  it("single item JA names the category", () => {
    const p = JSON.parse(
      buildNewLogPayload({ ...base, authorNames: ["愛子"], itemCount: 1, category: "food", locale: "ja" }),
    );
    expect(p.body).toBe("愛子さんがごはんを記録しました");
  });

  it("multiple items single author EN", () => {
    const p = JSON.parse(
      buildNewLogPayload({ ...base, authorNames: ["Alice"], itemCount: 3, category: null, locale: "en" }),
    );
    expect(p.body).toBe("Alice added 3 logs");
  });

  it("multiple items multiple authors EN", () => {
    const p = JSON.parse(
      buildNewLogPayload({ ...base, authorNames: ["Alice", "Bob"], itemCount: 3, category: null, locale: "en" }),
    );
    expect(p.body).toBe("Alice & Bob added 3 logs");
  });

  it("multiple items JA", () => {
    const p = JSON.parse(
      buildNewLogPayload({ ...base, authorNames: ["愛子", "太郎"], itemCount: 3, category: null, locale: "ja" }),
    );
    expect(p.body).toBe("愛子さんと太郎さんが3件記録しました");
  });
});
