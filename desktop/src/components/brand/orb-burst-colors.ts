import { accentPrimaryRgb, type EmptyAccentId, type EmptyThemeMode } from "./recolor-empty-lottie";

export function rgb01ToHex(rgb: readonly [number, number, number]): string {
  const ch = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${ch(rgb[0])}${ch(rgb[1])}${ch(rgb[2])}`;
}

function liftTowardWhite(rgb: readonly [number, number, number]): [number, number, number] {
  const t = 0.42;
  return [
    rgb[0] + (1 - rgb[0]) * t,
    rgb[1] + (1 - rgb[1]) * t,
    rgb[2] + (1 - rgb[2]) * t,
  ];
}

export function orbBurstColors(
  accent: EmptyAccentId,
  theme: EmptyThemeMode = "dark",
): { dot: string; accent: string } {
  const primary = accentPrimaryRgb(accent, theme);
  return {
    dot: rgb01ToHex(primary),
    accent: rgb01ToHex(liftTowardWhite(primary)),
  };
}
