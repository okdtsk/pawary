import { describe, expect, it } from "vitest";
import { isProdLike } from "../src/lib/environment";

describe("isProdLike", () => {
  it("is false in development (insecure local cookies, no HSTS)", () => {
    expect(isProdLike({ ENVIRONMENT: "development" })).toBe(false);
  });

  it("is true in preview (production-grade security)", () => {
    expect(isProdLike({ ENVIRONMENT: "preview" })).toBe(true);
  });

  it("is true in production", () => {
    expect(isProdLike({ ENVIRONMENT: "production" })).toBe(true);
  });
});
