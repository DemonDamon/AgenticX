import { describe, expect, it } from "vitest";
import { parseSseChunk } from "../electron/ma-sse";

describe("parseSseChunk", () => {
  it("parses id/event/data and ignores ping", () => {
    const parsed = parseSseChunk('id: 3\nevent: agent.message\ndata: {"a":1}\n\n: ping\n\n');
    expect(parsed.messages).toEqual([
      { id: "3", event: "agent.message", data: '{"a":1}' },
    ]);
    expect(parsed.rest).toBe("");
  });

  it("keeps partial frame in rest", () => {
    const first = parseSseChunk("id: 9\ndata: hi");
    expect(first.messages).toEqual([]);
    const second = parseSseChunk(`${first.rest}there\n\n`);
    expect(second.messages).toEqual([{ id: "9", event: "message", data: "hithere" }]);
    expect(second.rest).toBe("");
  });

  it("joins multiple data lines", () => {
    const parsed = parseSseChunk("data: hello\ndata: world\n\n");
    expect(parsed.messages).toEqual([{ id: null, event: "message", data: "hello\nworld" }]);
  });

  it("handles CRLF", () => {
    const parsed = parseSseChunk('id: 4\r\nevent: agent.message\r\ndata: {"z":1}\r\n\r\n');
    expect(parsed.messages).toEqual([
      { id: "4", event: "agent.message", data: '{"z":1}' },
    ]);
  });

  it("no id carry-over", () => {
    const parsed = parseSseChunk("id: 1\ndata: a\n\ndata: b\n\n");
    expect(parsed.messages).toEqual([
      { id: "1", event: "message", data: "a" },
      { id: null, event: "message", data: "b" },
    ]);
  });
});
