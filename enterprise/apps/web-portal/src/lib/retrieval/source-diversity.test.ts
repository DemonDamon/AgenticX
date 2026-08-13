import { describe, expect, it } from "vitest";
import { diversifyBySourceHost, sourceHostname } from "./source-diversity";

describe("source diversity", () => {
  it("normalizes www hosts", () => {
    expect(sourceHostname("https://www.example.com/a")).toBe("example.com");
  });

  it("gives each host one slot before duplicate-host pages", () => {
    const rows = [
      "https://a.example/1",
      "https://a.example/2",
      "https://b.example/1",
      "https://c.example/1",
      "https://b.example/2",
    ];
    expect(diversifyBySourceHost(rows, (url) => url)).toEqual([
      "https://a.example/1",
      "https://b.example/1",
      "https://c.example/1",
      "https://a.example/2",
      "https://b.example/2",
    ]);
  });

  it("applies a generic per-host cap without a domain allowlist", () => {
    const rows = [
      "https://a.example/1",
      "https://a.example/2",
      "https://b.example/1",
      "https://a.example/3",
    ];
    expect(
      diversifyBySourceHost(rows, (url) => url, { maxPerHost: 2 }),
    ).toEqual([
      "https://a.example/1",
      "https://b.example/1",
      "https://a.example/2",
    ]);
  });
});
