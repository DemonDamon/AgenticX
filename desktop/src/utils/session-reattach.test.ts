import { describe, it, expect } from "vitest";
import { reattachSessionStreamUrl, parseSseFrame } from "./session-reattach";

describe("reattachSessionStreamUrl", () => {
  it("builds base url without since when seq is 0 or missing", () => {
    expect(reattachSessionStreamUrl("http://127.0.0.1:8000", "s1")).toBe(
      "http://127.0.0.1:8000/api/sessions/s1/stream",
    );
    expect(reattachSessionStreamUrl("http://127.0.0.1:8000", "s1", 0)).toBe(
      "http://127.0.0.1:8000/api/sessions/s1/stream",
    );
  });

  it("appends since query when seq > 0", () => {
    expect(reattachSessionStreamUrl("http://127.0.0.1:8000", "s1", 42)).toBe(
      "http://127.0.0.1:8000/api/sessions/s1/stream?since=42",
    );
  });

  it("strips trailing slash on base and encodes session id", () => {
    expect(reattachSessionStreamUrl("http://h/", "a/b", 5)).toBe(
      "http://h/api/sessions/a%2Fb/stream?since=5",
    );
  });

  it("floors fractional and ignores non-finite since", () => {
    expect(reattachSessionStreamUrl("http://h", "s", 3.9)).toBe(
      "http://h/api/sessions/s/stream?since=3",
    );
    expect(reattachSessionStreamUrl("http://h", "s", Number.NaN)).toBe(
      "http://h/api/sessions/s/stream",
    );
  });
});

describe("parseSseFrame", () => {
  it("parses id and JSON data line", () => {
    const frame = 'id: 7\ndata: {"type":"token","data":{"text":"hi"}}';
    const { eventId, payload } = parseSseFrame(frame);
    expect(eventId).toBe(7);
    expect(payload).toEqual({ type: "token", data: { text: "hi" } });
  });

  it("returns null id when no id line present", () => {
    const { eventId, payload } = parseSseFrame('data: {"type":"done","data":{}}');
    expect(eventId).toBeNull();
    expect(payload).toEqual({ type: "done", data: {} });
  });

  it("returns null payload when data is missing or invalid JSON", () => {
    expect(parseSseFrame("id: 3").payload).toBeNull();
    const bad = parseSseFrame("id: 4\ndata: {not json");
    expect(bad.eventId).toBe(4);
    expect(bad.payload).toBeNull();
  });

  it("ignores non-numeric id", () => {
    expect(parseSseFrame("id: abc\ndata: {}").eventId).toBeNull();
  });
});
