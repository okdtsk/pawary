import { expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../src/lib/cursor";

it("round-trips occurredAt + id", () => {
  const cursor = encodeCursor(1765432100000, "01HZX5N8Q2T3V4W5X6Y7Z8A9B0");
  expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
  expect(decodeCursor(cursor)).toEqual({
    o: 1765432100000,
    i: "01HZX5N8Q2T3V4W5X6Y7Z8A9B0",
  });
});

it("rejects garbage, valid-base64-wrong-shape, and empty cursors", () => {
  expect(decodeCursor("not base64!!")).toBeNull();
  expect(decodeCursor(btoa(JSON.stringify({ x: 1 })))).toBeNull();
  expect(decodeCursor(btoa(JSON.stringify({ o: "1", i: 2 })))).toBeNull();
  expect(decodeCursor("")).toBeNull();
});
