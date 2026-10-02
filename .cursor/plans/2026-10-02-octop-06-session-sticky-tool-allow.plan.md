# Octop-06：本会话「不再询问此工具」（会话级 sticky 放行）

Planned-with: Claude Sonnet 5.5
Suggested-Impl-Model: Codex 中档（后端 + 前端各一小块，需读懂 confirm 链路）
Plan-Id: 2026-10-02-octop-06-session-sticky-tool-allow
Plan-File: `.cursor/plans/2026-10-02-octop-06-session-sticky-tool-allow.plan.md`
Parent: `.cursor/plans/2026-10-01-openmuse-selective-adopt-master.plan.md`（Wave C）
Source: `research/codedeepresearch/Octop/Octop_source_notes.md` §10 P0 行「会话级 sticky HITL」（E-009）

> **For implementer:** 独立 git worktree（分支 `feat/octop-06-sticky-allow`，基于 main HEAD）。不要 commit。严守 `no-scope-creep.mdc`。改 `agenticx/studio/server.py` 只能精确增行，改完必须 `agx serve` 冷启动 smoke（见 AGENTS.md）。

## Goal

「Ask Every Time」模式下，每次 `file_write` / `file_edit` / `codegen` 都弹确认，长任务极打断体验。给确认卡增加「本会话不再询问此工具」，仅对**低风险**工具生效；高危/破坏性/桌面操控/策略类永不被 sticky。

## Root cause / 现状证据（实施者可自行核对）

- `agenticx/cli/agent_tools.py::_confirm`（约 L3888）：依次判断 `tool_allowed_without_confirm`（全局 permissions allow 规则）→ 无人值守 workspace script → 发 `confirm_required` 事件、等 `confirm_gate.request_confirm`。**没有会话级记忆**。
- 低风险工具上下文已带 `"risk": "low"`：`file_write`（≈L6130）、`file_edit`（≈L6211）、`codegen`（≈L6273）。其它均为 `computer_use` / `high` / `policy` / `destructive` 或未标（fail-closed 视为 protected，见 `agenticx/runtime/confirm.py::normalize_confirm_risk`）。
- `/api/confirm`（`agenticx/studio/server.py` 约 L2691 `post_confirm`）只收 `{session_id, request_id, approved, agent_id}`；`agenticx/studio/protocols.py::ConfirmResponse`（L85）同。
- Desktop 的确认按钮在 `desktop/src/components/ChatPane.tsx`（`resolveGroupInlineConfirm` ≈L13656、inline confirm 渲染 ≈L3710 附近）及 `ChatView.tsx`（≈L1776）；渲染组件可从 `inlineConfirm` 用法追（`MessageRenderer.tsx`、`TurnToolGroupCard.tsx`）。

## 设计

1. `StudioSession`（`agenticx/cli/agent_tools.py` 或其定义处，用 `rg "class StudioSession"` 定位）新增字段 `sticky_allowed_tools: set[str]`（默认空；持久化非必须——重启后重新询问，更安全）。
2. 后端 `_confirm` 在 `tool_allowed_without_confirm` 判断之后、`emit` 之前插入：

```python
tool_name = str(payload_context.get("tool") or "")
if (
    session is not None
    and tool_name
    and tool_name in getattr(session, "sticky_allowed_tools", set())
    and not is_protected_confirm(payload_context)   # 仅 risk == "low"
    and not (set(risk_codes) & NEVER_AUTO_APPROVED_CATEGORIES)
):
    _log.info("[confirm] auto-approved id=%s tool=%s by session sticky allow", request_id, tool_name)
    return True
```

3. `ConfirmResponse` 增加可选 `remember: Optional[Literal["session"]] = None`。
4. `post_confirm`：在 `gate.resolve(...)` **之前**读出该 request 的 context（`gate._pending_meta.get(request_id, {}).get("context")`，AsyncConfirmGate 已保存；取不到则跳过 remember）。仅当 `payload.approved and payload.remember == "session"` 且 `not is_protected_confirm(ctx)` 时，`managed.session.sticky_allowed_tools.add(ctx["tool"])`。返回体增加 `"remembered": bool`。
5. `RiskAwareAutoConfirmGate` 不需改动（低风险本就自动通过）。
6. 前端：确认卡（仅当 `context.risk === "low"` 时）在「允许」旁增加次级按钮「本会话不再询问」；点击发送 `approved: true, remember: "session"`。protected 的卡不渲染此按钮。文案进 `desktop/locales/{zh,en}/chat.json`。已记住的工具，后续不再弹卡（后端直接放行），无需前端状态。
7. `ask_user_question` / `request_clarification` / `request_action_confirmation` **不得**经 sticky 放行：clarification 走 ClarifyGate、action confirmation 走 `_request_action_confirmation`，均不经过 `_confirm`，保持原状；在测试里断言这点（grep 保证 `sticky_allowed_tools` 只在 `_confirm` 与 `post_confirm` 出现）。

## In scope

- `agent_tools.py::_confirm` 插入 sticky 判断；Session 字段；`protocols.py::ConfirmResponse.remember`；`server.py::post_confirm` 记忆逻辑；Desktop 确认卡按钮 + i18n；测试。

## Out of scope（禁止顺手改）

- 持久化 sticky 到磁盘/config；全局 permissions 规则 UI；`RiskAwareAutoConfirmGate` 行为；任何 protected 工具的放行；`_request_action_confirmation`；群聊成员 confirm 路由。

## FR / AC

- **FR-1** 低风险工具一次「本会话不再询问」后，同会话再次调用同工具不弹卡。**AC-1** `tests/test_confirm_session_sticky.py::test_sticky_low_risk_skips_prompt`：构造 session + AsyncConfirmGate，第一次 `_confirm(context={"tool":"file_write","risk":"low"})` 经 `post_confirm` 逻辑（或直接调用抽出的 helper）记忆后，第二次 `_confirm` 不创建 pending、直接 True。
- **FR-2** protected 永不 sticky。**AC-2** `test_protected_never_sticky`：`risk` 为 `high`/`destructive`/`computer_use`/缺省，带 `remember=session` 也不写入集合，第二次仍进入 pending。
- **FR-3** sticky 按会话隔离。**AC-3** `test_sticky_is_per_session`。
- **FR-4** 前端按钮仅 low 风险出现。**AC-4** vitest：`desktop/src/components/messages/*Confirm*.test.tsx`（若无现成组件测，则为抽出的纯函数 `shouldOfferSessionRemember(context)` 加测）。
- **AC-5** `agx serve --host 127.0.0.1 --port <临时端口>` 冷启动，`/api/session`、`/api/avatars`、`/api/sessions` 200。

## 验证命令

```bash
python -m pytest tests/test_confirm_session_sticky.py -q --no-cov
cd desktop && npx vitest run <新增测试文件>
```
