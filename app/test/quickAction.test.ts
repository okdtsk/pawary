import { describe, expect, it } from "vitest";
import { parseQuickAction } from "../src/lib/quickAction";

describe("parseQuickAction", () => {
  it("opens for action=quickadd with no category", () => {
    expect(parseQuickAction("?action=quickadd")).toEqual({ open: true });
  });

  it("includes a valid category", () => {
    expect(parseQuickAction("?action=quickadd&category=food")).toEqual({
      open: true,
      category: "food",
    });
  });

  it("drops an unknown category", () => {
    expect(parseQuickAction("?action=quickadd&category=bogus")).toEqual({
      open: true,
    });
  });

  it("does not open for other/absent actions", () => {
    expect(parseQuickAction("")).toEqual({ open: false });
    expect(parseQuickAction("?action=other")).toEqual({ open: false });
    expect(parseQuickAction("?foo=bar")).toEqual({ open: false });
  });

  it("works without a leading question mark", () => {
    expect(parseQuickAction("action=quickadd&category=weight")).toEqual({
      open: true,
      category: "weight",
    });
  });
});
