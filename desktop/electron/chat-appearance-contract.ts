/** Pure, shared contract: kept under electron/ to preserve its existing output root. */
export type AppearanceMode = "light" | "dim" | "dark";
export type MotionMode = "off" | "on-send" | "continuous";
export type WallpaperType = "default" | "solid" | "gradient" | "image" | "shader";
export type PatternId = "none" | "dots" | "grid" | "waves";
export const EFFECT_IDS = ["gradient", "noise", "ripples", "glass", "fluted-glass", "cursor-ripples"] as const;
export type EffectId = typeof EFFECT_IDS[number];
type EffectParams = {
  gradient: Record<string, never>;
  noise: { scale: number; contrast: number; seed: number };
  ripples: { frequency: number; softness: number; thickness: number };
  glass: { refraction: number; scale: number; aberration: number };
  "fluted-glass": { frequency: number; refraction: number; angle: number };
  "cursor-ripples": { intensity: number; radius: number; decay: number };
};
export type ShaderEffect = { [K in EffectId]: { id: K; opacity: number; params: EffectParams[K] } }[EffectId];
export type EffectParameter = { min: number; max: number; step: number; initial: number };
export const EFFECT_PARAMS = {
  gradient: {},
  noise: { scale: { min: -2, max: 5, step: .05, initial: 2 }, contrast: { min: 0, max: 2, step: .01, initial: .15 }, seed: { min: 0, max: 100, step: 1, initial: 0 } },
  ripples: { frequency: { min: 4, max: 40, step: 1, initial: 12 }, softness: { min: 0, max: 1, step: .01, initial: .75 }, thickness: { min: .1, max: .9, step: .01, initial: .35 } },
  glass: { refraction: { min: 0, max: 1, step: .01, initial: .25 }, scale: { min: .2, max: 2, step: .01, initial: .85 }, aberration: { min: 0, max: .5, step: .01, initial: .05 } },
  "fluted-glass": { frequency: { min: 4, max: 40, step: 1, initial: 12 }, refraction: { min: 0, max: 2, step: .01, initial: .35 }, angle: { min: 0, max: 360, step: 1, initial: 0 } },
  "cursor-ripples": { intensity: { min: 0, max: 10, step: .1, initial: 2 }, radius: { min: .1, max: 1, step: .01, initial: .3 }, decay: { min: 1, max: 20, step: .1, initial: 10 } },
} satisfies { [K in EffectId]: Record<keyof EffectParams[K], EffectParameter> };
export function defaultEffect<K extends EffectId>(id: K): Extract<ShaderEffect, { id: K }> {
  return { id, opacity: id === "gradient" ? 1 : .45,
    params: Object.fromEntries(Object.entries(EFFECT_PARAMS[id]).map(([key, spec]) => [key, spec.initial])) } as Extract<ShaderEffect, { id: K }>;
}
export type Wallpaper = {
  type: WallpaperType; effect: ShaderEffect | null; colors: string[]; angle: number;
  assetId: string | null; x: number; y: number; zoom: number; blur: number;
};
export type AppearanceVariant = {
  wallpaper: Wallpaper;
  pattern: { id: PatternId; opacity: number };
  overlay: number;
  bubbles: { custom: boolean; user: string[]; assistant: string };
};
export type ChatAppearance = {
  version: 2; presetId: string; motion: MotionMode; speed: number;
  variants: Record<AppearanceMode, AppearanceVariant>;
};
export type AppearanceDocument = {
  version: 2; revision: number; global: ChatAppearance;
  overrides: Record<string, ChatAppearance>;
};
export type AppearanceResult<T> = { ok: true; value: T; warning?: string } | { ok: false; error: string };
export type AppearanceSave = { expectedRevision: number; scope: string; appearance: ChatAppearance | null };
export type ImageAsset = { id: string; mime: string; base64: string };
export type ThemePackage = { format: "near-chat-theme"; version: 2; name: string; appearance: ChatAppearance; assets: ImageAsset[] };
export const MODES: AppearanceMode[] = ["light", "dim", "dark"];
export const ASSET_ID = /^[a-f0-9]{64}$/;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const PRESET_IDS = ["default", "mist", "forest", "dusk"] as const;
export type PresetId = typeof PRESET_IDS[number];
const COLOR = /^#[0-9a-fA-F]{6}$/;
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid appearance object");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !keys.includes(k))) throw new Error("Unknown appearance field");
  return v;
}
function num(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error("Appearance value out of range");
  return v;
}
function choice<T extends string>(v: unknown, options: readonly T[]): T {
  if (typeof v !== "string" || !options.includes(v as T)) throw new Error("Unknown appearance option");
  return v as T;
}
function color(v: unknown): string {
  if (typeof v !== "string" || !COLOR.test(v)) throw new Error("Expected #RRGGBB color");
  return v.toUpperCase();
}
function colors(v: unknown, min: number, max: number): string[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new Error("Invalid color count");
  return v.map(color);
}
export function validScope(scope: unknown): scope is string {
  return typeof scope === "string" && /^(global|meta|(?:avatar|group):[^\s:][^\s]{0,199})$/.test(scope);
}
export function resolveAppearanceScope(avatarId: string | null | undefined): string {
  if (!avatarId) return "meta";
  if (avatarId.startsWith("automation:")) return "global";
  return avatarId.startsWith("group:") ? avatarId : `avatar:${avatarId}`;
}
export function defaultAppearance(): ChatAppearance {
  const variants = {} as Record<AppearanceMode, AppearanceVariant>;
  for (const mode of MODES) variants[mode] = {
    wallpaper: { type: "default", effect: null, colors: ["#60A5FA", "#A5B4FC"], angle: 135, assetId: null, x: 0.5, y: 0.5, zoom: 1, blur: 0 },
    pattern: { id: "none", opacity: 0.08 }, overlay: 0,
    bubbles: { custom: false, user: ["#2563EB"], assistant: mode === "light" ? "#E9E9EB" : "#3B3B3D" },
  };
  return { version: 2, presetId: "default", motion: "off", speed: 1, variants };
}
export function emptyAppearanceDocument(): AppearanceDocument {
  return { version: 2, revision: 0, global: defaultAppearance(), overrides: {} };
}
function mix(hex: string, base: string, weight: number): string {
  const channel = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * weight + parseInt(base.slice(i, i + 2), 16) * (1 - weight)).toString(16).padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase();
}
export function presetAppearance(id: PresetId): ChatAppearance {
  const a = defaultAppearance();
  if (id === "default") return a;
  const palette = {
    mist: ["#60A5FA", "#A5B4FC", "#67E8F9", "#CBD5E1"],
    forest: ["#34D399", "#A3E635", "#5EEAD4", "#94A3B8"],
    dusk: ["#A78BFA", "#F0ABFC", "#FDA4AF", "#93C5FD"],
  }[id];
  a.presetId = id; a.motion = "on-send";
  for (const mode of MODES) {
    const v = a.variants[mode];
    const base = mode === "light" ? "#FFFFFF" : mode === "dim" ? "#24262B" : "#111318";
    v.wallpaper.type = "gradient";
    v.wallpaper.colors = palette.map(c => mix(c, base, mode === "light" ? 0.3 : 0.2));
    v.pattern = { id: "dots", opacity: 0.06 };
    v.bubbles = { custom: true, user: [mix(palette[0], "#172554", 0.55), mix(palette[1], "#172554", 0.55)], assistant: mode === "light" ? "#FFFFFF" : "#30333B" };
  }
  return a;
}
function parseEffect(value: unknown, type: WallpaperType): ShaderEffect | null {
  if (type !== "shader") {
    if (value !== null) throw Error("Unexpected background effect");
    return null;
  }
  const effect = object(value, ["id", "opacity", "params"]);
  const id = choice(effect.id, EFFECT_IDS);
  const specs: Record<string, EffectParameter> = EFFECT_PARAMS[id];
  const raw = object(effect.params, Object.keys(specs));
  const params = Object.fromEntries(Object.entries(specs).map(([key, spec]) => {
    const value = num(raw[key], spec.min, spec.max);
    if (spec.step === 1 && !Number.isInteger(value)) throw Error("Expected integer effect parameter");
    return [key, value];
  }));
  return { id, opacity: num(effect.opacity, 0, 1), params } as ShaderEffect;
}
export function parseAppearance(value: unknown): ChatAppearance {
  const a = object(value, ["version", "presetId", "motion", "speed", "variants"]);
  if (a.version !== 1 && a.version !== 2) throw new Error("Unsupported appearance version");
  const vs = object(a.variants, MODES);
  const variants = {} as ChatAppearance["variants"];
  for (const mode of MODES) {
    const v = object(vs[mode], ["wallpaper", "pattern", "overlay", "bubbles"]);
    const w = object(v.wallpaper, ["type", "colors", "angle", "assetId", "x", "y", "zoom", "blur", ...(a.version === 2 ? ["effect"] : [])]);
    const p = object(v.pattern, ["id", "opacity"]);
    const b = object(v.bubbles, ["custom", "user", "assistant"]);
    const type = choice(w.type, ["default", "solid", "gradient", "image", "shader"] as const);
    if (w.assetId !== null && (typeof w.assetId !== "string" || !ASSET_ID.test(w.assetId))) throw new Error("Invalid wallpaper asset");
    if (type === "image" && !w.assetId) throw new Error("Missing wallpaper asset");
    if (typeof b.custom !== "boolean") throw new Error("Invalid bubble option");
    variants[mode] = {
      wallpaper: { type, effect: a.version === 1 ? (type === "shader" ? defaultEffect("gradient") : null) : parseEffect(w.effect, type), colors: colors(w.colors, 2, 4), angle: num(w.angle, 0, 360), assetId: type === "image" ? w.assetId as string : null, x: num(w.x, 0, 1), y: num(w.y, 0, 1), zoom: num(w.zoom, 1, 3), blur: num(w.blur, 0, 24) },
      pattern: { id: choice(p.id, ["none", "dots", "grid", "waves"] as const), opacity: num(p.opacity, 0, 1) },
      overlay: num(v.overlay, 0, 1), bubbles: { custom: b.custom, user: colors(b.user, 1, 2), assistant: color(b.assistant) },
    };
  }
  if (typeof a.presetId !== "string" || !/^[a-z0-9-]{1,64}$/.test(a.presetId)) throw new Error("Invalid preset ID");
  return { version: 2, presetId: a.presetId, motion: choice(a.motion, ["off", "on-send", "continuous"] as const), speed: num(a.speed, 0.25, 2), variants };
}
export function parseDocument(value: unknown): AppearanceDocument {
  const d = object(value, ["version", "revision", "global", "overrides"]);
  if ((d.version !== 1 && d.version !== 2) || typeof d.revision !== "number" || !Number.isSafeInteger(d.revision) || d.revision < 0) throw new Error("Invalid appearance document");
  if (!d.overrides || typeof d.overrides !== "object" || Array.isArray(d.overrides)) throw new Error("Invalid appearance overrides");
  const overrides: Record<string, ChatAppearance> = {};
  for (const [scope, a] of Object.entries(d.overrides)) {
    if (!validScope(scope) || scope === "global") throw new Error("Invalid appearance scope");
    overrides[scope] = parseAppearance(a);
  }
  return { version: 2, revision: d.revision, global: parseAppearance(d.global), overrides };
}
export function resolveAppearance(doc: AppearanceDocument, scope: string): ChatAppearance {
  return doc.overrides[scope] ?? doc.global;
}
export function referencedAssets(a: ChatAppearance): string[] {
  return [...new Set(MODES.flatMap(m => {
    const w = a.variants[m].wallpaper;
    return w.type === "image" && w.assetId ? [w.assetId] : [];
  }))];
}
export function parseThemePackage(value: unknown): ThemePackage {
  const p = object(value, ["format", "version", "name", "appearance", "assets"]);
  if (p.format !== "near-chat-theme" || (p.version !== 1 && p.version !== 2)) throw new Error("Unsupported theme package version");
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 80) throw new Error("Invalid theme name");
  if (!Array.isArray(p.assets) || p.assets.length > 3) throw new Error("Invalid theme assets");
  const assets = p.assets.map(raw => {
    const asset = object(raw, ["id", "mime", "base64"]);
    if (typeof asset.id !== "string" || !ASSET_ID.test(asset.id)) throw new Error("Invalid asset ID");
    const mime = choice(asset.mime, ["image/png", "image/jpeg", "image/webp"] as const);
    if (typeof asset.base64 !== "string" || !(asset.base64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(asset.base64)) || !asset.base64.length || asset.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error("Invalid asset contents");
    return { id: asset.id, mime, base64: asset.base64 };
  });
  const appearance = parseAppearance(p.appearance);
  const needed = referencedAssets(appearance);
  if (new Set(assets.map(a => a.id)).size !== assets.length || needed.length !== assets.length || needed.some(id => !assets.some(a => a.id === id))) throw new Error("Theme assets do not match wallpaper references");
  return { format: "near-chat-theme", version: 2, name: p.name.trim(), appearance, assets };
}
