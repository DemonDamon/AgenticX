# @agenticx/feature-knowledge-base 模块总结

> 结论重新生成时间：2026-07-21
> 判定口径：以 `enterprise/features/knowledge-base` 源盘为准，并交叉核对 enterprise 内及主仓的真实落点。

## 一句话判定

**纯占位 stub。** 本 feature 包仅有一行常量导出；`apps/web-portal` 虽在 `package.json` 声明了 `workspace:*` 依赖，但 SettingsPanel 实际**未挂载 KB tab**，未真正消费；该能力的真实实现全部在**主仓 AgenticX**（`agenticx/knowledge`、`agenticx/brain`、`agenticx/code_index`、`agenticx/retrieval`），enterprise 未做 KB 管理面。

## 模块概述

`@agenticx/feature-knowledge-base` 预留给「知识库」能力：KB 管理、文档上传、RAG 检索配置、与 chat workspace 集成等。当前**未实现**，仅作为 workspace 包占位。

## 目录结构（已逐文件核对）

```
features/knowledge-base/
├── README.md            # 9 行，仅写包名 + 一句 import 示例
├── package.json         # @agenticx/feature-knowledge-base v0.1.0，private，lint 为 placeholder
├── src/index.ts         # 4 行：featureName 常量 + // TODO: implement
├── tsconfig.json
└── tsconfig.tsbuildinfo
```

无 `lib/`、无 `components/`、无 `api/`、无测试目录。

## 关键导出

仅：
```ts
export const featureName = "knowledge-base" as const;
```

`package.json` 的 `lint` script 为 `echo 'lint placeholder'`。无运行时产物。

## 状态（诚实判定）

**尚未实现 / 纯 stub。** 源代码只有一行常量声明 + `// TODO: implement` 注释。

### enterprise 侧消费者核查

- `apps/web-portal/package.json` 第 23 行声明 `"@agenticx/feature-knowledge-base": "workspace:*"` —— **依赖已声明**。
- 但 `apps/web-portal/src/components/settings/SettingsPanel.tsx` 的 `TabId` 实际只有：`model-service | defaults | web-search | parser | chat | general` —— **没有 `knowledge-base` tab**。
- `apps/web-portal/src/components/settings/` 目录下仅 `SettingsPanel.tsx` 一个文件，无 KB 相关组件。
- 全仓 `rg feature-knowledge-base` 在 `enterprise/apps` 下仅命中 `package.json` 与 `next.config.ts`，**无业务代码 import**。
- 即：依赖已声明但**未真正接线**，portal 当前不可见 KB 入口。

## 真实代码落点（能力实际在哪）

本 feature 描述的能力**不在 enterprise**，而在主仓 `agenticx/`（Python 栈）：

| 能力 | 真实落点（主仓） | 说明 |
|---|---|---|
| 知识管理 | `agenticx/knowledge/` | 文档处理、分块、图谱构建、搜索编排 |
| 多脑知识库 | `agenticx/brain/` | 文档脑 + 代码脑 |
| 代码语义索引 | `agenticx/code_index/` | 代码语义索引 |
| 检索增强 RAG | `agenticx/retrieval/` | 检索增强生成 |

> 注：以上为主仓 Python 实现。Desktop 端已有本地知识库 Stage-1（`agenticx/studio/kb/` + `/api/kb/*` + Desktop 设置 `knowledge/`），但那是 Desktop 产品线，**不属于 enterprise 本 feature 包**。本 feature 包未来若落地，预期是上述能力的企业级 UI 封装（admin-console / web-portal 配置 KB 与上传文档）。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/web-portal` | 已声明依赖但未真正用 | `package.json` 有 `workspace:*`，SettingsPanel 未挂 KB tab |
| `apps/admin-console` | 未来消费者 | KB 管理页（当前不存在） |
| 主仓 `agenticx/knowledge` 等 | 概念映射 | 真实能力源头（Python 栈，非 enterprise） |

## 完成度判定

| 维度 | 状态 |
|---|---|
| 包骨架（package.json / tsconfig / index.ts） | ✅ 存在 |
| 业务逻辑 / 类型 / 组件 / API | ❌ 无 |
| web-portal 依赖声明 | ✅ 已声明 |
| web-portal 实际消费（KB tab） | ❌ 未挂载 |
| admin-console KB 管理页 | ❌ 无 |
| 真实能力实现 | ⚠️ 在主仓，非本 feature 包 |
| **整体** | **纯 stub，依赖未接线，能力在主仓** |
