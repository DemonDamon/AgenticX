import { describe, expect, it } from "vitest";
import {
  atMentionIconTone,
  atMentionPrimaryText,
  atMentionSecondaryText,
  browseTrailLabel,
  compactAtMentionPath,
  groupAtMentionCandidates,
  parentBrowsePath,
} from "./at-mention-display";

describe("atMentionPrimaryText", () => {
  it("uses the file label, not the full path", () => {
    expect(
      atMentionPrimaryText({
        kind: "file",
        taskspaceId: "ts",
        path: "prototype/index.html",
        label: "index.html",
      })
    ).toBe("index.html");
  });
});

describe("compactAtMentionPath", () => {
  it("keeps a short relative parent", () => {
    expect(compactAtMentionPath("prototype/index.html", { parentOnly: true })).toBe("prototype");
  });

  it("hides the parent when the file sits at the root", () => {
    expect(compactAtMentionPath("blog.md", { parentOnly: true })).toBe("");
  });

  it("does not dump a raw /Users absolute path", () => {
    const hint = compactAtMentionPath("/Users/damon/myWork/oag-deep-research");
    expect(hint.includes("/Users/damon")).toBe(false);
    expect(hint.length).toBeGreaterThan(0);
    expect(hint.length).toBeLessThanOrEqual(36);
  });
});

describe("atMentionSecondaryText", () => {
  it("shows role for avatars and a short location for folders", () => {
    expect(
      atMentionSecondaryText({
        kind: "avatar",
        avatarId: "a1",
        label: "Machi",
        role: "群聊协调者",
      })
    ).toBe("群聊协调者");
    const folderHint = atMentionSecondaryText({
      kind: "taskspace",
      taskspaceId: "ts",
      path: "/Users/damon/myWork/oag-deep-research",
      label: "oag-deep-research",
      alias: "oag-deep-research",
    });
    expect(folderHint.includes("/Users/")).toBe(false);
  });
});

describe("atMentionIconTone", () => {
  it("maps common extensions and folders", () => {
    expect(
      atMentionIconTone({ kind: "file", taskspaceId: "t", path: "a.md", label: "a.md" })
    ).toBe("document");
    expect(
      atMentionIconTone({ kind: "file", taskspaceId: "t", path: "a.tsx", label: "a.tsx" })
    ).toBe("code");
    expect(
      atMentionIconTone({ kind: "file", taskspaceId: "t", path: "a.svg", label: "a.svg" })
    ).toBe("image");
    expect(
      atMentionIconTone({ kind: "file", taskspaceId: "t", path: "a.pdf", label: "a.pdf" })
    ).toBe("pdf");
    expect(
      atMentionIconTone({
        kind: "taskspace",
        taskspaceId: "t",
        path: "/tmp/ws",
        label: "ws",
        alias: "ws",
      })
    ).toBe("folder");
  });
});

describe("groupAtMentionCandidates", () => {
  it("splits members, workspaces, and files", () => {
    const grouped = groupAtMentionCandidates([
      { kind: "avatar", avatarId: "a", label: "Ada", role: "设计" },
      {
        kind: "taskspace",
        taskspaceId: "t",
        path: "/tmp/ws",
        label: "ws",
        alias: "ws",
      },
      { kind: "file", taskspaceId: "t", path: "a.md", label: "a.md" },
    ]);
    expect(grouped.avatars).toHaveLength(1);
    expect(grouped.folders).toHaveLength(1);
    expect(grouped.files).toHaveLength(1);
  });

  it("treats nested dirs as folders", () => {
    const grouped = groupAtMentionCandidates([
      { kind: "dir", taskspaceId: "t", path: "src/utils", label: "utils" },
      { kind: "file", taskspaceId: "t", path: "src/utils/a.md", label: "a.md" },
    ]);
    expect(grouped.folders).toHaveLength(1);
    expect(grouped.files).toHaveLength(1);
    expect(atMentionIconTone(grouped.folders[0])).toBe("folder");
    expect(atMentionPrimaryText(grouped.folders[0])).toBe("utils");
  });
});

describe("parentBrowsePath", () => {
  it("walks one level up and stops at the taskspace root", () => {
    expect(parentBrowsePath("src/utils/deep")).toBe("src/utils");
    expect(parentBrowsePath("src")).toBe(".");
    expect(parentBrowsePath(".")).toBe(".");
    expect(parentBrowsePath("")).toBe(".");
  });

  it("normalizes separators and trailing slashes", () => {
    expect(parentBrowsePath("src\\utils\\")).toBe("src");
    expect(parentBrowsePath("./src/utils")).toBe("src");
  });
});

describe("browseTrailLabel", () => {
  it("prefixes the taskspace label and elides deep trails", () => {
    expect(browseTrailLabel("AgenticX", ".")).toBe("AgenticX");
    expect(browseTrailLabel("AgenticX", "desktop/src")).toBe("AgenticX / desktop / src");
    expect(browseTrailLabel("AgenticX", "a/b/c/d/e")).toBe("AgenticX / … / c / d / e");
  });

  it("falls back when the taskspace has no label", () => {
    expect(browseTrailLabel("", "src")).toBe("workspace / src");
  });
});
