---
name: Internalize CC Mechanisms
overview: 基于 anthropics-claude-code_proposal.md 的 P0 阶段：输出 ADR 架构决策记录，实现 Provider 计费/封禁等硬失败（G1）的会话级隔离，并审计强化权限拦截（G4）确保策略性 deny 不被 hook ask 降级，提供相应的冒烟测试。
todos:
  - id: write-adr
    content: 编写 ADR 记录：deny > hook 以及 Provider 故障隔离
    status: completed
  - id: implement-g1-provider-fault
    content: 实现 Provider 硬失败识别与会话级黑名单机制 (G1)
    status: completed
  - id: test-g1-provider-fault
    content: 编写并跑通 G1 的冒烟测试 (test_smoke_anthropics-claude-code_provider_fault.py)
    status: completed
  - id: implement-g4-deny-priority
    content: 实现策略 Deny 拦截优先于 confirm_required (G4) 的执行流控制
    status: completed
  - id: test-g4-deny-priority
    content: 编写并跑通 G4 的冒烟测试 (test_smoke_anthropics-claude-code_deny_priority.py)
    status: completed
isProject: false
---

# 实施计划：内化 Claude Code 长程稳定性机制 (P0 阶段)

根据 `research/codedeepresearch/anthropics-claude-code/anthropics-claude-code_proposal.md` 中确立的最小迁移机制（Principles + Invariants），本次实施按 `/codegen` 工作流重点落盘 **P0** 阶段的改动。

## 1. 功能点分析

| # | 功能点 | 优先级 | 上游证据 | AgenticX 落点 | 验收场景 |
|---|--------|--------|----------|---------------|----------|
| 1 | **架构决策记录 (ADR)** | P0 | `CHANGELOG.md` 2.1.101 L26 (deny vs hook) & L11-L12 (rate limit/fault) | `docs/adr/00XX-cc-invariants-provider-fault-and-deny-priority.md` | 落盘完整的 ADR，确立两条核心不变量 |
| 2 | **Provider 硬失败会话隔离 (G1)** | P0 | 避免多次用同 provider spawn 失败（AccountOverdueError 等） | `agenticx/llms/*_provider.py`, `agenticx/cli/studio.py` (`StudioSession`), `agenticx/runtime/prompts/meta_agent.py`, `agenticx/runtime/meta_tools.py` | 测试：Mock 返回 403 AccountOverdue，验证被记录黑名单且后续 `spawn_subagent` 不再推荐该 provider |
| 3 | **策略 Deny 强制优先 (G4)** | P0 | `CHANGELOG.md` L26: deny > hook ask | `agenticx/runtime/agent_runtime.py`, `agenticx/cli/agent_tools.py` | 测试：命中环境权限 deny 时，不再触发 `confirm_required` 询问 UI |

## 2. 最小接口设计

### 2.1 ProviderFaultClassifier (G1)
- **输入**: LLM Provider 抛出的异常
- **输出**: `Literal["billing", "auth", "rate_limit", "tool_unavailable", "transient", "unknown"]`
- **逻辑**: 在 `StudioSession` 增加 `provider_denylist` 集合，记录本会话发生 `billing` / `auth` 严重失败的提供商；在 `_recommend_subagent_model_payload` 排查/过滤这些提供商；并作为系统提示反馈给 Meta Agent，提示禁止复用该 Provider 盲目重试。

### 2.2 权限拦截前置与单调性 (G4)
- **输入**: 工具调用与参数。
- **验证**: `dispatch_tool_async` 内部或之前的 `allowed_tool_names` 检查，与 `ToolPolicyStack.check`
- **逻辑**: 如果 `tool_name` 已经被限制（不在允许列表），或者被 `denied_tools` 命中，直接抛错/生成错误 `TOOL_RESULT`，**必须短路绕过**后续向 UI 下发 `confirm_required` 的逻辑（如针对 bash 的风险确认）。确保「策略拦截」优于「风险提示及人工审批」。

## 3. 实现策略

- **轻量替代**：我们不搬 CC 复杂的 Node 基础设施，而是提取这两条不变量，分别将其落在 `StudioSession` 的运行态和 `agent_tools.py` / `agent_runtime.py` 的执行控制流中。
- **冒烟测试落盘**：`tests/test_smoke_anthropics-claude-code_provider_fault.py` 和 `tests/test_smoke_anthropics-claude-code_deny_priority.py`。
- **小步快跑**：
  1. 先落盘 ADR。
  2. 实现 G1 并通过测试。
  3. 实现 G4 并通过测试。

以上计划确认后，我将切换至 Agent 模式开始执行第一步（落盘 ADR）。

## 4. 验收记录（2026-04-12）

- **G4 手工验收**：在 Machi 中将 `bash_exec` 列入工具拒绝并保存后，用户消息「帮我用 bash 执行 pwd」→ 工具层返回策略拒绝文案，**未**进入 shell 风险确认流。与 P0 不变量一致。
- **副本说明**：本文件自 `~/.cursor/plans/internalize_cc_mechanisms_904234e8.plan.md` 归档至仓库，便于版本管理与 PR 引用。
