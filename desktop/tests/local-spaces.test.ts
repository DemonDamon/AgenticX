import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignSessionToSpace,
  createLocalSpace,
  readLocalSpaces,
  removeLocalSpace,
  setLocalSpacesFileForTests,
} from "../electron/local-spaces";

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-spaces-"));
  setLocalSpacesFileForTests(path.join(dir, "spaces.json"));
});

afterEach(() => {
  setLocalSpacesFileForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("local spaces", () => {
  it("returns an empty structure when the file is missing or corrupt", () => {
    expect(readLocalSpaces()).toEqual({ version: 1, spaces: [], session_space: {} });
    fs.mkdirSync(path.dirname(path.join(dir, "spaces.json")), { recursive: true });
    fs.writeFileSync(path.join(dir, "spaces.json"), "{", "utf8");
    expect(readLocalSpaces()).toEqual({ version: 1, spaces: [], session_space: {} });
  });

  it("creates one space when the same path is created twice", () => {
    const folder = path.join(dir, "export");
    fs.mkdirSync(folder);
    const first = createLocalSpace({ path: folder });
    const second = createLocalSpace({ path: `${folder}/` });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.space.id).toBe(first.space.id);
    expect(first.space.name).toBe("export");
    expect(readLocalSpaces().spaces).toHaveLength(1);
  });

  it("rejects a path that is not a directory", () => {
    const file = path.join(dir, "notes.txt");
    fs.writeFileSync(file, "x", "utf8");
    expect(createLocalSpace({ path: file })).toEqual({ ok: false, error: "not-a-directory" });
    expect(readLocalSpaces().spaces).toEqual([]);
  });

  it("remove clears session_space mappings for that space", () => {
    const folder = path.join(dir, "claw");
    fs.mkdirSync(folder);
    const other = path.join(dir, "other");
    fs.mkdirSync(other);
    const created = createLocalSpace({ path: folder });
    const kept = createLocalSpace({ path: other });
    if (!created.ok || !kept.ok) throw new Error("create failed");
    assignSessionToSpace({ sessionId: "s1", spaceId: created.space.id });
    assignSessionToSpace({ sessionId: "s2", spaceId: created.space.id });
    assignSessionToSpace({ sessionId: "s3", spaceId: kept.space.id });
    expect(removeLocalSpace(created.space.id)).toEqual({ ok: true });
    const after = readLocalSpaces();
    expect(after.spaces.map((space) => space.id)).toEqual([kept.space.id]);
    expect(after.session_space).toEqual({ s3: kept.space.id });
  });
});
