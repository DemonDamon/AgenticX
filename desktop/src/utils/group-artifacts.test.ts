import { describe, expect, it } from "vitest";
import { attachmentsFromSessionRow } from "./session-message-map";
import { parseGroupArtifacts } from "./group-artifacts";

describe("parseGroupArtifacts", () => {
  it("filters non-array, empty path, and duplicates, then caps at 8", () => {
    expect(parseGroupArtifacts(null)).toBeUndefined();
    expect(parseGroupArtifacts([])).toBeUndefined();
    expect(parseGroupArtifacts([{ name: "a.md" }])).toBeUndefined();
    const parsed = parseGroupArtifacts([
      { name: "a.md", source_path: "/tmp/a.md", mime_type: "text/markdown", size: 3 },
      { name: "dup.md", source_path: "/tmp/a.md", mime_type: "text/markdown", size: 3 },
      { name: "", source_path: "/tmp/deep/b.md", size: "12" },
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `f${i}.txt`,
        source_path: `/tmp/f${i}.txt`,
        size: i,
      })),
    ]);
    expect(parsed).toHaveLength(8);
    expect(parsed?.[0]).toMatchObject({
      name: "a.md",
      sourcePath: "/tmp/a.md",
      mimeType: "text/markdown",
      size: 3,
      referenceToken: true,
    });
    expect(parsed?.[1]?.name).toBe("b.md");
    expect(parsed?.[1]?.mimeType).toBe("application/octet-stream");
  });

  it("matches history attachments parsed by session-message-map", () => {
    const live = parseGroupArtifacts([
      {
        name: "plan.md",
        mime_type: "text/markdown",
        size: 12,
        source_path: "/tmp/plan.md",
        reference_token: true,
      },
    ]);
    const history = attachmentsFromSessionRow([
      {
        name: "plan.md",
        mime_type: "text/markdown",
        size: 12,
        source_path: "/tmp/plan.md",
        reference_token: true,
        kind: "context_file",
      },
    ]);
    expect(live?.[0]?.sourcePath).toBe(history?.[0]?.sourcePath);
    expect(live?.[0]?.referenceToken).toBe(true);
    expect(history?.[0]?.referenceToken).toBe(true);
  });
});
