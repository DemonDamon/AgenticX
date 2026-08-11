import { describe, expect, it } from "vitest";
import { parseLocalArtifactPath } from "./sandbox-artifact-link";

describe("sandbox-artifact-link", () => {
  it("parses sandbox: absolute paths", () => {
    expect(parseLocalArtifactPath("sandbox:/Users/damon/a b.html")).toBe("/Users/damon/a b.html");
    expect(parseLocalArtifactPath("sandbox://Users/damon/x.html")).toBe("/Users/damon/x.html");
    expect(parseLocalArtifactPath("sandbox:/Users/damon/a%20b.html")).toBe("/Users/damon/a b.html");
  });

  it("parses file:// URLs", () => {
    expect(parseLocalArtifactPath("file:///Users/damon/a.html")).toBe("/Users/damon/a.html");
    expect(parseLocalArtifactPath("file:///C:/Users/a.html")).toBe("C:/Users/a.html");
  });

  it("rejects non-local or malformed links", () => {
    expect(parseLocalArtifactPath("https://x.com/a")).toBeNull();
    expect(parseLocalArtifactPath("sandbox:")).toBeNull();
    expect(parseLocalArtifactPath("sandbox:relative/x")).toBeNull();
    expect(parseLocalArtifactPath("")).toBeNull();
    expect(parseLocalArtifactPath("  ")).toBeNull();
  });

  it("keeps raw path on malformed percent escapes", () => {
    expect(parseLocalArtifactPath("sandbox:/a%zz")).toBe("/a%zz");
  });

  it("allows filesystem root", () => {
    expect(parseLocalArtifactPath("sandbox:/")).toBe("/");
  });
});
