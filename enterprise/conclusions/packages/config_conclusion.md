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
    ├── index.ts             # 主入口：能力/配额/推理契约 + schemas
    ├── schemas.ts           # Zod schemas + 类型 + 默认值
    ├── loaders.ts           # loadBrand / loadFeatures / ConfigLoaderError
    ├── react.tsx            # ConfigProvider / useBrand / useFeatures（**当前无人消费**）
    ├── capability-id.ts     # mcp/skill/feature 能力 id 构造与解析
    ├── capability-state.ts / opt-out-subject.ts / desktop-capability-policy.ts
    ├── desktop-agent-action-policy.ts   # 员工 Desktop 工具执行策略 normalize
    ├── feature-usage-limits.ts        # 联网搜索 / 深度研究用量上限解析
    ├── member-spending-limit.ts       # 成员个人层 token/费用配额规则
    ├── model-reasoning.ts             # 推理族 env 列表与 modelFamily 匹配
    └── __tests__/            # vitest（loaders、capability-id、desktop-agent-action-policy、feature-usage-limits、member-spending-limit、model-reasoning 等）
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


## 增量（8ebec3b5 → 30e57496）

`src/index.ts` 现额外导出能力开关契约（不再「仅 re-export schemas」）：

- `capability-id.ts`：稳定 capability id 解析/规范化。
- `capability-state.ts`：能力开关状态机。
- `opt-out-subject.ts`：用户/主体 opt-out 主语。
- `desktop-capability-policy.ts`：桌面端能力策略（与 Near `enterprise-capabilities` 对齐）。

配套 vitest：`capability-id*.test.ts`、`capability-state.test.ts`、`opt-out-subject.test.ts`、`desktop-capability-policy.test.ts`。Brand YAML loader 行为未改。

## 增量（30e57496 → 22d051f5）

`src/index.ts` 在既有能力契约之上再导出四类**纯函数契约**（仍不经过 YAML loader；Brand/feature YAML 路径未改）：

### capability-id.ts（扩展）

- `mcp:` / `skill:` 的 `rowId` 除 Crockford ULID（26 字符）外，另接受连接器网关早期写入的 **RFC 4648 标准 Base32** 26 字符主键（`LEGACY_STD_BASE32_ROW_ID_RE`）；`formatCapabilityId` / `parseCapabilityId` 经 `isCapabilityRowId` 统一校验，小写输入仍 `normalizeRowId` 抬大写。

### desktop-agent-action-policy.ts

- 类型 `DesktopAgentActionPolicy`：`deniedTools`、`alwaysAskTools`（fnmatch 语义匹配工具名 / `mcp:<tool>` / `git:push`，大小写不敏感）、`disableSessionAllow`。
- 默认 `DEFAULT_DESKTOP_AGENT_ACTION_POLICY`：两列表均为 `[]`，`disableSessionAllow: false`。
- `normalizeDesktopAgentActionPolicy(raw)`：非 object 回退默认；每条 pattern 须匹配 `^[A-Za-z0-9_:*./-]{1,128}$`，trim 去重，每列表最多 **100** 条；`disableSessionAllow` 仅 **`=== true`** 生效。

### feature-usage-limits.ts

- 计量特征 `MeteredFeature`：`search_provider_calls`（出站搜索调用）、`deep_research_runs`（深度研究运行次数）；窗口 `day` / `week` / `month`。
- 配置形态 `FeatureUsageConfig`（运行时经 `normalizeFeatureUsageConfig` 收口，设计落点 **`quota.featureUsage`**，与 token 配额分离）：`defaults.role`、`company`、`departments`、`groups`、`users`；规则字段 `searchCallsPerDay|Week|Month`、`deepResearchRunsPerDay|Week|Month`——**正整数才保留，0 或未设表示该层「无上限」**（`NO_FEATURE_USAGE_LIMITS`）。
- 个人层 `resolveFeatureUsageLimits` 优先级：**用户特例 → 用户组（同窗口取最严）→ 角色（`FEATURE_USAGE_ROLE_PRECEDENCE` 从高到低，多角色取最高特权且有规则者）→ `FEATURE_USAGE_FALLBACK_ROLE`（`staff`）**；不按层合并不同窗口。
- `resolveFeatureUsagePolicies` 另算 **部门 / 公司共享池**，与个人层独立；`featureUsageDayRange` / `utcUsageDay` 按 **UTC ISO 周** 汇总日计数；`featureUsageState` / `combineFeatureUsageStates` 取剩余额度最小的 binding 窗口。

### member-spending-limit.ts

- `MemberSpendingRule`：`unit` `tokens` | `cost_usd`，`period` `day|week|month`，`limit`，`action` `block|warn|fallback`（可选 `warnThresholdPct`、`fallbackModel`）。
- `MemberSpendingConfig` 含 `defaults` / `users` / `groups` / `departments` / `tenants` / `companyLimits`；`userGroups` **仅读取时注入，不写预算 JSON**。
- `memberSpendingRules(config, { userId, groupIds? })` 只解 **个人层**：用户特例（`limit > 0`）→ 所属组同 `unit:period` **最严 limit**（动作强制 `block`）→ `defaults`；无有效规则则 `{ source: "none", rules: [] }`。

### model-reasoning.ts

- 部署可覆盖 env（逗号/分号/空白分隔）：`AGENTICX_THINK_PREFILL_MODELS`、`AGENTICX_THINKING_TOGGLE_MODELS`；未配置时内置族 **`qwen3.8`**（vLLM 模板预填 thinking 块）、**`glm5.2`**（请求级 `enable_thinking`）。
- `modelFamilySlug` 取模型 id 路径末段；`modelPrefillsThinkTag` / `modelTakesThinkingToggle` 对族名做分隔符容错匹配（避免 `qwen3.8` 误匹配 `qwen3.81`）；`process` 缺失时（客户端 bundle）读 env 为空对象。

配套 vitest：`capability-id.test.ts`（legacy base32）、`desktop-agent-action-policy.test.ts`、`feature-usage-limits.test.ts`、`member-spending-limit.test.ts`、`model-reasoning.test.ts`。
