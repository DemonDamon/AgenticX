/**
 * 插件市场静态配置:精选卡(Featured)定义。
 * 点击精选卡 = 切到目标 Tab 并预选筛选 chip。
 * 图标为手绘双色 SVG(assets/marketplace/featured-*.svg),淡色底座替代重渐变。
 */

import officeIcon from "../assets/marketplace/featured-office.svg";
import connectorsIcon from "../assets/marketplace/featured-connectors.svg";
import toolkitIcon from "../assets/marketplace/featured-toolkit.svg";
import type { MarketTab } from "../components/marketplace/model";

/** 精选卡跳转目标:Tab + 预选筛选 chip(无 chips 的 Tab 传 "all" 占位)。 */
export type FeaturedTarget = {
  tab: MarketTab;
  tag: string;
};

export type FeaturedCardDef = {
  id: "office" | "connectors" | "toolkit";
  /** 手绘图标(bundled SVG URL)。 */
  iconSrc: string;
  /** 图标淡色底座(tailwind 类)。 */
  tint: string;
  target: FeaturedTarget;
};

export const FEATURED_CARDS: FeaturedCardDef[] = [
  {
    id: "office",
    iconSrc: officeIcon,
    tint: "bg-blue-50 ring-1 ring-blue-100",
    target: { tab: "skills", tag: "recommended" },
  },
  {
    id: "connectors",
    iconSrc: connectorsIcon,
    tint: "bg-violet-50 ring-1 ring-violet-100",
    target: { tab: "mcp", tag: "all" },
  },
  {
    id: "toolkit",
    iconSrc: toolkitIcon,
    tint: "bg-emerald-50 ring-1 ring-emerald-100",
    target: { tab: "skills", tag: "installable" },
  },
];
