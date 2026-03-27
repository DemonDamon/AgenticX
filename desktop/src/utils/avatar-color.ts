// ── Avatar (individual) palette ──────────────────────────────────────────────
const AVATAR_PALETTE = [
  "cyan", "violet", "rose", "amber",
  "emerald", "fuchsia", "sky", "orange",
] as const;
type AvatarPaletteKey = (typeof AVATAR_PALETTE)[number];

// ── Group palette (distinct from avatar palette) ──────────────────────────────
const GROUP_PALETTE = [
  "indigo", "teal", "pink", "lime",
  "red", "blue", "yellow", "purple",
] as const;
type GroupPaletteKey = (typeof GROUP_PALETTE)[number];

type PaletteKey = AvatarPaletteKey | GroupPaletteKey;

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

// ── Public: bg Tailwind class ─────────────────────────────────────────────────

export function avatarColorKey(id: string): AvatarPaletteKey {
  return AVATAR_PALETTE[hashToIndex(id, AVATAR_PALETTE.length)];
}

export function avatarBgClass(id: string): string {
  return `bg-${avatarColorKey(id)}-600`;
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
  cyan:    "rgba(8,145,178,0.07)",
  violet:  "rgba(124,58,237,0.07)",
  rose:    "rgba(225,29,72,0.07)",
  amber:   "rgba(217,119,6,0.07)",
  emerald: "rgba(5,150,105,0.07)",
  fuchsia: "rgba(192,38,211,0.07)",
  sky:     "rgba(2,132,199,0.07)",
  orange:  "rgba(234,88,12,0.07)",
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

// ── Public helpers ────────────────────────────────────────────────────────────

/** Transparent background tint for pane — works for both avatar and group ids */
export function avatarTintBg(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  if (isGroupId(id)) return GROUP_TINT[groupColorKey(id)];
  return AVATAR_TINT[avatarColorKey(id)];
}

/** Solid background color for group avatar icon */
export function groupIconBg(id: string): string {
  return GROUP_SOLID[groupColorKey(id)];
}

/** Dot / indicator color for group hasPane indicator */
export function groupDotColor(id: string): string {
  return GROUP_DOT[groupColorKey(id)];
}

export function avatarTintBorder(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const AVATAR_BORDER: Record<AvatarPaletteKey, string> = {
    cyan:    "rgba(8,145,178,0.15)",
    violet:  "rgba(124,58,237,0.15)",
    rose:    "rgba(225,29,72,0.15)",
    amber:   "rgba(217,119,6,0.15)",
    emerald: "rgba(5,150,105,0.15)",
    fuchsia: "rgba(192,38,211,0.15)",
    sky:     "rgba(2,132,199,0.15)",
    orange:  "rgba(234,88,12,0.15)",
  };
  if (isGroupId(id)) return undefined;
  return AVATAR_BORDER[avatarColorKey(id)];
}
