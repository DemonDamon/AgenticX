# Near Mobile 结论索引

> **用途**：Mobile（产品名 Near Mobile）模块结论入口。行为细节见同目录 `mobile_conclusion.md`。
>
> **控制面**：本目录为 `code-module-summaries` 的 `custom` layout（`registry.json` + `state/`）。根 `.gitignore` 只忽略 `examples/**/conclusions/`，本目录应随仓库跟踪。
>
> **范围**：ownership 的 git root 是整个 **`mobile/`**。它是独立的 Expo 应用，不并入根 `conclusions/`（该注册表已把 `mobile` 排除，只管 `agenticx/`）或 `desktop/conclusions/`。

## 核心代码在哪？

| 区域 | 路径 | 职责 |
|------|------|------|
| **路由** | `mobile/app/` | Expo Router 屏幕：首页、配对、会话列表、消息流、设置 |
| **客户端与状态** | `mobile/src/api/`、`mobile/src/store.ts`、`mobile/src/hooks/` | Gateway REST/WS、SecureStore 绑定、轮询 |
| **消息渲染** | `mobile/src/lib/messages.ts`、`mobile/src/components/` | 回合过程折叠、Markdown、审批卡、加号面板 |
| 配置与发布 | `mobile/app.config.ts`、`mobile/eas.json`、`mobile/plugins/`、`mobile/RELEASE.md` | Expo/EAS、明文 HTTP、签名 runbook |
| 测试 | `mobile/src/lib/*.test.ts` | Vitest（消息折叠与代码着色） |

## 结论文档

| ID | 文档 | Roots |
|----|------|-------|
| `mobile` | [mobile_conclusion.md](./mobile_conclusion.md) | `mobile` |
