import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AppearanceStore } from "../electron/chat-appearance-store";
import { defaultAppearance, defaultEffect, MAX_PACKAGE_BYTES } from "../electron/chat-appearance-contract";
const dirs: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7xkAAAAASUVORK5CYII=", "base64");
function makeStore() { const dir = mkdtempSync(join(tmpdir(), "appearance-package-")); dirs.push(dir); return new AppearanceStore(dir, { decodeImage: () => ({ width: 1, height: 1 }) }); }
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe("portable theme package", () => {
  it("roundtrips exactly referenced assets without identity/path and does not save imported draft", () => {
    const source = makeStore(); const image = source.importWallpaper(png); if (!image.ok) throw Error(image.error);
    const appearance = defaultAppearance(); appearance.variants.light.wallpaper.type = "image"; appearance.variants.light.wallpaper.assetId = image.value.id;
    const exported = source.exportPackage({ name: "My theme", appearance }); if (!exported.ok) throw Error(exported.error);
    const serialized = JSON.stringify(exported.value);
    expect(serialized).not.toMatch(/avatar:|group:|appearance-assets|sourcePath/);
    const target = makeStore();
    expect(target.importPackage(Buffer.from(serialized))).toEqual(exported);
    expect(target.readWallpaper(image.value.id)).toEqual(image);
    expect(target.load()).toMatchObject({ ok: true, value: { revision: 0, global: { variants: { light: { wallpaper: { type: "default" } } } } } });
  });
  it("does not export stale image references after switching to a gradient", () => {
    const store = makeStore(); const image = store.importWallpaper(png);
    if (!image.ok) throw Error(image.error);
    const appearance = defaultAppearance();
    appearance.variants.dark.wallpaper.type = "gradient";
    appearance.variants.dark.wallpaper.assetId = image.value.id;
    const exported = store.exportPackage({ name: "Gradient", appearance });
    if (!exported.ok) throw Error(exported.error);
    expect(exported.value.assets).toEqual([]);
    expect(exported.value.appearance.variants.dark.wallpaper.assetId).toBeNull();
    const target = makeStore();
    expect(target.importPackage(Buffer.from(JSON.stringify(exported.value)))).toEqual(exported);
  });
  it("rejects altered hashes, mismatched references, unknown fields/versions and oversized packages", () => {
    const store = makeStore(); const appearance = defaultAppearance();
    const id = createHash("sha256").update(png).digest("hex"); appearance.variants.dark.wallpaper.type = "image"; appearance.variants.dark.wallpaper.assetId = id;
    const base = { format: "near-chat-theme", version: 1, name: "Theme", appearance, assets: [{ id, mime: "image/png", base64: png.toString("base64") }] };
    const run = (value: unknown) => store.importPackage(Buffer.from(JSON.stringify(value)));
    expect(run({ ...base, version: 3 }).ok).toBe(false);
    expect(run({ ...base, path: "/tmp/private" }).ok).toBe(false);
    expect(run({ ...base, assets: [] }).ok).toBe(false);
    expect(run({ ...base, assets: [{ ...base.assets[0], base64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64") }] }).ok).toBe(false);
    expect(store.importPackage(Buffer.alloc(MAX_PACKAGE_BYTES + 1)).ok).toBe(false);
  });
});

describe("effect theme packages", () => {
  it("imports legacy packages as a draft and roundtrips v2 effect parameters", () => {
    const source = makeStore(); const appearance = defaultAppearance();
    const old = JSON.parse(JSON.stringify(appearance)); old.version = 1;
    for (const v of Object.values(old.variants) as Array<{wallpaper: Record<string, unknown>}>) delete v.wallpaper.effect;
    old.variants.dark.wallpaper.type = "shader";
    expect(source.importPackage(Buffer.from(JSON.stringify({ format: "near-chat-theme", version: 1, name: "Old", appearance: old, assets: [] })))).toMatchObject({ ok: true, value: { version: 2, appearance: { variants: { dark: { wallpaper: { effect: { id: "gradient" } } } } } } });
    appearance.variants.dark.wallpaper.type = "shader"; appearance.variants.dark.wallpaper.effect = defaultEffect("cursor-ripples");
    appearance.variants.dark.wallpaper.effect.params.radius = .7;
    const exported = source.exportPackage({ name: "Ripples", appearance }); if (!exported.ok) throw Error(exported.error);
    expect(exported.value.version).toBe(2);
    const target = makeStore(); expect(target.importPackage(Buffer.from(JSON.stringify(exported.value)))).toEqual(exported);
    expect(target.load()).toMatchObject({ ok: true, value: { revision: 0 } });
    const invalid = JSON.parse(JSON.stringify(exported.value)); invalid.appearance.variants.dark.wallpaper.effect.params.radius = 4;
    expect(target.importPackage(Buffer.from(JSON.stringify(invalid))).ok).toBe(false);
  });
});
