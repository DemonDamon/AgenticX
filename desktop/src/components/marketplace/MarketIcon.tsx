/**
 * 市场卡片图标:优先真实图片(上游 logo_url / 推荐位 icon_src),
 * 无图或加载失败回退到按名称确定性选取的渐变底座 + 行业图标。
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
import { pickBrandIcon, pickGradientFor, pickMarketIconGlyph, type MarketIconGlyph } from "./icon-model";
import { BRAND_ICON_SRC } from "./brand-assets";

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
  // 图标优先级:推荐位图标 → 品牌图标(本地打包优先,国际品牌走 Simple Icons CDN) → 上游 logo → 渐变底座。
  const brand = pickBrandIcon(name);
  const brandSrc = brand ? (BRAND_ICON_SRC[brand.brand] ?? `https://cdn.simpleicons.org/${brand.brand}`) : undefined;
  const img = iconSrc || brandSrc || logoUrl;
  if (img && !broken) {
    return (
      <img
        src={img}
        alt=""
        className={`${className} shrink-0 rounded-xl bg-white object-cover ring-1 ring-black/[0.06]`}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  const Glyph = GLYPH_ICONS[pickMarketIconGlyph(name)] ?? Sparkles;
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${pickGradientFor(
        name,
      )} text-white shadow-sm ring-1 ring-white/15`}
      data-market-icon-gradient={pickGradientFor(name)}
    >
      <Glyph className="h-[55%] w-[55%] text-white/95" aria-hidden />
    </span>
  );
}
