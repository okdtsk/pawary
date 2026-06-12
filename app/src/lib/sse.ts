export type SSEEvent = { event: string; data: string };

/** Stateful incremental SSE parser: feed decoded chunks, get completed events. */
export function createSSEParser(): (chunk: string) => SSEEvent[] {
  let buf = "";
  return (chunk: string): SSEEvent[] => {
    buf += chunk;
    const events: SSEEvent[] = [];
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length > 0) events.push({ event, data: dataLines.join("\n") });
    }
    return events;
  };
}
