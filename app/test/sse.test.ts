import { describe, expect, it } from "vitest";
import { createSSEParser } from "../src/lib/sse";

describe("createSSEParser", () => {
  it("parses complete events with explicit event names", () => {
    const parse = createSSEParser();
    expect(parse('event: delta\ndata: {"text":"Hi"}\n\n')).toEqual([
      { event: "delta", data: '{"text":"Hi"}' },
    ]);
  });

  it("buffers events split across chunks at any boundary", () => {
    const parse = createSSEParser();
    expect(parse("event: del")).toEqual([]);
    expect(parse('ta\ndata: {"te')).toEqual([]);
    expect(parse('xt":"Hi"}\n\n')).toEqual([{ event: "delta", data: '{"text":"Hi"}' }]);
  });

  it("parses multiple events in one chunk, in order", () => {
    const parse = createSSEParser();
    expect(
      parse('event: delta\ndata: {"text":"a"}\n\nevent: done\ndata: {"x":1}\n\n'),
    ).toEqual([
      { event: "delta", data: '{"text":"a"}' },
      { event: "done", data: '{"x":1}' },
    ]);
  });

  it("defaults to event 'message', skips comments and empty events", () => {
    const parse = createSSEParser();
    expect(parse(":heartbeat\n\ndata: x\n\nevent: nodata\n\n")).toEqual([
      { event: "message", data: "x" },
    ]);
  });
});
