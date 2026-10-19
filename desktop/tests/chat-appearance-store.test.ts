import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppearanceStore } from "../electron/chat-appearance-store";
import { defaultAppearance, presetAppearance, resolveAppearance, resolveAppearanceScope } from "../electron/chat-appearance-contract";

const dirs: string[] = [];
function setup(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "appearance-test-")); dirs.push(dir);
  return { dir, store: new AppearanceStore(dir, { decodeImage: () => ({ width: 1, height: 1 }), ...extra }) };
}
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe("appearance persistence", () => {
  it("persists complete snapshots, revisions, and isolated scope removal", () => {
    const { dir, store } = setup();
    expect(store.load()).toMatchObject({ ok: true, value: { revision: 0 } });
    expect(store.save({ expectedRevision: 0, scope: "avatar:a", appearance: defaultAppearance() })).toMatchObject({ ok: true, value: { revision: 1 } });
    const reloaded = new AppearanceStore(dir, { decodeImage: () => ({ width: 1, height: 1 }) });
    expect(reloaded.load()).toMatchObject({ ok: true, value: { revision: 1, overrides: { "avatar:a": {} } } });
    expect(reloaded.save({ expectedRevision: 0, scope: "global", appearance: defaultAppearance() })).toMatchObject({ ok: false });
    expect(reloaded.save({ expectedRevision: 1, scope: "avatar:a", appearance: null })).toMatchObject({ ok: true, value: { revision: 2, overrides: {} } });
    expect(JSON.parse(readFileSync(join(dir, "appearance.json"), "utf8")).revision).toBe(2);
  });
  it("does not overwrite corrupted configuration", () => {
    const { dir, store } = setup();
    writeFileSync(join(dir, "appearance.json"), "broken");
    expect(store.load()).toMatchObject({ ok: true, warning: expect.any(String), value: { revision: 0 } });
    expect(store.save({ expectedRevision: 0, scope: "global", appearance: defaultAppearance() })).toMatchObject({ ok: false });
    expect(readFileSync(join(dir, "appearance.json"), "utf8")).toBe("broken");
  });
  it("reports write failure without mutating saved state", () => {
    const { store } = setup({ writeFile: () => { throw new Error("disk full"); } });
    expect(store.save({ expectedRevision: 0, scope: "global", appearance: defaultAppearance() })).toEqual({ ok: false, error: expect.stringContaining("disk full") });
    expect(store.load()).toMatchObject({ ok: true, value: { revision: 0 } });
  });
  it("rejects arbitrary paths, unknown save fields, unsupported images and oversized decoding", () => {
    const { store } = setup();
    expect(store.readWallpaper("../../config.yaml")).toMatchObject({ ok: false });
    expect(store.save({ expectedRevision: 0, scope: "global", appearance: defaultAppearance(), surprise: true })).toMatchObject({ ok: false });
    expect(store.importWallpaper(Buffer.from("<svg/>"))).toMatchObject({ ok: false });
    const { store: huge } = setup({ decodeImage: () => ({ width: 5000, height: 5000 }) });
    expect(huge.importWallpaper(Buffer.from("89504e470d0a1a0a", "hex"))).toMatchObject({ ok: false });
  });
});

describe("identity appearance inheritance", () => {
  it("isolates Meta, avatars and groups across session-independent snapshots", () => {
    const { store, dir } = setup();
    let revision = 0;
    const save = (scope: string, appearance: ReturnType<typeof defaultAppearance> | null) => {
      const result = store.save({ expectedRevision: revision, scope, appearance });
      if (!result.ok) throw Error(result.error);
      revision = result.value.revision;
    };
    save("global", presetAppearance("mist"));
    save("meta", presetAppearance("dusk"));
    save("avatar:a", presetAppearance("forest"));
    save("group:g", presetAppearance("dusk"));
    const fresh = new AppearanceStore(dir, { decodeImage: () => ({ width: 1, height: 1 }) });
    const loaded = fresh.load(); if (!loaded.ok) throw Error(loaded.error);
    const doc = loaded.value;
    expect(resolveAppearance(doc, resolveAppearanceScope(null)).presetId).toBe("dusk");
    expect(resolveAppearance(doc, resolveAppearanceScope("a")).presetId).toBe("forest");
    expect(resolveAppearance(doc, resolveAppearanceScope("b")).presetId).toBe("mist");
    expect(resolveAppearance(doc, resolveAppearanceScope("group:g")).presetId).toBe("dusk");
    expect(resolveAppearance(doc, resolveAppearanceScope("automation:task")).presetId).toBe("mist");
    save("avatar:a", null);
    const next = store.load(); if (!next.ok) throw Error(next.error);
    expect(resolveAppearance(next.value, "avatar:a").presetId).toBe("mist");
    expect(resolveAppearance(next.value, "group:g").presetId).toBe("dusk");
  });
});
