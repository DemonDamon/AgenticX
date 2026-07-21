# @agenticx/config 模块总结

> 结论生成时间：2026-07-21（基于源码核验重写）

## 模块概述

`@agenticx/config` 是**真实可用**的配置加载器（`package.json` description："配置加载器（品牌 · feature flag · 插件）"），非 stub。提供 Zod 校验的 brand / feature schemas、YAML→Zod 加载器、以及一个 React 子路径导出（`ConfigProvider`/`useBrand`/`useFeatures`）。web-portal 已在 `WorkspaceClient.tsx` 真实 import `DEFAULT_BRAND_CONFIG`/`DEFAULT_FEATURE_FLAGS`。

## 目录结构

```
packages/config/
├── package.json             # @agenticx/config，exports map: . / ./schemas / ./loaders / ./react
├── README.md
├── tsconfig.json
└── src/
    ├── index.ts             # 仅 re-export schemas
    ├── schemas.ts           # Zod schemas + 类型 + 默认值
    ├── loaders.ts           # loadBrand / loadFeatures / ConfigLoaderError
    ├── react.tsx            # ConfigProvider / useBrand / useFeatures（**当前无人消费**）
    └── __tests__/loaders.test.ts   # vitest：loadBrand/loadFeatures 各错误码 + 默认合并
```

## 关键导出

### schemas.ts
- **Schemas**：`BrandCoreSchema`、`CopyrightSchema`、`LegalSchema`、`ComplianceSchema`、`BrandConfigSchema`、`BrandYamlSchema`、`FeatureFlagsSchema`、`FeatureYamlSchema`
- **类型**：`BrandConfig`、`FeatureFlags`
- **默认值**：`DEFAULT_BRAND_CONFIG`（name "AgenticX Enterprise"、year 2026、primary_color `262 83% 58%` 等）、`DEFAULT_FEATURE_FLAGS`（含 `chat` / `chat.web_search` / `chat.multi_round` / `gateway.policy_engine`）

### loaders.ts
- `ConfigLoaderError`（codes：`MISSING_PATH` / `FILE_NOT_FOUND` / `YAML_PARSE_ERROR` / `SCHEMA_INVALID`）
- `loadBrand(yamlPath?)`：env 回退 `NEXT_PUBLIC_BRAND_CONFIG`，用 `BrandYamlSchema`（全 partial）解析后与 `DEFAULT_BRAND_CONFIG` 逐段合并，再过 `BrandConfigSchema.parse` 收口
- `loadFeatures(yamlPath?)`：env 回退 `NEXT_PUBLIC_FEATURES_CONFIG`，与 `DEFAULT_FEATURE_FLAGS` 浅合并
- 主题 manifest 路径硬编码 `plugins/theme-default/manifest.yaml`，`assertThemePackExists` 仅 best-effort 探测，**缺失不报错**（继续用内置默认）

### react.tsx
- `ConfigProvider`、`useBrand`、`useFeatures`——已实现但**当前无任何 app 实际 import**（死导出）

## 显著模式

- **子路径 exports map**：`.` / `./schemas` / `./loaders` / `./react` 四入口
- **env-var 路径回退**：`resolvePath` 优先显式参数，否则读 `NEXT_PUBLIC_*` env
- **部分 YAML 容忍**：`BrandYamlSchema` 全字段 `partial().optional()`，接受不完整 YAML，按默认值补齐
- **默认 feature flags 串 policy-engine**：`gateway.policy_engine: true` 把 config 与 policy-engine 默认接通
- **依赖**：`zod`（校验）、`yaml`（解析）、`react`（react 子路径）；测试 `vitest`
- **真实消费仅默认常量**：apps 实际只 import `DEFAULT_BRAND_CONFIG`/`DEFAULT_FEATURE_FLAGS`，`loadBrand`/`loadFeatures`/`ConfigProvider` 在 app 源码中**未被调用**

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/web-portal` | 直接消费 | `WorkspaceClient.tsx` import `DEFAULT_BRAND_CONFIG`/`DEFAULT_FEATURE_FLAGS`；`next.config.ts` transpilePackages 含本包 |
| `apps/admin-console` | 依赖但未用 | `package.json` 有 dep + `next.config.ts` transpilePackages，但源码无实际 import |
| `packages/ui` | 类型消费（计划） | `BrandConfigSchema` 喂给 UI 运行时 brand 覆盖 |
| `packages/branding` | 互补 | branding 仅版本标签；本包的 schemas 是事实 brand 定义源 |
| `plugins/theme-default` | 默认 manifest | 本包 loader 直接寻址该 manifest（best-effort） |
