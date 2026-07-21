# @agenticx/feature-model-service 模块总结

> 结论重新生成时间：2026-07-21
> 判定口径：以 `enterprise/features/model-service` 源盘为准，并交叉核对 enterprise 内真实落点（已逐路径核对存在性与行数）。

## 一句话判定

**本 feature 包是纯占位 stub**（仅一行常量导出）；但「模型服务管理（Provider/Model/Key）」的**真实能力已分散实现于 enterprise 多处**——iam-core（密钥信封加密）、db-schema（`enterprise_runtime_model_providers` 表）、admin-console（1165 行模型管理页 + providers API）、web-portal（按可见性过滤的 reader）。本包未来若落地，预期是把这些散落能力收敛为统一 SDK。

## 模块概述

`@agenticx/feature-model-service` 预留给「模型服务管理（Provider / Model / Key）」能力。当前**包本身未实现**，仅作为 workspace 占位；实际功能已在 enterprise 其他包内自实现。

## 目录结构（已逐文件核对）

```
features/model-service/
├── README.md            # 9 行，仅写包名 + 一句 import 示例
├── package.json         # @agenticx/feature-model-service v0.1.0，private，lint 为 placeholder
├── src/index.ts         # 4 行：featureName 常量 + // TODO: implement
├── tsconfig.json
└── tsconfig.tsbuildinfo
```

无 `lib/`、无 `components/`、无 `api/`、无测试目录。

## 关键导出

仅：
```ts
export const featureName = "model-service" as const;
```

`package.json` 的 `lint` script 为 `echo 'lint placeholder'`。无运行时产物。

## 状态（诚实判定）

**本包尚未实现 / 纯 stub。** 源代码只有一行常量声明 + `// TODO: implement` 注释。

**但实际功能已分散在 enterprise 多处真实实现**（下节逐项核对）。

## 真实代码落点（能力实际在哪）

| 子能力 | 真实落点（enterprise） | 行数/形态 | 说明 |
|---|---|---|---|
| 密钥信封加密 | `packages/iam-core/src/provider-api-key-crypto.ts` | 49 行 | Provider API Key 信封加密 |
| 加密副本（重复） | `apps/web-portal/src/lib/provider-api-key-crypto.ts`、`apps/admin-console/src/lib/provider-api-key-crypto.ts` | — | 两端各有一份同名实现 |
| DB schema | `packages/db-schema/src/schema/runtime-config.ts` | 166 行 | 含 `enterprise_runtime_model_providers` 表定义 |
| 管理 UI | `apps/admin-console/src/app/admin/models/page.tsx` | **1165 行** | 实质承担模型服务管理页（Provider/Model/Key 编辑） |
| 管理 API | `apps/admin-console/src/app/api/admin/providers/route.ts` + `[id]/route.ts` | 131 行 | providers CRUD（注意：无 `api/admin/models/` 路由） |
| DB store | `apps/admin-console/src/lib/db-stores/postgresql/model-providers-store.ts` + `mysql/model-providers-store.ts` | — | PG / MySQL 双实现 |
| 读取 SDK | `apps/web-portal/src/lib/admin-providers-reader.ts` | — | portal 端按用户可见性过滤模型 |
| 可见模型计算 | `apps/web-portal/src/lib/effective-models.ts` | — | portal 侧 effective 模型计算 |

> 关键修正：旧结论写的是 `packages/db-schema/schema/runtime-config.ts`，实际路径是 `packages/db-schema/src/schema/runtime-config.ts`（多一层 `src/`）。表名 `enterprise_runtime_model_providers` 确实存在于该 schema 文件。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/admin-console` | **当前已自实现** | 模型服务管理 UI（1165 行）+ providers API 直接在 admin-console 本身 |
| `apps/web-portal` | **已声明依赖** | SettingsPanel 有 `model-service` tab；reader 在 portal lib |
| `packages/iam-core` | **现有数据能力** | provider API key 加密（49 行） |
| `packages/db-schema` | **schema** | `enterprise_runtime_model_providers` 表（`src/schema/runtime-config.ts`） |

## 未来收敛方向

本包未来可能把散落在 admin-console / web-portal / iam-core 的 Provider/Model/Key 管理能力下沉为**统一 SDK**，供 admin-console 与 portal 共用，避免当前「crypto 三份副本、UI 直接写在 app 里」的散落状态。

## 完成度判定

| 维度 | 状态 |
|---|---|
| 包骨架（package.json / tsconfig / index.ts） | ✅ 存在 |
| 本包业务逻辑 / 组件 / API | ❌ 无（纯 stub） |
| 密钥加密能力 | ✅ 在 iam-core（49 行）+ 两端副本 |
| DB schema | ✅ 在 db-schema（`enterprise_runtime_model_providers`） |
| 管理 UI | ✅ 在 admin-console（models/page.tsx 1165 行） |
| 管理 API | ✅ 在 admin-console（providers route，131 行） |
| portal 读取 | ✅ admin-providers-reader + effective-models |
| **整体** | **本包纯 stub，但 enterprise 侧能力已实质落地（散落多包）** |
