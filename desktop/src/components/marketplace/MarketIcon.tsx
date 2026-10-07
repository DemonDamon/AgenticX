/**
 * 市场卡片图标:优先真实图片(上游 logo_url / 推荐位 icon_src),
 * 无图或加载失败回退到按名称确定性选取的渐变底座 + 行业图标。
 *
 * 渲染口径(自适应,避开「白垫铬」与「全出血裁切」两端):
 * - 圆角瓷砖 + object-contain + 适度内缩(~10–14% 边距),品牌完整可见、有呼吸感。
 * - 瓷砖底:随 data-theme 自适应 — 浅色 #F2F2F7、深色/dim #1C1C1E;字形/Simple Icons 可用品牌色 tint(非亮白 matte)。
 * - 近黑字形仅在深色主题反白;浅色主题保持深色字形。本地白字形(如 Notion)仅在浅色主题压黑。
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
import { BRAND_ICON_SRC, MARK_INVERT_BRANDS, MARK_TILE_BG } from "./brand-assets";

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

function extractSvgFillColors(svg: string): string[] {
  const found = new Set<string>();
  for (const m of svg.matchAll(/\bfill\s*=\s*["']([^"']+)["']/gi)) {
    found.add(m[1].trim());
  }
  for (const m of svg.matchAll(/\bfill\s*:\s*([^;}"']+)/gi)) {
    found.add(m[1].trim());
  }
  return [...found].filter((c) => {
    const lower = c.toLowerCase();
    return lower && lower !== "none" && lower !== "transparent" && !lower.startsWith("url(");
  });
}

/**
 * data-URI SVG 是否为近黑单色字形(无彩色填色)。
 * 多色品牌标(Gmail/Feishu/Supabase 等)返回 false,避免误反白。
 * 纯白字形(本地 Notion)也返回 false — 深色瓷砖上已可读。
 */
export function isNearBlackMonochromeSvgDataUri(src: string): boolean {
  const svg = decodeSvgDataUri(src);
  if (!svg) return false;
  const colors = extractSvgFillColors(svg);
  if (colors.length === 0) return false;
  const nearBlack = colors.filter(isNearBlackColor);
  const chromatic = colors.filter((c) => !isNearBlackColor(c) && !isNearWhiteOrLightColor(c));
  if (chromatic.length > 0) return false;
  return nearBlack.length > 0;
}

/**
 * data-URI SVG 是否为近白单色字形(无彩色填色)。
 * 本地 Notion 等为深色瓷砖准备的白标在浅色主题需压黑。
 */
export function isNearWhiteMonochromeSvgDataUri(src: string): boolean {
  const svg = decodeSvgDataUri(src);
  if (!svg) return false;
  const colors = extractSvgFillColors(svg);
  if (colors.length === 0) return false;
  const nearWhite = colors.filter(isNearWhiteOrLightColor);
  const chromatic = colors.filter((c) => !isNearBlackColor(c) && !isNearWhiteOrLightColor(c));
  if (chromatic.length > 0) return false;
  return nearWhite.length > 0 && colors.every((c) => isNearWhiteOrLightColor(c) || isNearBlackColor(c));
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
 * 字形是否需要滤镜翻转以贴合当前主题瓷砖。
 * - 深色/dim:近黑字形反白(品牌表 / 名称关键词 / data-URI 探测)。
 * - 浅色:近黑保持原样;仅近白单色字形(如 Notion)压黑。
 * 不用 Tailwind brightness/invert 类名 — 生产 CSS 未必含这些 utility。
 */
export function shouldInvertMark(
  name: string,
  brandKey?: string,
  src?: string,
  darkLike: boolean = true,
): boolean {
  if (darkLike) {
    if (brandKey && MARK_INVERT_BRANDS.has(brandKey)) return true;
    const n = name.toLowerCase();
    if (INVERT_NAME_KEYWORDS.some((k) => n.includes(k))) return true;
    if (src && isNearBlackMonochromeSvgDataUri(src)) return true;
    return false;
  }
  if (src && isNearWhiteMonochromeSvgDataUri(src)) return true;
  if (brandKey === "notion") return true;
  if (name.toLowerCase().includes("notion")) return true;
  return false;
}

/** 深色瓷砖上强制白化近黑字形(等价 brightness-0 + invert)。 */
export const MARK_INVERT_FILTER = "brightness(0) invert(1)";
/** 浅色瓷砖上强制压黑近白字形。 */
export const MARK_TO_DARK_FILTER = "brightness(0)";

/**
 * 多色本地 SVG(iconify logos 等)用中性底,避免品牌色与彩色字形撞色
 * (如 Supabase 绿标铺在 #3ECF8E 上几乎看不见)。
 * 单色 Simple Icons / 深色主题下需反白的近黑字形仍可用品牌/深色 tint。
 * 浅色主题永不使用近黑垫(#000 / #1C1C1E 等)。
 */
export function pickTileBackground(opts: {
  name: string;
  brandKey?: string;
  src: string;
  mark: boolean;
  invert: boolean;
  darkLike: boolean;
}): string {
  const { name, brandKey, src, mark, invert, darkLike } = opts;
  const neutral = neutralTileBg(darkLike);
  if (!darkLike) {
    if (mark && isSimpleIconsCdn(src)) {
      const bg = pickMarkTileBg(name, brandKey, neutral);
      if (!isNearBlackColor(bg)) return bg;
    }
    return neutral;
  }
  if (!mark) return neutral;
  if (isSimpleIconsCdn(src) || invert) {
    return pickMarkTileBg(name, brandKey, neutral);
  }
  return neutral;
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
