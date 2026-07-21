# @agenticx/feature-settings 模块总结

> 结论重新生成时间：2026-07-21
> 判定口径：以 `enterprise/features/settings` 源盘为准，并交叉核对 enterprise 内真实落点（已逐路径核对存在性与行数）。

## 一句话判定

**本 feature 包是纯占位 stub**（仅一行常量导出）；但「设置面板」的**真实能力已在 `apps/web-portal` 自实现**——`components/settings/SettingsPanel.tsx`（605 行 / 23616 字节），含 `model-service / defaults / web-search / parser / chat / general` 六个 tab。本包未来若落地，预期是把该面板下沉为可复用包。

## 模块概述

`@agenticx/feature-settings` 预留给「设置面板」能力：model-service / web-search / parser / chat / general 等 tab 配置。当前**包本身未实现**，仅作为 workspace 占位；实际设置面板已在 web-portal 内自实现。

## 目录结构（已逐文件核对）

```
features/settings/
├── README.md            # 9 行，仅写包名 + 一句 import 示例
├── package.json         # @agenticx/feature-settings v0.1.0，private，lint 为 placeholder
├── src/index.ts         # 4 行：featureName 常量 + // TODO: implement
├── tsconfig.json
└── tsconfig.tsbuildinfo
```

无 `lib/`、无 `components/`、无 `api/`、无测试目录。

## 关键导出

仅：
```ts
export const featureName = "settings" as const;
```

`package.json` 的 `lint` script 为 `echo 'lint placeholder'`。无运行时产物。

## 状态（诚实判定）

**本包尚未实现 / 纯 stub。** 源代码只有一行常量声明 + `// TODO: implement` 注释。

**但实际设置面板已在 web-portal 自实现**（下节核对）。

## 真实代码落点（能力实际在哪）

| 子能力 | 真实落点（enterprise） | 行数/形态 | 说明 |
|---|---|---|---|
| 设置面板主体 | `apps/web-portal/src/components/settings/SettingsPanel.tsx` | **605 行 / 23616 字节** | 实质承担本包职责，分 tab 设置面板 |
| Tab 集合 | 同上，`TabId` 类型 | 6 个 tab | `model-service / defaults / web-search / parser / chat / general` |

### Tab 清单（已核对源码）

```
type TabId = "model-service" | "defaults" | "web-search" | "parser" | "chat" | "general";
```

- `model-service`：模型服务（Provider 列表含 deepseek/moonshot/openai/anthropic 等）
- `defaults`：默认设置
- `web-search`：联网搜索开关
- `parser`：文档解析器（默认 parser、支持格式）
- `chat`：聊天（流式开关等）
- `general`：通用设置（含 PAT 管理等）

> 注意：**没有 `knowledge-base`、`tools-mcp`、`agents` tab**——这三个 feature 包的能力均未在 SettingsPanel 暴露。

### admin-console 侧

- `apps/admin-console/src/app/admin/` 下**无 settings 页**（子目录：api-tokens / cache / channels / compliance / errors / mcp-servers / models / perf / plugins / session-grants）。
- 即 admin 端无统一设置面板，各能力分散在对应 admin 子页（如 models、mcp-servers）。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/web-portal` | **当前已自实现** | `components/settings/SettingsPanel.tsx`（605 行）实质承担本包职责 |
| `apps/admin-console` | 未实现统一面板 | 各能力分散在 models / mcp-servers 等子页 |

## 未来收敛方向

本包未来可能把 web-portal 的 `SettingsPanel.tsx` 下沉为可复用组件包，再让 portal 通过 `import { SettingsPanel } from "@agenticx/feature-settings"` 消费；同时可能为 admin-console 抽出统一设置 SDK。

## 完成度判定

| 维度 | 状态 |
|---|---|
| 包骨架（package.json / tsconfig / index.ts） | ✅ 存在 |
| 本包业务逻辑 / 组件 / API | ❌ 无（纯 stub） |
| 设置面板 UI | ✅ 在 web-portal（SettingsPanel.tsx 605 行，6 tab） |
| admin-console 统一设置面板 | ❌ 无 |
| **整体** | **本包纯 stub，能力在 web-portal 自实现** |
