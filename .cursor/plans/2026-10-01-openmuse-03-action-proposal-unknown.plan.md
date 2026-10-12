# OpenMuse-03 · ActionProposal + outcome_unknown

Planned-with: Auto (Composer)
Suggested-Impl-Model: Codex 中档；跨 ConfirmGate/reliability 收口可用 GPT-5.x
Plan-Id: 2026-10-01-openmuse-03-action-proposal-unknown
Plan-File: `.cursor/plans/2026-10-01-openmuse-03-action-proposal-unknown.plan.md`
Parent-Plan: `2026-10-01-openmuse-selective-adopt-master`
Source-SHA: `d0b3a6b` · OpenMuse `ActionService.decide` / `recoverInterruptedActions`

> **For Claude:** Reuse `agenticx/reliability/call_ledger.py` and existing clarification transport. Do not invent a second tool-call identity system. Do not rename or remove `interrupted_closers` text. Do not commit unless asked.

**Goal:** 把外部写副作用的人工审阅升级为**可持久、带 hash/TTL、启动可恢复**的 ActionProposal；不确定结果进入 `outcome_unknown` 且禁止静默重试。

**Architecture:** 新建 `agenticx/runtime/action_proposals/`（SQLite 或 session 旁路 JSON 均可，优先 SQLite 与 01 同目录风格但**独立 DB 文件**）。`_request_action_confirmation` 在发 UI 前 `propose()`；用户批准后 `claim→executing→handler`；handler 抛 `OutcomeUnknownError` 或进程崩溃遗留 executing 时变 `outcome_unknown`。重放/retry 路径查 CallLedger + proposal 状态。

**Tech Stack:** Python、既有 `clarification_required` + `context.kind=action_confirmation`、pytest。

---

## In scope

- Proposal 状态：`awaiting_review|executing|succeeded|failed|outcome_unknown|denied|expired`
- 字段：`id, hash, expires_at, payload, status, error, created_at`（连接类字段可选）
- `propose` / `decide(approve|deny)` / `recover_interrupted()`（启动调用点：Studio app lifespan 或 runtime 入口一处）
- `_request_action_confirmation` 接线：批准后才执行真正副作用（若当前已是「先确认再返回字符串让模型继续」，则改为返回 proposal id + 明确「已批准/已拒绝/unknown」语义，避免模型自行重放写）
- 单测覆盖 hash mismatch、expired、unknown 禁 retry

## Out of scope

- Gmail/Calendar 适配器
- Desktop 全新审批中心页面（沿用现有 action_confirmation 卡即可；可加 status badge 文案）
- 修改 reliability 的 fingerprint 算法
- durable_jobs worker（01）

---

## 根因与证据

| 证据 | 内容 |
|---|---|
| OpenMuse | `actions.ts:102-190` hash/连接/过期；`db.ts:91-94` startup recovery |
| AgenticX | `_request_action_confirmation`（`agent_tools.py:4133+`）已有 TTL 与 UI，但确认后无持久「已执行结果未知」对象 |
| AgenticX | `interrupted_closers.py` 仅修复 **消息配对手**，不阻止模型下一轮再调写工具 |
| AgenticX | `reliability/call_ledger.py` 已有 dispatched/completed — 03 在 approve 执行路径写入 ledger |

---

## FR / AC

| ID | 需求 | AC |
|---|---|---|
| FR-1 | propose 生成 hash（payload 规范序列化） | `test_propose_hash_stable` |
| FR-2 | decide 时 hash 不符 → 拒绝 | `test_decide_hash_mismatch` |
| FR-3 | 过期 → expired | `test_decide_expired` |
| FR-4 | 执行中抛 OutcomeUnknownError → status=outcome_unknown | `test_outcome_unknown` |
| FR-5 | recover_interrupted 把遗留 executing→outcome_unknown | `test_recover_interrupted` |
| FR-6 | outcome_unknown / 非 succeeded 时拒绝「静默再执行同一 proposal」 | `test_no_silent_retry` |
| NFR-1 | 不改 `server.py` import 块；启动 recovery 挂在既有 lifespan/hook，精确插行 | diff review |

---

## 落点

### 新建

- `agenticx/runtime/action_proposals/__init__.py`
- `agenticx/runtime/action_proposals/store.py`
- `agenticx/runtime/action_proposals/errors.py` — `OutcomeUnknownError`
- `agenticx/runtime/action_proposals/service.py` — `ActionProposalService`
- `tests/test_action_proposals.py`

### 修改

- `agenticx/cli/agent_tools.py` · `_request_action_confirmation`（约 4133–4260）：approve 路径走 service.decide；返回值包含 proposal id 与终态
- 可选：`agenticx/runtime/agent_runtime.py` 启动或 session 恢复处调用 `recover_interrupted()`（精确一行调用，勿大段替换）

### before/after 意图

```text
before: UI 确认 → 返回 "[ACTION_APPROVED]" 字符串 → 模型可能再次调用写工具
after:  UI 确认 → claim proposal → 执行绑定的副作用或标记 approved_for_tool_X
        若结果未知 → outcome_unknown，工具层拒绝同一 proposal 再执行
```

---

## 实施步骤

1. 红测：hash / expire / unknown / recover
2. 实现 store+service
3. 接线 `_request_action_confirmation`
4. 启动 recovery 一点挂载
5. 确认与 CallLedger：外部写工具 approve 执行时 `ledger.record_dispatched`（若接口已存在则调用；没有则本 plan 只写 proposal，不强迫改 ledger API）

---

## 风险

- 与 SDK reliability 计划并行时：只 **import 使用**，不修改 `call_identity.py` 核心算法。
- 模型在 unknown 后换参数再调写工具：靠工具描述 + 可选 effect_class 策略；完整防绕过属 replay_policy，不在本 plan 一次做完。
