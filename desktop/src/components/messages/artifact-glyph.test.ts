import { describe, expect, it } from "vitest";
import { artifactGlyph } from "./artifact-glyph";

describe("artifactGlyph", () => {
  it("maps txt to the folded text sheet and languages to their own kinds", () => {
    expect(artifactGlyph("/tmp/hello.txt").kind).toBe("txt");
    expect(artifactGlyph("/tmp/notes.rtf").kind).toBe("txt");
    expect(artifactGlyph("/tmp/main.go").kind).toBe("go");
    expect(artifactGlyph("/tmp/main.py").kind).toBe("py");
    expect(artifactGlyph("/tmp/main.c").kind).toBe("c");
    expect(artifactGlyph("/tmp/overview.md").kind).toBe("md");
    expect(artifactGlyph("/tmp/npc_base.gd").kind).toBe("code");
    expect(artifactGlyph("/tmp/project.godot").kind).toBe("code");
  });

  it("keeps language swatches distinct from the old shared accent wash", () => {
    const txt = artifactGlyph("/tmp/a.txt");
    const go = artifactGlyph("/tmp/a.go");
    const py = artifactGlyph("/tmp/a.py");
    expect(txt.tint).not.toBe(go.tint);
    expect(go.tint).not.toBe(py.tint);
    expect(txt.tint).toBe("#6F8CFF");
  });
});
