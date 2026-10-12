/**
 * 市场卡片图标:优先真实图片(上游 logo_url / 推荐位 icon_src),
 * 无图或加载失败回退到按名称确定性选取的渐变底座 + 行业图标。
 *
 * 渲染口径(自适应,避开「白垫铬」与「全出血裁切」两端):
 * - 圆角瓷砖 + object-contain + 适度内缩(~10–14% 边距),品牌完整可见、有呼吸感。
 * - 瓷砖底:随 data-theme 自适应 — 浅色 #F2F2F7、深色/dim #1C1C1E;仅深色主题下反白的近黑字形用品牌深色 tint。
 * - 明暗口径 MarkTone(brand-assets.MARK_TONE + SVG 实际填色,含隐式默认黑):
 *   单色近黑仅在深色主题反白;单色近白仅在浅色主题压黑;黑白双色(duo,如 Notion)与彩色标永不加滤镜。
 * - Vite 会把小 SVG 内联成 data:image/svg+xml — 必须按 SVG 字形处理,不能当 App 图标 cover。
 * - 光栅(PNG):同样 contain + 内缩;仅显式全出血 App 瓷砖才走 cover(见 FULL_BLEED_COVER)。
 */

import { useState } from "react";
import {
  CloudSun,
  Code2,
  Database,
  FileText,
  FlaskConical,
  GitBranch,
  Globe,
  Image as ImageIcon,
  Languages,
  Mail,
  Map,
  MessageSquare,
  Music,
  Search,
  Sparkles,
  Video,
} from "lucide-react";
import { useAppStore } from "../../store";
import { pickBrandIcon, pickGradientFor, pickMarketIconGlyph, type MarketIconGlyph } from "./icon-model";
import { BRAND_ICON_SRC, MARK_TILE_BG, MARK_TONE, type MarkTone } from "./brand-assets";

const GLYPH_ICONS: Record<MarketIconGlyph, typeof Sparkles> = {
  map: Map,
  search: Search,
  video: Video,
  image: ImageIcon,
  file: FileText,
  code: Code2,
  database: Database,
  mail: Mail,
  chat: MessageSquare,
  globe: Globe,
  git: GitBranch,
  music: Music,
  languages: Languages,
  flask: FlaskConical,
  cloud: CloudSun,
  sparkles: Sparkles,
};

/** 深色 / dim 中性瓷砖(与 --surface-base 对齐)。 */
export const NEUTRAL_TILE_BG_DARK = "#1C1C1E";
/** 浅色中性瓷砖(surface-secondary 感),避免白卡片上的黑垫。 */
export const NEUTRAL_TILE_BG_LIGHT = "#F2F2F7";

export function isDarkLikeTheme(theme: string | null | undefined): boolean {
  return theme !== "light";
}

export function neutralTileBg(darkLike: boolean): string {
  return darkLike ? NEUTRAL_TILE_BG_DARK : NEUTRAL_TILE_BG_LIGHT;
}

/**
 * 字形标 / SVG:含 Vite 内联的 data:image/svg+xml、.svg URL、Simple Icons CDN。
 * 这些是 logo mark,不是铺满圆角的 App Store 瓷砖图。
 */
export function isMarkStyleAsset(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:image/svg+xml")) return true;
  if (src.includes("cdn.simpleicons.org")) return true;
  return /\.svg(\?|#|$)/i.test(src);
}

/** Simple Icons 多为单色字形,适合品牌色瓷砖 + 可选反白。 */
function isSimpleIconsCdn(src: string): boolean {
  return src.includes("cdn.simpleicons.org");
}

/**
 * 显式全出血 App 图标(已是方瓷砖、应 cover 铺满)。
 * 默认空:用户反馈后连「类 App 图标」PNG 也改 contain + 小内缩,避免圆角裁切。
 */
const FULL_BLEED_COVER: ReadonlySet<string> = new Set([]);

/** 名称关键词兜底瓷砖色(品牌表未命中时仍避免白垫)。 */
const MARK_TILE_NAME_RULES: ReadonlyArray<readonly [readonly string[], string]> = [
  [["github"], "#24292F"],
  [["gitlab"], "#FC6D26"],
  [["gitee"], "#C71D23"],
  [["slack"], "#4A154B"],
  [["notion"], "#000000"],
  [["linear"], "#5E6AD2"],
  [["asana"], "#F06A6A"],
  [["zoom"], "#0B5CFF"],
  [["gmail", "google mail"], "#EA4335"],
  [["google drive", "gdrive"], "#1A73E8"],
  [["airtable"], "#18BFFF"],
  [["supabase"], "#3ECF8E"],
  [["bigquery"], "#669DF6"],
  [["postgres"], "#4169E1"],
  [["mysql"], "#4479A1"],
  [["mongodb", "mongo"], "#47A248"],
  [["redis"], "#DC382D"],
  [["docker"], "#2496ED"],
  [["vercel"], "#000000"],
  [["cloudflare"], "#F38020"],
  [["brave"], "#FB542B"],
  [["agent mail", "qqmail", "agently"], "#1C1C1E"],
];

/** 名称关键词:已知近黑字形(即使 brand key 未命中也反白)。 */
const INVERT_NAME_KEYWORDS = [
  "github",
  "vercel",
  "ollama",
  "agent mail",
  "qqmail",
  "agently",
] as const;

/** 近黑通道阈值(#161614 / #111111 / #181717 均低于此)。 */
const NEAR_BLACK_MAX = 0x38;

function parseHexRgb(raw: string): { r: number; g: number; b: number } | null {
  let h = raw.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function isNearBlackColor(raw: string): boolean {
  const c = raw.trim().toLowerCase();
  if (!c || c === "none" || c === "transparent" || c.startsWith("url(")) return false;
  if (c === "black" || c === "#000" || c === "#000000") return true;
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return Math.max(+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]) < NEAR_BLACK_MAX;
  }
  if (!c.startsWith("#")) return false;
  const rgb = parseHexRgb(c);
  if (!rgb) return false;
  return Math.max(rgb.r, rgb.g, rgb.b) < NEAR_BLACK_MAX;
}

function isNearWhiteOrLightColor(raw: string): boolean {
  const c = raw.trim().toLowerCase();
  if (c === "white" || c === "#fff" || c === "#ffffff") return true;
  const rgb = c.startsWith("#") ? parseHexRgb(c) : null;
  if (!rgb) return false;
  return Math.min(rgb.r, rgb.g, rgb.b) >= 0xe0;
}

/** 解码 Vite 内联的 data:image/svg+xml(含 charset / base64)。 */
export function decodeSvgDataUri(src: string): string | null {
  if (!src.startsWith("data:image/svg+xml")) return null;
  const comma = src.indexOf(",");
  if (comma < 0) return null;
  const meta = src.slice(0, comma);
  const payload = src.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) {
      if (typeof atob === "function") return atob(payload);
      const Buf = (globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } }).Buffer;
      return Buf ? Buf.from(payload, "base64").toString("utf8") : null;
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function attrFill(attrs: string): string | null {
  const style = attrs.match(/\bstyle\s*=\s*["'][^"']*\bfill\s*:\s*([^;"']+)/i);
  if (style) return style[1].trim();
  const fill = attrs.match(/\bfill\s*=\s*["']([^"']+)["']/i);
  return fill ? fill[1].trim() : null;
}

function isPaintedFill(c: string): boolean {
  const lower = c.toLowerCase();
  return Boolean(lower) && lower !== "none" && lower !== "transparent" && !lower.startsWith("url(");
}

/**
 * 实际绘制用到的填色(含隐式默认黑):
 * 形状元素无 fill 时继承最近的 <g>/<svg> fill;都没有则按 SVG 规范默认为黑色。
 * 旧实现只收集显式 fill="…",于是 Notion(白方块 fill="#fff" + 隐式黑 N)被误判为「纯白字形」,
 * 浅色主题再叠 brightness(0) 就压成实心黑块。
 */
export function extractSvgFillColors(svg: string): string[] {
  const found = new Set<string>();
  const rootMatch = svg.match(/<svg\b([^>]*)>/i);
  const rootFill = rootMatch ? attrFill(rootMatch[1]) : null;
  // 简化继承:记录 <g fill> 栈(SVG 资产一般结构简单)。
  const stack: Array<string | null> = [rootFill];
  const tokenRe = /<(\/?)(g|path|circle|rect|ellipse|polygon|polyline|text|line|use)\b([^>]*?)(\/?)>/gi;
  let sawShape = false;
  for (const m of svg.matchAll(tokenRe)) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? "";
    const selfClosing = m[4] === "/" || /\/\s*$/.test(attrs);
    if (tag === "g") {
      if (closing) {
        if (stack.length > 1) stack.pop();
      } else if (!selfClosing) {
        stack.push(attrFill(attrs) ?? stack[stack.length - 1]);
      }
      continue;
    }
    if (closing) continue;
    sawShape = true;
    if (tag === "line" || tag === "polyline") {
      const own = attrFill(attrs);
      if (own) found.add(own);
      continue;
    }
    const fill = attrFill(attrs) ?? stack[stack.length - 1] ?? "#000000";
    found.add(fill.trim());
  }
  if (!sawShape) {
    for (const m of svg.matchAll(/\bfill\s*=\s*["']([^"']+)["']/gi)) found.add(m[1].trim());
    for (const m of svg.matchAll(/\bfill\s*:\s*([^;}"']+)/gi)) found.add(m[1].trim());
  }
  return [...found].filter(isPaintedFill);
}

/** 由 SVG 源码判定明暗口径;彩色标返回 "color",无可判定填色返回 null。 */
export function classifySvgTone(svg: string): MarkTone | "color" | null {
  const colors = extractSvgFillColors(svg);
  if (colors.length === 0) return null;
  const chromatic = colors.some((c) => !isNearBlackColor(c) && !isNearWhiteOrLightColor(c));
  if (chromatic) return "color";
  const dark = colors.some(isNearBlackColor);
  const light = colors.some(isNearWhiteOrLightColor);
  if (dark && light) return "duo";
  if (dark) return "dark";
  if (light) return "light";
  return null;
}

/** data-URI SVG 是否为近黑单色字形(无彩色、无白色对比块)。 */
export function isNearBlackMonochromeSvgDataUri(src: string): boolean {
  const svg = decodeSvgDataUri(src);
  return svg ? classifySvgTone(svg) === "dark" : false;
}

/** data-URI SVG 是否为近白单色字形(不含黑色细节;Notion 这类黑白双色标返回 false)。 */
export function isNearWhiteMonochromeSvgDataUri(src: string): boolean {
  const svg = decodeSvgDataUri(src);
  return svg ? classifySvgTone(svg) === "light" : false;
}

function pickMarkTileBg(name: string, brandKey?: string, fallback: string = NEUTRAL_TILE_BG_DARK): string {
  if (brandKey && MARK_TILE_BG[brandKey]) return MARK_TILE_BG[brandKey];
  const n = name.toLowerCase();
  for (const [keywords, bg] of MARK_TILE_NAME_RULES) {
    if (keywords.some((k) => n.includes(k))) return bg;
  }
  return fallback;
}

/**
 * 字形明暗口径:品牌表 → 名称关键词(近黑)→ data-URI SVG 实际填色(含隐式黑)。
 * 开发态 SVG 是 URL 拿不到内容,故品牌表优先。
 */
export function resolveMarkTone(
  name: string,
  brandKey?: string,
  src?: string,
): MarkTone | "color" | null {
  if (brandKey && MARK_TONE[brandKey]) return MARK_TONE[brandKey];
  const n = name.toLowerCase();
  if (INVERT_NAME_KEYWORDS.some((k) => n.includes(k))) return "dark";
  if (src) {
    const svg = decodeSvgDataUri(src);
    if (svg) return classifySvgTone(svg);
  }
  return null;
}

/**
 * 字形是否需要滤镜翻转以贴合当前主题瓷砖。
 * - 深色/dim:仅单色近黑字形反白。
 * - 浅色:仅单色近白字形压黑。
 * - duo(自带黑白对比,如 Notion)与彩色标:任何主题都不加滤镜。
 * 不用 Tailwind brightness/invert 类名 — 生产 CSS 未必含这些 utility。
 */
export function shouldInvertMark(
  name: string,
  brandKey?: string,
  src?: string,
  darkLike: boolean = true,
): boolean {
  const tone = resolveMarkTone(name, brandKey, src);
  return darkLike ? tone === "dark" : tone === "light";
}

/** 深色瓷砖上强制白化近黑字形(等价 brightness-0 + invert)。 */
export const MARK_INVERT_FILTER = "brightness(0) invert(1)";
/** 浅色瓷砖上强制压黑近白字形。 */
export const MARK_TO_DARK_FILTER = "brightness(0)";

/**
 * 瓷砖底口径:默认中性(浅色 #F2F2F7 / 深色 #1C1C1E)。
 * Simple Icons CDN 默认就是品牌色字形 — 再铺同色品牌底会「同色隐身」(Docker 蓝标铺 #2496ED),故不 tint。
 * 仅深色主题下被反白的近黑字形使用品牌深色瓷砖(如 GitHub #24292F),白字形在其上可读。
 * 浅色主题永不使用品牌/近黑垫。
 */
export function pickTileBackground(opts: {
  name: string;
  brandKey?: string;
  src: string;
  mark: boolean;
  invert: boolean;
  darkLike: boolean;
}): string {
  const { name, brandKey, mark, invert, darkLike } = opts;
  const neutral = neutralTileBg(darkLike);
  if (!darkLike || !mark || !invert) return neutral;
  const bg = pickMarkTileBg(name, brandKey, neutral);
  // 反白后是白字形:瓷砖必须足够深,否则退回中性深底。
  const rgb = bg.startsWith("#") ? parseHexRgb(bg) : null;
  if (rgb && 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b > 110) return neutral;
  return bg;
}

type Props = {
  name: string;
  /** MCP 市场上游 logo 地址。 */
  logoUrl?: string;
  /** 推荐位自带的图标地址(优先于 logoUrl)。 */
  iconSrc?: string;
  className?: string;
};

export function MarketIcon({ name, logoUrl, iconSrc, className = "h-10 w-10" }: Props) {
  const [broken, setBroken] = useState(false);
  const theme = useAppStore((s) => s.theme);
  const darkLike = isDarkLikeTheme(theme);
  // 图标优先级:推荐位图标 → 品牌图标(本地打包优先,国际品牌走 Simple Icons CDN) → 上游 logo → 渐变底座。
  const brand = pickBrandIcon(name);
  const brandSrc = brand
    ? (BRAND_ICON_SRC[brand.brand] ?? `https://cdn.simpleicons.org/${brand.brand}`)
    : undefined;
  const img = iconSrc || brandSrc || logoUrl;
  if (img && !broken) {
    const mark = isMarkStyleAsset(img);
    const forceCover = Boolean(brand?.brand && FULL_BLEED_COVER.has(brand.brand));
    const invert = mark && shouldInvertMark(name, brand?.brand, img, darkLike);
    const tileBg = pickTileBackground({
      name,
      brandKey: brand?.brand,
      src: img,
      mark,
      invert,
      darkLike,
    });
    // 字形 ~70%(约 15% 边距);光栅略大 ~76%(约 12% 边距),仍避开圆角裁切。
    const insetClass = mark ? "h-[70%] w-[70%]" : "h-[76%] w-[76%]";
    // Comate-like: theme-token hairline only — never ring-* (Tailwind default ring is theme blue).
    const tileChrome = "border border-border";
    const markFilter = invert
      ? darkLike
        ? MARK_INVERT_FILTER
        : MARK_TO_DARK_FILTER
      : undefined;

    if (forceCover) {
      return (
        <span
          className={`${className} flex shrink-0 overflow-hidden rounded-xl ${tileChrome}`}
        >
          <img
            src={img}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        </span>
      );
    }

    return (
      <span
        className={`${className} flex shrink-0 items-center justify-center overflow-hidden rounded-xl ${tileChrome}`}
        style={{ backgroundColor: tileBg }}
      >
        <img
          src={img}
          alt=""
          className={`${insetClass} object-contain`}
          style={markFilter ? { filter: markFilter } : undefined}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      </span>
    );
  }
  const Glyph = GLYPH_ICONS[pickMarketIconGlyph(name)] ?? Sparkles;
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${pickGradientFor(
        name,
      )} text-white shadow-sm border border-border`}
      data-market-icon-gradient={pickGradientFor(name)}
    >
      <Glyph className="h-[55%] w-[55%] text-white/95" aria-hidden />
    </span>
  );
}
