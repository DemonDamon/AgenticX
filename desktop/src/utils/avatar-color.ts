// ── Avatar (individual) palette ──────────────────────────────────────────────
export const AVATAR_PALETTE = ["blue", "white", "black"] as const;
export type AvatarPaletteKey = (typeof AVATAR_PALETTE)[number];

export const AVATAR_COLOR_LABEL: Record<AvatarPaletteKey, string> = {
  blue: "蓝色",
  white: "白色",
  black: "黑色",
};

// ── Group palette (distinct from avatar palette) ──────────────────────────────
const GROUP_PALETTE = [
  "indigo", "teal", "pink", "lime",
  "red", "blue", "yellow", "purple",
] as const;
type GroupPaletteKey = (typeof GROUP_PALETTE)[number];

function hashToIndex(id: string, mod: number): number {
  let hash = 0;
  for (const ch of id) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % mod;
}

function isGroupId(id: string): boolean {
  return id.startsWith("group:");
}

function rawGroupId(id: string): string {
  return id.startsWith("group:") ? id.slice(6) : id;
}

export function isAvatarPaletteKey(value: string): value is AvatarPaletteKey {
  return (AVATAR_PALETTE as readonly string[]).includes(value);
}

/**
 * Empty / invalid values are treated as the default blue avatar color by the
 * rendering helpers below. Valid values are limited to the monochrome palette.
 */
export function normalizeAvatarColor(color?: string | null): AvatarPaletteKey | "" {
  const key = String(color ?? "").trim().toLowerCase();
  return isAvatarPaletteKey(key) ? key : "";
}

/** @deprecated Prefer normalizeAvatarColor — hash default removed (Meta-aligned). */
export function avatarColorKey(id: string, color?: string | null): AvatarPaletteKey | "" {
  void id;
  return normalizeAvatarColor(color);
}

// ── Public: bg Tailwind class ─────────────────────────────────────────────────

/** Solid circle / initials background. Empty color → blue. */
export function avatarBgClass(color?: string | null): string {
  const key = normalizeAvatarColor(color);
  if (key === "white") return "bg-white";
  if (key === "black") return "bg-slate-900";
  return "bg-blue-600";
}

/** Initials on avatar circle: white background uses dark text. */
export function avatarFgClass(color?: string | null): string {
  const key = normalizeAvatarColor(color);
  return key === "white" ? "text-slate-900" : "text-white";
}

export function groupColorKey(id: string): GroupPaletteKey {
  const raw = rawGroupId(id);
  return GROUP_PALETTE[hashToIndex(raw, GROUP_PALETTE.length)];
}

export function groupBgClass(id: string): string {
  return `bg-${groupColorKey(id)}-600`;
}

/** Assign group color by list index — guarantees adjacent groups get different colors */
export function groupColorByIndex(index: number): { iconBg: string; dotColor: string } {
  const key = GROUP_PALETTE[index % GROUP_PALETTE.length];
  return { iconBg: GROUP_SOLID[key], dotColor: GROUP_DOT[key] };
}

// ── Tint rgba maps ────────────────────────────────────────────────────────────

const AVATAR_TINT: Record<AvatarPaletteKey, string> = {
  blue:  "rgba(59,130,246,0.07)",
  white: "rgba(255,255,255,0.07)",
  black: "rgba(15,23,42,0.07)",
};

const GROUP_TINT: Record<GroupPaletteKey, string> = {
  indigo:  "rgba(99,102,241,0.07)",
  teal:    "rgba(20,184,166,0.07)",
  pink:    "rgba(236,72,153,0.07)",
  lime:    "rgba(132,204,22,0.07)",
  red:     "rgba(239,68,68,0.07)",
  blue:    "rgba(59,130,246,0.07)",
  yellow:  "rgba(234,179,8,0.07)",
  purple:  "rgba(168,85,247,0.07)",
};

// Solid bg color for avatar icon (60% opacity equivalent as CSS rgba)
const GROUP_SOLID: Record<GroupPaletteKey, string> = {
  indigo:  "rgba(99,102,241,0.75)",
  teal:    "rgba(20,184,166,0.75)",
  pink:    "rgba(236,72,153,0.75)",
  lime:    "rgba(132,204,22,0.75)",
  red:     "rgba(239,68,68,0.75)",
  blue:    "rgba(59,130,246,0.75)",
  yellow:  "rgba(234,179,8,0.75)",
  purple:  "rgba(168,85,247,0.75)",
};

const GROUP_DOT: Record<GroupPaletteKey, string> = {
  indigo:  "rgb(165,180,252)",
  teal:    "rgb(94,234,212)",
  pink:    "rgb(249,168,212)",
  lime:    "rgb(217,249,157)",
  red:     "rgb(252,165,165)",
  blue:    "rgb(147,197,253)",
  yellow:  "rgb(253,224,71)",
  purple:  "rgb(216,180,254)",
};

/** Sidebar「已开窗格」小圆点 — 与同分身头像 `avatarBgClass` 色系一致 */
const AVATAR_DOT: Record<AvatarPaletteKey, string> = {
  blue:  "rgb(59, 130, 246)",
  white: "rgb(148, 163, 184)",
  black: "rgb(15, 23, 42)",
};

/** Preview swatches for the settings color picker. */
export const AVATAR_COLOR_SWATCH: Record<AvatarPaletteKey, string> = {
  blue:  "rgb(59, 130, 246)",
  white: "rgb(255, 255, 255)",
  black: "rgb(15, 23, 42)",
};

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Transparent background tint for pane.
 * - group ids → group palette
 * - avatar with empty color → blue tint
 * - avatar with palette color → that tint
 */
export function avatarTintBg(
  id: string | null | undefined,
  color?: string | null,
): string | undefined {
  if (!id) return undefined;
  if (isGroupId(id)) return GROUP_TINT[groupColorKey(id)];
  const key = normalizeAvatarColor(color) || "blue";
  return AVATAR_TINT[key];
}

/** Solid background color for group avatar icon */
export function groupIconBg(id: string): string {
  return GROUP_SOLID[groupColorKey(id)];
}

/** Dot / indicator color for group hasPane indicator */
export function groupDotColor(id: string): string {
  return GROUP_DOT[groupColorKey(id)];
}

/** Dot color for avatar hasPane indicator */
export function avatarDotColor(color?: string | null): string {
  const key = normalizeAvatarColor(color) || "blue";
  return AVATAR_DOT[key];
}

/**
 * Prefer explicit palette color; if unset, hash avatar id into AVATAR_PALETTE
 * so different agents stay visually distinct (e.g. history chip stripes).
 */
export function avatarDotColorForIdentity(
  id: string,
  color?: string | null,
): string {
  const key = normalizeAvatarColor(color);
  if (key) return AVATAR_DOT[key];
  const hashed = AVATAR_PALETTE[hashToIndex(id, AVATAR_PALETTE.length)];
  return AVATAR_DOT[hashed];
}

export function avatarTintBorder(
  id: string | null | undefined,
  color?: string | null,
): string | undefined {
  if (!id) return undefined;
  if (isGroupId(id)) return undefined;
  const key = normalizeAvatarColor(color) || "blue";
  const AVATAR_BORDER: Record<AvatarPaletteKey, string> = {
    blue:  "rgba(59,130,246,0.15)",
    white: "rgba(255,255,255,0.15)",
    black: "rgba(15,23,42,0.15)",
  };
  return AVATAR_BORDER[key];
}
