import { describe, expect, it } from "vitest";
import {
  MAX_PULL,
  THRESHOLD,
  nextPullState,
  pullDistance,
} from "../src/lib/pullToRefresh";

describe("pullDistance", () => {
  it("returns zero for non-downward pulls", () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(-40)).toBe(0);
  });

  it("applies resistance damping to downward pulls", () => {
    expect(pullDistance(40)).toBe(20);
  });

  it("caps at MAX_PULL", () => {
    expect(pullDistance(10_000)).toBe(MAX_PULL);
  });
});

describe("nextPullState", () => {
  it("stays pulling below the threshold", () => {
    const r = nextPullState("idle", { type: "move", distance: THRESHOLD - 1 });
    expect(r).toEqual({ status: "pulling", refresh: false });
  });

  it("arms at or past the threshold", () => {
    const r = nextPullState("pulling", { type: "move", distance: THRESHOLD });
    expect(r).toEqual({ status: "armed", refresh: false });
  });

  it("returns to idle when the pull collapses to zero", () => {
    const r = nextPullState("pulling", { type: "move", distance: 0 });
    expect(r).toEqual({ status: "idle", refresh: false });
  });

  it("refreshes when released while armed", () => {
    const r = nextPullState("armed", { type: "release" });
    expect(r).toEqual({ status: "refreshing", refresh: true });
  });

  it("does not refresh when released below the threshold", () => {
    const r = nextPullState("pulling", { type: "release" });
    expect(r).toEqual({ status: "idle", refresh: false });
  });

  it("ignores moves while refreshing", () => {
    const r = nextPullState("refreshing", { type: "move", distance: 999 });
    expect(r).toEqual({ status: "refreshing", refresh: false });
  });

  it("returns to idle once the refresh settles", () => {
    const r = nextPullState("refreshing", { type: "settle" });
    expect(r).toEqual({ status: "idle", refresh: false });
  });
});
