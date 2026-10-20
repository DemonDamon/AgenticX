import type { CSSProperties } from "react";
import type { AppearanceMode, ChatAppearance, Wallpaper } from "../../shared/chat-appearance";
function luminance(hex: string) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function bubbleText(colors: string[]): string {
  // Maximize the weakest contrast, including the midpoint of a gradient.
  const sample = [...colors];
  if (colors.length === 2) sample.push("#" + [1, 3, 5].map(i => Math.round((parseInt(colors[0].slice(i, i + 2), 16) + parseInt(colors[1].slice(i, i + 2), 16)) / 2).toString(16).padStart(2, "0")).join(""));
  const black = Math.min(...sample.map(c => (luminance(c) + 0.05) / 0.05));
  const white = Math.min(...sample.map(c => 1.05 / (luminance(c) + 0.05)));
  return black >= white ? "#000000" : "#FFFFFF";
}
export function appearanceVariables(a: ChatAppearance, mode: AppearanceMode, bubbles: boolean): CSSProperties {
  const b = a.variants[mode].bubbles;
  if (!bubbles || !b.custom) return {};
  return {
    "--chat-im-user-bg": b.user.length === 2 ? `linear-gradient(135deg, ${b.user.join(", ")})` : b.user[0],
    "--chat-im-user-text": bubbleText(b.user),
    "--chat-im-assistant-bg": b.assistant,
    "--chat-im-assistant-text": bubbleText([b.assistant]),
  } as CSSProperties;
}
export function gradientColors(w: Wallpaper): [string, string, string, string] {
  const c = w.colors;
  return [c[0], c[1], c[2] ?? c[0], c[3] ?? (c.length === 2 ? c[1] : c[0])];
}
export function wallpaperBackground(w: Wallpaper): string | undefined {
  if (w.type === "default" || w.type === "image") return undefined;
  if (w.type === "solid") return w.colors[0];
  const c = gradientColors(w);
  const base = `linear-gradient(${(w.angle + 90) % 360}deg, ${c[2]}80, ${c[3]}80), linear-gradient(${w.angle}deg, ${c[0]}, ${c[1]})`;
  if (w.type !== "shader" || !w.effect) return base;
  const effect = w.effect;
  const alpha = Math.round(effect.opacity * 48).toString(16).padStart(2, "0");
  const ink = `${c[1]}${alpha}`;
  switch (effect.id) {
    case "noise": return `radial-gradient(${ink} .75px, transparent 1px) 0 0 / 4px 4px, ${base}`;
    case "ripples": return `repeating-radial-gradient(circle at center, transparent 0 18px, ${ink} 19px 22px, transparent 23px 35px), ${base}`;
    case "glass": return `radial-gradient(ellipse at center, transparent 30%, ${ink} 48%, transparent 52%), ${base}`;
    case "fluted-glass": return `repeating-linear-gradient(${effect.params.angle + 90}deg, transparent 0 18px, ${ink} 20px 23px, transparent 25px 40px), ${base}`;
    default: return base;
  }
}
export const PATTERN_STYLES: Record<string, CSSProperties> = {
  none: {},
  dots: { backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)", backgroundSize: "20px 20px" },
  grid: { backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)", backgroundSize: "32px 32px" },
  waves: { backgroundImage: "repeating-radial-gradient(ellipse at 0 50%, transparent 0 12px, currentColor 13px 14px, transparent 15px 26px)", backgroundSize: "64px 48px" },
};


/** Palette-derived light/dark anchors keep effects visible with near-identical colors. */
export function effectTone(hex: string, target: number, amount: number): string {
  return "#" + [1, 3, 5].map(i => {
    const value = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(value + (target - value) * amount).toString(16).padStart(2, "0");
  }).join("").toUpperCase();
}

/** Small static selection swatches emphasize each effect's shape without six GPU canvases. */
export function effectPreviewBackground(w: Wallpaper): string {
  const c = gradientColors(w);
  const light = effectTone(c[0], 255, .48), dark = effectTone(c[1], 0, .35);
  const base = `linear-gradient(135deg, ${dark}, ${c[2]}, ${light})`;
  switch (w.effect?.id) {
    case "noise": return `radial-gradient(ellipse at 20% 70%, ${light} 0%, transparent 55%), radial-gradient(ellipse at 75% 10%, ${dark} 0%, transparent 65%), ${base}`;
    case "ripples": return `repeating-radial-gradient(ellipse at 50% 70%, ${light} 0 2px, ${dark} 4px 8px, transparent 11px 16px), ${base}`;
    case "glass": return `radial-gradient(ellipse 48px 38px at 50% 50%, ${light}50 50%, ${light} 60%, ${dark} 65%, transparent 73%), linear-gradient(115deg, transparent 35%, ${light} 48%, ${dark} 52%, transparent 65%), ${base}`;
    case "fluted-glass": return `repeating-linear-gradient(90deg, ${light} 0px, ${dark} 9px, ${c[2]} 12px, ${light} 18px), ${base}`;
    case "cursor-ripples": return `repeating-radial-gradient(circle at 72% 60%, transparent 0 9px, ${light} 10px 12px, ${dark} 13px 14px, transparent 16px 25px), ${base}`;
    default: return base;
  }
}
