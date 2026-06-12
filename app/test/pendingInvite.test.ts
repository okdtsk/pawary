import { describe, expect, it } from "vitest";
import { pendingInviteFromPath } from "../src/lib/pendingInvite";

describe("pendingInviteFromPath", () => {
  it("extracts the token from a join path", () => {
    expect(pendingInviteFromPath("/join/abc123_-XYZ")).toBe("abc123_-XYZ");
  });

  it("returns null for non-join paths and malformed join paths", () => {
    expect(pendingInviteFromPath("/")).toBeNull();
    expect(pendingInviteFromPath("/settings/pets")).toBeNull();
    expect(pendingInviteFromPath("/join/")).toBeNull();
    expect(pendingInviteFromPath("/join/a/b")).toBeNull();
    expect(pendingInviteFromPath("/JOIN/abc")).toBeNull();
  });
});
