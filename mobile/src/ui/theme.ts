/**
 * Near Mobile 设计 tokens —— 与桌面端品牌系统对齐。
 *
 * 品牌资产：
 * - Mark：橙色 3D 圆角立方体（两个白色椭圆孔），见 assets/brand/near-box.png
 * - 主橙 #FB7703（亮面 #FE9115 / 暗面 #F46D01），奶油底 #FFF7F0
 * - 标语：Near, Always Near.
 *
 * 设计语言：暖白分层、克制阴影、单一品牌橙强调色；不使用彩色图标。
 */

export const brand = {
  /** 主品牌橙 */
  primary: "#FB7703",
  primaryLight: "#FE9115",
  primaryDark: "#F46D01",
  /** 按下态加深 */
  primaryPressed: "#D95F00",
  /** 品牌奶油底 */
  cream: "#FFF7F0",
  creamDeep: "#FDEFE2",
} as const;

export const color = {
  // 背景层级（暖白）
  bg: "#FAF8F5",
  bgElevated: "#FFFFFF",
  card: "#FFFFFF",
  // 文字
  textPrimary: "#2B2620",
  textSecondary: "#8A8278",
  textMuted: "#B4ADA3",
  textOnPrimary: "#FFFFFF",
  // 边框 / 分隔（whisper border）
  border: "#EFE9E1",
  borderStrong: "#E3DBD0",
  // 语义
  online: "#2E9E5B",
  offline: "#B4ADA3",
  danger: "#D64545",
  dangerBg: "#FCEBEA",
  warning: "#B06000",
  warningBg: "#FEF7E0",
  // 会话气泡
  bubbleUser: brand.primary,
  bubbleAssistant: "#FFFFFF",
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const fontSize = {
  caption: 12,
  body: 14,
  bodyLg: 15,
  title: 17,
  h2: 22,
  h1: 28,
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

/** 极轻单层阴影（暖色调） */
export const shadow = {
  card: {
    shadowColor: "#3D2B14",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  floating: {
    shadowColor: "#3D2B14",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

export const theme = {
  brand,
  color,
  radius,
  spacing,
  fontSize,
  fontWeight,
  shadow,
} as const;

export type Theme = typeof theme;
