# ADR 0001: Provider 硬失败会话隔离与策略 Deny 优先于 Hook/Confirm

## 状态

Accepted — 2026-04-12

## 背景

Claude Code 在 **2.1.101** 等版本中明确修复：

1. **`permissions.deny` 必须压过** `PreToolUse` hook 的 `permissionDecision: "ask"`，避免将硬拒绝降级为可询问。
2. **子智能体 MCP 继承**、resume 链一致性、以及 **429/欠费等错误** 的可行动提示，减少长程任务中的无效重试与死循环。

AgenticX 在真实使用中已出现 **Provider 403 / AccountOverdue** 后 Meta 仍并行 `spawn_subagent` 同一路由、触发 **loop-critical** 的现象。本 ADR 将两条不变量映射到 Python/Studio 语义。

## 决策

### 不变量 A — Provider 硬失败（会话级）

- **分类**：对 LLM 调用异常做轻量分类（`billing` | `auth` | `rate_limit` | …）。
- **会话黑名单**：当分类为 **`billing` 或 `auth`** 时，将当前 **provider 名称（规范化小写）** 写入 `StudioSession` 上的 **仅内存、仅本会话** 集合（不默认持久化到磁盘）。
- **消费点**：
  - `recommend_subagent_model` 的候选列表 **排除** 已拉黑 provider；
  - `spawn_subagent` 在显式/路由得到 provider 时若命中黑名单，**直接返回 JSON 错误**，不再起子进程；
  - Meta 系统提示中注入简短 **「以下 provider 本会话已不可用」** 列表，避免盲目重试。
- **开关**：`AGX_PROVIDER_FAULT_ESCALATION` 默认为开启语义；设为 `0`/`false`/`off` 时 **不记录** 黑名单（回滚/对照实验）。

### 不变量 B — 策略 Deny 优先于 Hook 与 Confirm

- **`permissions.denied_tools`**（及「工具不在当前 `allowed_tool_names`」）视为 **策略性 deny**。
- **执行顺序**（主对话 `AgentRuntime.run_turn` 工具轮）：在调用 **`HookRegistry.run_before_tool_call`** 与进入 **`dispatch_tool_async` → `_confirm`** 之前，先判定 deny / allowlist；命中则直接生成 **tool 错误结果**，**不**触发全局 `tool:before_call` hook 链（避免「先 hook 再发现不允许」），也 **不** 下发 `confirm_required`。

## 后果

- **正**：减少欠费/密钥失效后的无效 spawn；配置拒绝的工具不再出现「先弹窗再问」的违背策略体验。
- **负**：`pre_tool_guard` 对 **已被策略拒绝** 的工具名不再运行（通常无意义；若未来需在 deny 上仍做审计日志，可在 deny 分支单独打 log）。
- **兼容**：黑名单不写入 `messages.json`，会话重载后清空（可后续 ADR 扩展持久化）。

## 参考

- 研究产物：[anthropics-claude-code_proposal.md](../../research/codedeepresearch/anthropics-claude-code/anthropics-claude-code_proposal.md)
- 上游：`anthropics/claude-code` CHANGELOG 2.1.101（deny vs hook、子 agent MCP 等条目）
