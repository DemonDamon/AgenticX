# @agenticx/branding 模块总结

> 结论生成时间：2026-07-21（基于源码核验重写）

## 模块概述

`@agenticx/branding` **不再是纯空 stub**——早期只导出 `packageName` 常量，现已新增 `getEnterpriseVersionLabel()`（读 `NEXT_PUBLIC_ENTERPRISE_VERSION` 返回 `vX.Y.Z` 标签），并被 web-portal 与 admin-console **真实消费**于 shell chrome 的版本号显示。但"白标组件（logo/色系/文案动态注入）"的**主体实现仍在 `@agenticx/ui/src/branding/*`**，本包仅承载版本标签这一小职能 + 保留命名空间。

## 目录结构

```
packages/branding/
├── package.json             # @agenticx/branding，private，main/types → ./src/index.ts
├── README.md                # 一行说明
├── tsconfig.json
└── src/
    ├── index.ts            # packageName 常量 + re-export getEnterpriseVersionLabel
    └── version.ts          # getEnterpriseVersionLabel()
```

## 关键导出

- `packageName = "branding"`（const）
- `getEnterpriseVersionLabel(): string`（`version.ts`）

## 显著模式

- **版本标签逻辑**：读 `process.env.NEXT_PUBLIC_ENTERPRISE_VERSION`，空则返回 `"v0.0.0"`；非空且不以 `v` 开头则补 `v` 前缀；用于 shell chrome（如 `品牌副标题 · v0.2.1`）
- **白标主体已迁出**：`MachiAvatar` / `useUiTheme` / `locale` / `locale-constants` 都在 `@agenticx/ui/src/branding/`，本包不持有这些
- **配置 schema 在 `@agenticx/config`**（`BrandConfigSchema` / `BrandYamlSchema`），本包也不持有 schema
- `package.json` 无 `dependencies`、无 `test` 脚本（仅 `lint`/`typecheck` placeholder）

## 状态

**部分实现** —— 仅 `getEnterpriseVersionLabel` 一函数真实落地并被两端 app 消费；白标视觉/色系/文案注入仍由 `@agenticx/ui` 承载，本包保留为命名空间，便于未来按域重组（届时可把 brand 相关代码从 ui 拆回）。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/web-portal` | 直接消费 | `WorkspaceShell.tsx` import `getEnterpriseVersionLabel`，渲染于品牌副标题后 |
| `apps/admin-console` | 直接消费 | `AppShell.tsx` import `getEnterpriseVersionLabel`，渲染于 adminLabel 后 |
| `packages/ui` | 承载真实实现 | UI 包 `src/branding/` 子目录（`MachiAvatar`/`useUiTheme`/`locale`）是当前实际 brand 组件 |
| `packages/config` | 配套 schema | 提供 `BrandConfigSchema` / `BrandYamlSchema`，本包不重复定义 |
| 所有 apps | 间接 | 不直接 import 本包的白标视觉件，统一走 `@agenticx/ui` |
