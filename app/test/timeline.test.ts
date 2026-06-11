import { describe, expect, it } from "vitest";
import { LANE_GAP_MIN, placeItems } from "../src/lib/timeline";

describe("placeItems", () => {
  it("returns [] for no items", () => {
    expect(placeItems([])).toEqual([]);
  });

  it("keeps well-spaced items in one lane", () => {
    const placed = placeItems([
      { id: "a", minute: 60 },
      { id: "b", minute: 60 + LANE_GAP_MIN },
      { id: "c", minute: 60 + LANE_GAP_MIN * 2 },
    ]);
    expect(placed.map((p) => p.lane)).toEqual([0, 0, 0]);
    expect(placed.every((p) => p.laneCount === 1)).toBe(true);
  });

  it("splits overlapping items into lanes and reuses freed lanes", () => {
    const placed = placeItems([
      { id: "a", minute: 60 },
      { id: "b", minute: 80 }, // overlaps a → lane 1
      { id: "c", minute: 300 }, // far later → back to lane 0
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect(byId["a"]!.lane).toBe(0);
    expect(byId["b"]!.lane).toBe(1);
    expect(byId["c"]!.lane).toBe(0);
    expect(placed.every((p) => p.laneCount === 2)).toBe(true);
  });

  it("sorts by minute before placing", () => {
    const placed = placeItems([
      { id: "late", minute: 500 },
      { id: "early", minute: 10 },
    ]);
    expect(placed[0]!.id).toBe("early");
  });
});
