# @agenticx/feature-agents 模块总结

> 结论重新生成时间：2026-07-21
> 判定口径：以 `enterprise/features/agents` 源盘为准，并交叉核对 enterprise 内及主仓的真实落点。

## 一句话判定

**纯占位 stub。** 本 feature 包仅有一行常量导出，enterprise 侧尚无任何 agent / 分身管理 UI 或 API；该能力的真实实现全部在**主仓 AgenticX**（`agenticx/avatar`、`agenticx/agents`、`agenticx/collaboration`），enterprise 未做管理面封装。

## 模块概述

`@agenticx/feature-agents` 预留给「智能体 · 分身」能力：agent 注册表、群聊、分身会话与默认模型绑定等管理面功能。当前**未实现**，仅作为 workspace 包占位，便于未来把主仓的 avatar/agents 能力以 admin-console 可编辑的形态收敛进 enterprise。

## 目录结构（已逐文件核对）

```
features/agents/
├── README.md            # 9 行，仅写包名 + 一句 import 示例
├── package.json         # @agenticx/feature-agents v0.1.0，private，lint 为 placeholder
├── src/index.ts         # 4 行：featureName 常量 + // TODO: implement
├── tsconfig.json
└── tsconfig.tsbuildinfo
```

无 `lib/`、无 `components/`、无 `api/`、无测试目录。

## 关键导出

仅：
```ts
export const featureName = "agents" as const;
```

`package.json` 的 `lint` script 为 `echo 'lint placeholder'`，`typecheck` 仅跑 `tsc --noEmit`。无运行时产物。

## 状态（诚实判定）

**尚未实现 / 纯 stub。** 源代码只有一行常量声明 + `// TODO: implement` 注释，无任何业务逻辑、类型、组件或 API。

### enterprise 侧消费者核查

- `apps/admin-console/src/app/admin/` 当前子目录：`api-tokens / cache / channels / compliance / errors / mcp-servers / models / perf / plugins / session-grants` —— **没有 `agents` 页**。
- 全仓 `rg feature-agents` 在 `enterprise/apps` 下仅命中 `next.config.ts` 的 transpile/workspace 配置，**无任何业务代码 import**。
- 即：本包目前没有任何 enterprise 端真实消费者。

## 真实代码落点（能力实际在哪）

本 feature 描述的能力**不在 enterprise**，而在主仓 `agenticx/`（Python 栈）：

| 能力 | 真实落点（主仓） | 说明 |
|---|---|---|
| 分身体系 | `agenticx/avatar/` | 注册表、群聊、分身会话与默认模型绑定 |
| 专用智能体实现 | `agenticx/agents/` | agent 运行实现 |
| 多智能体协作 | `agenticx/collaboration/` | 多智能体协作编排 |

> 注：以上为主仓 Python 实现，enterprise（TypeScript 栈）尚未做对应的管理面封装。本 feature 包未来若落地，预期是「主仓上述能力的 admin-console 管理面 SDK」（编辑 agent / 分配模型 / 配置分身）。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/admin-console` | 未来消费者 | 预留对应 admin 页面（当前不存在） |
| `apps/web-portal` | 未声明依赖 | portal `package.json` 未引用 `feature-agents` |
| 主仓 `agenticx/avatar` / `agenticx/agents` / `agenticx/collaboration` | 概念映射 | 真实能力源头（Python 栈，非 enterprise） |

## 完成度判定

| 维度 | 状态 |
|---|---|
| 包骨架（package.json / tsconfig / index.ts） | ✅ 存在 |
| 业务逻辑 / 类型 / 组件 / API | ❌ 无 |
| enterprise 端消费者 | ❌ 无 |
| 真实能力实现 | ⚠️ 在主仓，非本 feature 包 |
| **整体** | **纯 stub，能力在主仓** |
