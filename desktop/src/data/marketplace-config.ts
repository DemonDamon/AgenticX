/**
 * 插件市场静态配置:精选卡(Featured)定义。
 * 点击精选卡 = 切到目标 Tab 并预选筛选 chip,视觉用 lucide 图标 + 渐变底座。
 */

import { FileText, Plug, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** 精选卡跳转目标:Tab + 预选筛选 chip。 */
export type FeaturedTarget = {
  tab: "plugins" | "skills";
  tag: string;
};

export type FeaturedCardDef = {
  id: "office" | "connectors" | "toolkit";
  icon: LucideIcon;
  /** 图标底座渐变(tailwind from-* to-*)。 */
  gradient: string;
  target: FeaturedTarget;
};

export const FEATURED_CARDS: FeaturedCardDef[] = [
  {
    id: "office",
    icon: FileText,
    gradient: "from-sky-500 to-blue-600",
    target: { tab: "skills", tag: "recommended" },
  },
  {
    id: "connectors",
    icon: Plug,
    gradient: "from-violet-500 to-purple-600",
    target: { tab: "plugins", tag: "mcp" },
  },
  {
    id: "toolkit",
    icon: Wrench,
    gradient: "from-emerald-500 to-teal-600",
    target: { tab: "plugins", tag: "tool" },
  },
];
