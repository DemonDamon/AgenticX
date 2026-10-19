import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ASSET_ID, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_PACKAGE_BYTES,
  AppearanceDocument, AppearanceResult, ImageAsset, ThemePackage,
  emptyAppearanceDocument, parseAppearance, parseDocument, parseThemePackage,
  referencedAssets, validScope,
} from "./chat-appearance-contract";

type Dependencies = {
  decodeImage: (bytes: Buffer) => { width: number; height: number };
  writeFile?: (file: string, bytes: string | Buffer) => void;
};
function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid appearance request");
  if (Object.keys(value).some(k => !keys.includes(k))) throw Error("Unknown appearance request field");
  return value as Record<string, unknown>;
}
function mimeOf(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw Error("壁纸仅支持 PNG、JPEG 或 WebP 图片");
}

/** All public operations are synchronous: revision validation and rename cannot interleave. */
export class AppearanceStore {
  private readonly configFile: string;
  private readonly assetsDir: string;
  constructor(private readonly configDir: string, private readonly deps: Dependencies) {
    this.configFile = path.join(configDir, "appearance.json");
    this.assetsDir = path.join(configDir, "appearance-assets");
  }
  private current(): AppearanceDocument {
    try { return parseDocument(JSON.parse(fs.readFileSync(this.configFile, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyAppearanceDocument();
      throw Error(`外观配置读取失败，原文件已保留：${error instanceof Error ? error.message : error}`);
    }
  }
  load(): AppearanceResult<AppearanceDocument> {
    try { return { ok: true, value: this.current() }; }
    catch (error) { return { ok: true, value: emptyAppearanceDocument(), warning: fail(error).error }; }
  }
  private atomicWrite(destination: string, contents: string | Buffer): void {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      if (this.deps.writeFile) this.deps.writeFile(temporary, contents);
      else fs.writeFileSync(temporary, contents, { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, destination);
    } finally { try { fs.unlinkSync(temporary); } catch { /* Rename already removed temp. */ } }
  }
  save(payload: unknown): AppearanceResult<AppearanceDocument> {
    try {
      const p = record(payload, ["expectedRevision", "scope", "appearance"]);
      if (!Number.isSafeInteger(p.expectedRevision) || !validScope(p.scope)) throw Error("Invalid appearance save request");
      const current = this.current();
      if (p.expectedRevision !== current.revision) throw Error("外观配置已更新，请重新加载后应用");
      if (p.appearance === null) {
        if (p.scope === "global") throw Error("Cannot remove global appearance");
        delete current.overrides[p.scope];
      } else {
        const appearance = parseAppearance(p.appearance);
        for (const id of referencedAssets(appearance)) {
          const image = this.readWallpaper(id); if (!image.ok) throw Error(image.error);
        }
        if (p.scope === "global") current.global = appearance;
        else current.overrides[p.scope] = appearance;
      }
      current.revision += 1;
      if (!Number.isSafeInteger(current.revision)) throw Error("Appearance revision exhausted");
      this.atomicWrite(this.configFile, JSON.stringify(current, null, 2));
      return { ok: true, value: current };
    } catch (error) { return fail(error); }
  }
  private validateImage(bytes: Buffer): ImageAsset {
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw Error("壁纸大小必须不超过 10 MiB");
    const mime = mimeOf(bytes);
    const { width, height } = this.deps.decodeImage(bytes);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) throw Error("壁纸无法解码或超过 1600 万像素");
    return { id: createHash("sha256").update(bytes).digest("hex"), mime, base64: bytes.toString("base64") };
  }
  importWallpaper(bytes: Buffer): AppearanceResult<ImageAsset> {
    try {
      const asset = this.validateImage(bytes);
      this.atomicWrite(path.join(this.assetsDir, asset.id), bytes);
      return { ok: true, value: asset };
    } catch (error) { return fail(error); }
  }
  readWallpaper(id: unknown): AppearanceResult<ImageAsset> {
    try {
      if (typeof id !== "string" || !ASSET_ID.test(id)) throw Error("Invalid wallpaper asset ID");
      const file = path.join(this.assetsDir, id);
      if (fs.statSync(file).size > MAX_IMAGE_BYTES) throw Error("壁纸资源大小异常");
      const asset = this.validateImage(fs.readFileSync(file));
      if (asset.id !== id) throw Error("壁纸资源校验失败");
      return { ok: true, value: asset };
    } catch (error) { return fail(error); }
  }
  importPackage(bytes: Buffer): AppearanceResult<ThemePackage> {
    try {
      if (bytes.length > MAX_PACKAGE_BYTES) throw Error("主题包大小必须不超过 20 MiB");
      const theme = parseThemePackage(JSON.parse(bytes.toString("utf8")));
      // Validate every asset before persisting any of them.
      const images = theme.assets.map(asset => {
        const contents = Buffer.from(asset.base64, "base64");
        const verified = this.validateImage(contents);
        if (verified.id !== asset.id || verified.mime !== asset.mime || verified.base64 !== asset.base64) throw Error("主题包图片校验失败");
        return { asset: verified, contents };
      });
      for (const image of images) this.atomicWrite(path.join(this.assetsDir, image.asset.id), image.contents);
      return { ok: true, value: theme };
    } catch (error) { return fail(error); }
  }
  exportPackage(payload: unknown): AppearanceResult<ThemePackage> {
    try {
      const p = record(payload, ["name", "appearance"]);
      const appearance = parseAppearance(p.appearance);
      const assets = referencedAssets(appearance).map(id => {
        const image = this.readWallpaper(id); if (!image.ok) throw Error(image.error); return image.value;
      });
      const theme = parseThemePackage({ format: "near-chat-theme", version: 1, name: p.name, appearance, assets });
      if (Buffer.byteLength(JSON.stringify(theme)) > MAX_PACKAGE_BYTES) throw Error("主题包大小必须不超过 20 MiB");
      return { ok: true, value: theme };
    } catch (error) { return fail(error); }
  }
}
