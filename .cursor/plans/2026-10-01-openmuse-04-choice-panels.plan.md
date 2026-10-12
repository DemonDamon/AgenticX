# OpenMuse-04 · Structured Choice Panels

Planned-with: Auto (Composer)
Suggested-Impl-Model: 前端品味档（Opus/同级）或 Composer 2.5；禁止引入 TypeSafe/CopilotKit
Plan-Id: 2026-10-01-openmuse-04-choice-panels
Plan-File: `.cursor/plans/2026-10-01-openmuse-04-choice-panels.plan.md`
Parent-Plan: `2026-10-01-openmuse-selective-adopt-master`
Source-SHA: `d0b3a6b` · OpenMuse `JevService` / `present_choices`（**产品名勿称 Jev**）

> **For Claude:** Extend existing ClarificationCard / request_clarification. Never name this feature "Jev" (conflicts with group routing Jev). No TypeSafe. Do not commit unless asked.

**Goal:** 为歧义请求提供带版本号的结构化选择/对比面板：澄清选项或带 source URL 的对比卡（最多 3）；过期/被取代面板不可再选。

**Architecture:** 后端轻量 `ChoicePanelStore`（SQLite 或 session metadata）；工具 `present_choices`（或扩展 `request_clarification` 的 `context.kind=choice_panel`）。Desktop 扩展 `ClarificationCard` 或新增 `ChoicePanelCard` 共用 shell class。选择通过既有 `/api/clarify` 回传，附带 `panel_id` + `candidate_set_version`。

**Tech Stack:** React/Zustand、既有 clarify API、pytest/Vitest。

---

## In scope

- Panel types: `clarification` | `comparison`
- Fields: `panel_id`, `candidate_set_version`, `options[{id,label,details[],sources[{title,url}]}]`, `selected_id?`
- comparison：每项至少 1 source；最多 3 可见选项
- supersession：新 panel 或新用户 turn 使旧 panel 只读
- sample 排序可本地启发式（关键词打分），**不**接外部决策服务

## Out of scope

- TypeSafe / CopilotKit / OpenMuse 远程 Jev
- 改名或改动群聊 `group_jev_decision` / `JevRouteChip`
- durable job lease、ActionProposal
- 大改 Settings 视觉体系

---

## 根因与证据

| 侧 | 事实 |
|---|---|
| OpenMuse | `packages/domain/src/jev.ts` schema；`JevService.select` 校验 version |
| AgenticX | 已有 `request_clarification` + `ClarificationCard` + `store.clarificationPrompt`，但无 candidateSetVersion / comparison sources 约束 |

---

## FR / AC

| ID | 需求 | AC |
|---|---|---|
| FR-1 | 可创建 clarification panel 并渲染选项 | Desktop：卡片可见选项按钮 |
| FR-2 | comparison 无 source 拒绝创建 | 后端 zod/校验测 |
| FR-3 | 选择时 version 不匹配 → 错误，不写入 selected | `test_stale_choice_rejected` |
| FR-4 | 新 panel 发布后旧卡 disabled | 组件测或 store 测 |
| FR-5 | 工具名/文案不出现产品名「Jev」 | rg 本 PR diff 无误用 |
| NFR-1 | 复用 `ASSISTANT_INLINE_CARD_SHELL_CLASS` | 视觉与澄清卡同壳 |

---

## 落点

### 后端

- Create: `agenticx/runtime/choice_panels/store.py`（或 `agenticx/studio/choice_panels.py`）
- Modify: `agenticx/cli/agent_tools.py` — 新增 `present_choices` 或扩展 clarification context
- Modify: `POST /api/clarify` 处理（`server.py` **仅精确插字段**；若 Wave A 争用 server.py，优先把校验放在工具层，clarify 只透传 version）

### 前端

- Modify: `desktop/src/components/messages/ClarificationCard.tsx` **或** Create: `ChoicePanelCard.tsx`
- Modify: `desktop/src/store.ts` — PendingClarification 扩展可选 `panelId` / `candidateSetVersion` / `sources`
- Modify: `desktop/src/utils/clarification-notice.ts` — 序列化选择答案含 version
- Test: `desktop/src/**/*choice*` 或 vitest 旁路

### before/after

```text
before: request_clarification → 一次性选项，无版本，无对比来源
after:  present_choices → 持久 panel + version；comparison 必须带 http(s) sources；stale select 失败
```

---

## 实施步骤

1. 定 schema（可参考 OpenMuse `jevPanelSchema` 但重命名 Choice*）
2. 后端红测 stale select
3. 工具 + store
4. Desktop 卡片扩展
5. 手工：聊天触发多选项 → 选一项 → 再发新 panel → 旧按钮不可点

---

## 风险

- 与群聊 Jev 文案混淆 → PR 描述与 UI 字符串用「选择面板 / 对比选项」
- 并行改 `store.ts`：缩小 diff，只加可选字段，避免重排大对象
