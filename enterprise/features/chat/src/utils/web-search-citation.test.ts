import { describe, expect, it } from "vitest";
import type { WebSearchSource } from "@agenticx/core-api";
import {
  resolveCitationSource,
  siteLabelFromSource,
  splitCitationText,
} from "./web-search-citation";

const sources: WebSearchSource[] = [
  {
    title: "AI news",
    url: "https://www.venturebeat.com/ai/example",
    snippet: "snippet one",
  },
  {
    title: "Docs",
    url: "https://docs.example.org/guide",
    snippet: "snippet two",
  },
];

describe("web-search-citation", () => {
  it("maps in-range [N] to citation tokens and keeps out-of-range as text", () => {
    const parts = splitCitationText("Hello [1] world [99] and [2].", sources);
    expect(parts).toEqual([
      { type: "text", value: "Hello " },
      { type: "citation", value: "[1]", index1Based: 1 },
      { type: "text", value: " world " },
      { type: "text", value: "[99]" },
      { type: "text", value: " and " },
      { type: "citation", value: "[2]", index1Based: 2 },
      { type: "text", value: "." },
    ]);
  });

  it("leaves text unchanged when sources are empty", () => {
    expect(splitCitationText("See [1]", undefined)).toEqual([{ type: "text", value: "See [1]" }]);
    expect(splitCitationText("See [1]", [])).toEqual([{ type: "text", value: "See [1]" }]);
  });

  it("builds short site labels from hostname", () => {
    expect(siteLabelFromSource(sources[0], 1)).toBe("Venturebeat");
    expect(siteLabelFromSource(undefined, 3)).toBe("[3]");
  });

  it("resolves 1-based sources and rejects out of range", () => {
    expect(resolveCitationSource(sources, 1)?.url).toContain("venturebeat");
    expect(resolveCitationSource(sources, 0)).toBeUndefined();
    expect(resolveCitationSource(sources, 99)).toBeUndefined();
  });
});
