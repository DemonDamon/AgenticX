# @agenticx/ui 模块总结

> 结论生成时间：2026-07-21（基于源码核验重写）

## 模块概述

`@agenticx/ui` 是 Enterprise 前台/后台共用的**设计系统包**（React 19 + Radix + Tailwind v4 + CVA + tailwind-merge + Recharts + sonner + lucide + cmdk）。**无构建产物**——`package.json` 的 `main`/`types` 都指向 `./src/index.ts`，`build` 脚本仅为 `tsc --noEmit`（只类型检查、不 emit），消费方通过 Next.js `transpilePackages` 在源码层面消费。它是 Enterprise UI 设计 token 的**单一来源**（`src/themes/base.css`）。

## 目录结构

```
packages/ui/
├── package.json                # main → ./src/index.ts（source-only 消费，build = tsc --noEmit）
├── tsconfig.json
└── src/
    ├── index.ts                # 单 barrel：cn + 24 原语 + 布局 + 数据 + 图表 + 品牌 + 主题
    ├── lib/cn.ts               # tailwind-merge + clsx 的 cn()
    ├── components/
    │   ├── ui/                 # 24 个 shadcn 风格原语：button, card, input, textarea,
    │   │                       #   scroll-area, tooltip, select, separator, avatar,
    │   │                       #   dropdown-menu, tabs, label, dialog, badge, table,
    │   │                       #   alert, sheet, skeleton, popover, checkbox, switch,
    │   │                       #   progress, command, sonner
    │   ├── layout/             # GridBackdrop, PageHeader, Breadcrumb, EmptyState, StatCard
    │   ├── data/               # DataTable（@tanstack/react-table 包装）
    │   └── charts/             # ChartCard + theme.ts（chartPalette + chartColors）
    ├── branding/               # MachiAvatar.tsx, locale.tsx, useUiTheme.ts, locale-constants.ts
    └── themes/
        ├── base.css            # 唯一 token 源：OKLCH · indigo/violet · Tailwind v4 @theme inline
        └── runtime-brand.ts    # buildBrandThemeVars()：HSL 品牌色覆盖（primary/secondary/accent）
```

## 关键导出

- **工具**：`cn`（tailwind-merge + clsx）
- **shadcn 原语**（24 个）：button / card / input / textarea / scroll-area / tooltip / select / separator / avatar / dropdown-menu / tabs / label / dialog / badge / table / alert / sheet / skeleton / popover / checkbox / switch / progress / command / sonner
- **布局**：`GridBackdrop, PageHeader, Breadcrumb, EmptyState, StatCard`
- **数据**：`DataTable`（基于 `@tanstack/react-table`）
- **图表**：`ChartCard, chartPalette, chartColors`
- **品牌 / 主题**：`MachiAvatar`、locale provider、`useUiTheme`、`buildBrandThemeVars`

## 显著模式

- **Source-only 消费**：`main` 指 `./src/index.ts`，不打包；消费 app 走 Next.js `transpilePackages`，无独立产物
- **OKLCH + indigo/violet token 单一来源**：`base.css` 用 `@theme inline` 把 CSS vars 暴露为 Tailwind v4 utility（`bg-background` / `text-foreground` / `border-border`…），`@custom-variant dark` 让 `dark:` 在 `<html class="dark">` 命中；保留 `--machi-*` alias 做向后兼容
- **三态主题**：`useUiTheme` 支持 `system / dark / light`，持久化到 localStorage `agenticx-ui-theme`，暴露 `resolved` 与 `toggle()`，`system` 模式订阅 `matchMedia` 变化
- **CVA + tailwind-merge** 实现 variant 组合；Radix 作 headless 层
- **运行时品牌覆盖**：`buildBrandThemeVars` 把 `BrandConfig` 的 `primary/secondary/accent_color` 转成 `--ui-color-*` CSS vars（HSL，带 fallback），与 `@agenticx/branding`（空 stub）互补——真实 branding 组件都在本包

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/admin-console`、`apps/web-portal`、所有 `features/*`、`customers/*` | 直接 import | 全平台统一 UI 原语与 token |
| `packages/branding` | 互补 | branding 是空 stub；本包包含真实 branding 组件 |
| `packages/config` | 间接 | `BrandConfigSchema` 喂给 `buildBrandThemeVars` 做运行时品牌覆盖 |
