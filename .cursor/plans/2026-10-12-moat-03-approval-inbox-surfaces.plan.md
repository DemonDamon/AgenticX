# Moat-03 · 待审批收件箱（Desktop）与手机端合并挂起项

Planned-with: claude-opus-5.5
Suggested-Impl-Model: grok-4.7
Plan-Id: 2026-10-12-moat-03-approval-inbox-surfaces
Plan-File: `.cursor/plans/2026-10-12-moat-03-approval-inbox-surfaces.plan.md`
Parent-Plan: `2026-10-12-governed-longrun-moat-master`
Depends-On: `2026-10-12-moat-02-unattended-approval-parking`（必须已合并；本计划消费它的 `GET /api/approvals/pending`）

> **For implementer:** 独立 worktree，分支 `feat/moat-03-approval-inbox`。不要 commit。不改 `agenticx/studio/server.py`。不改 `mobile/` 代码。

## 1. 要解决的问题

02 让无人值守的受保护操作停下来等人，但停在哪里用户看不见：

- 定时任务的 SSE 由调度器消费（Electron `desktop/electron/main.ts::runAutomationTaskHttp`，约 :1128；或服务端 `agenticx/studio/automation_scheduler.py::_drain_chat`），不经过任何聊天窗格，行内确认卡不会出现。
- 手机端审批卡 `mobile/src/components/ConfirmCard.tsx` 通过设备 RPC `confirm.pending` 拉取。但 `agenticx/gateway/client.py::_rpc_confirm_pending`（:768）只读网关自己代发回合时记下的 `_PENDING_CONFIRMS`，看不到定时任务。

## 2. 交付

1. Desktop：一个「待审批」按钮 + 弹出列表，常驻在顶栏右侧和侧栏底部账户栏，与令牌仪表盘、设置按钮同排。有挂起项时显示数字角标，可直接批准 / 拒绝。
2. 网关客户端：`confirm.pending` 合并 02 的挂起项；`confirm.respond` 能处理挂起项。手机端零代码改动即可看到并处理。

## 3. In scope / Out of scope

**In scope**

1. 新建 `desktop/src/components/ApprovalInbox.tsx`（按钮 + 浮层）。
2. `desktop/src/components/SidebarAccountBar.tsx`：在 Gauge 按钮**之前**插入 `<ApprovalInboxButton />`。
3. `desktop/src/components/Topbar.tsx`：在右侧按钮组中 Gauge 按钮**之前**插入 `<ApprovalInboxButton />`（只有 `sidebarCollapsed` 时这一组才渲染，与现有按钮一致）。
4. `desktop/locales/zh/sidebar.json`、`desktop/locales/en/sidebar.json`：新增 `approvals.*` 键（两份键集合必须一致，`desktop/src/i18n/message-parity.test.ts` 会校验）。
5. `agenticx/gateway/client.py`：`_rpc_confirm_pending`、`_rpc_confirm_respond`，以及一个新增私有方法 `_fetch_parked_approvals`。
6. 测试：`desktop/src/components/ApprovalInbox.test.tsx`、`tests/test_gateway_parked_confirm_rpc.py`。

**Out of scope**

- 不做 OS 系统通知、不改 `desktop/electron/desktop-notify.ts`。
- 不改飞书 / 微信 IM 审批链路（`im_confirm.py` 的文字审批不动）。
- 不做「本会话记住」选项（挂起项一律单次批准）。
- 不改聊天窗格内现有行内确认卡。

## 4. 具体改动

### 4.1 `desktop/src/components/ApprovalInbox.tsx`（新建）

导出 `ApprovalInboxButton`。行为：

- 数据：`const apiBase = useAppStore((s) => s.apiBase)`、`const apiToken = useAppStore((s) => s.apiToken)`（两者在 `desktop/src/store.ts` 已存在，见 `apiToken` :630）。
- 轮询：组件挂载后每 **5s** `fetch(\`${apiBase}/api/approvals/pending\`, { headers: { "x-agx-desktop-token": apiToken } })`；`apiBase` 为空时不请求；卸载时清除定时器；请求失败静默（保留上一份数据），不弹 toast。
- 返回体：`{ ok: true, items: ParkedApprovalItem[] }`，类型在文件内定义：

```ts
type ParkedApprovalItem = {
  request_id: string;
  session_id: string;
  agent_id: string;
  question: string;
  tool: string;
  risk: string;
  protected_reason: string;
  label: string;
  created_at: number;
  expires_at: number;
  remaining_seconds: number;
};
```

- 按钮：`lucide-react` 的 `ShieldCheck` 图标，class 与同排按钮一致：`agx-topbar-btn agx-topbar-btn--icon-only`，`title` / `aria-label` 用 `t("approvals.title")`（`useTranslation("sidebar")`）。`items.length > 0` 时右上角显示数字角标（≥10 显示 `9+`），角标用主题变量 `--ui-btn-primary-bg`，不硬编码颜色。
- 浮层：点击按钮打开，用 `createPortal(…, document.body)` 挂载，避免被侧栏 `overflow` 裁掉（与输入框「新对话」下拉同理）。定位贴按钮，宽 360px，最大高 420px 可滚动，背景 `bg-surface-card`（不透明，不用半透叠色）。点击外部或按 `Esc` 关闭。
- 列表项（每项一行卡片）：
  - 第一行：来源标签。`label` 以 `automation:` 开头 → `t("approvals.sourceAutomation")`，否则 `t("approvals.sourceUnattended")`；右侧显示剩余时间 `t("approvals.remaining", { minutes: Math.max(1, Math.ceil(remaining_seconds / 60)) })`，按本地 1s 递减显示，不等下次轮询。
  - 第二行：`question`（最多 3 行，超出省略，`title` 显示全文）。
  - 第三行：`protected_reason`，次要文字色。
  - 按钮：「拒绝」在左、「批准」在右且紧邻（与仓库「取消紧靠保存左侧」约定一致）；批准用 `--ui-btn-primary-*` 变量。
- 批准 / 拒绝：`POST ${apiBase}/api/confirm`，body `{ session_id, request_id, approved, agent_id }`，header 同上。**乐观 UI**：点击后立即从列表移除该项；请求失败（非 2xx）则把该项放回并在**该卡片下方**显示一行错误（`t("approvals.failed")` + HTTP 状态），不用全局 toast。
- 空态：`t("approvals.empty")`，一行居中次要文字，不放解释性长文案。

### 4.2 locale 键（zh / en 各一份，键完全一致）

```json
"approvals": {
  "title": "待审批",
  "empty": "没有等待你决定的操作",
  "sourceAutomation": "定时任务",
  "sourceUnattended": "无人值守运行",
  "remaining": "{{minutes}} 分钟后自动拒绝",
  "approve": "批准",
  "deny": "拒绝",
  "failed": "提交失败"
}
```

英文对应：`Approvals` / `Nothing waiting for you` / `Scheduled task` / `Unattended run` / `Auto-deny in {{minutes}} min` / `Approve` / `Deny` / `Submit failed`。键名放进 `sidebar.json` 顶层对象（与 `account` 同级）。

### 4.3 `agenticx/gateway/client.py`

**(a)** 新增私有方法（放在 `_rpc_confirm_pending` 之前）：

```python
    async def _fetch_parked_approvals(self) -> list[Dict[str, Any]]:
        """Read unattended parked approvals from the local studio. Never raises."""
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(10.0, connect=5.0),
                transport=httpx.AsyncHTTPTransport(),
            ) as client:
                resp = await client.get(
                    f"{self._settings.studio_base_url}/api/approvals/pending",
                    headers=headers,
                )
            if resp.status_code != 200:
                return []
            items = resp.json().get("items")
            return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []
        except Exception:
            logger.debug("fetch parked approvals failed", exc_info=True)
            return []
```

（`httpx.AsyncHTTPTransport()` 绕过系统 SOCKS / HTTP 代理访问 localhost，与 AGENTS.md 中飞书长连接的做法一致。）

**(b)** `_rpc_confirm_pending`（:768）改为：先取原有 `rows = [_pending_confirm_dict(r) for r in _PENDING_CONFIRMS.list_for_sender(...)]`；再 `parked = await self._fetch_parked_approvals()`；把每个 parked 项映射为

```python
{
    "request_id": item["request_id"],
    "agent_id": item.get("agent_id") or "meta",
    "session_id": item["session_id"],
    "question": item.get("question") or "",
    "created_at": item.get("created_at") or 0,
    "source": "parked",
    "expires_at": item.get("expires_at"),
}
```

按 `request_id` 去重（已在 `rows` 的不重复加入），合并后返回。原有四个键保持不变，手机端 `mobile/src/api/types.ts` 对多出的键无感。

**(c)** `_rpc_confirm_respond`（:773）：现有逻辑在 `_PENDING_CONFIRMS.get(...)` 返回 None 时直接抛 `LookupError`。改为：None 且 `request_id` 非空时，调用 `_fetch_parked_approvals()` 找同 `request_id` 项。找到就构造 `PendingConfirm(request_id=..., agent_id=item.get("agent_id") or "meta", session_id=item["session_id"], question=item.get("question") or "", created_at=float(item.get("created_at") or 0))`，然后走原有 `_submit_confirm_and_remove(sender_key, pending, approved)` 和原有返回文案。仍找不到才抛原来的 `LookupError`。`request_id` 为空时（「批准最近一条」）**不**回退到挂起项，保持原行为。

实施前确认 `_submit_confirm_and_remove` 中从 store 移除不存在的项不会抛错（`rg -n "def remove" agenticx/gateway/im_confirm.py`）；若会抛，用 `try/except` 只包住移除那一步。

## 5. 验收标准（AC）与测试

### `desktop/src/components/ApprovalInbox.test.tsx`（Vitest + Testing Library，参照同目录已有 `*.test.tsx` 写法）

| AC | 断言 |
|---|---|
| AC-1 | mock `fetch` 返回 2 项 → 按钮角标显示 `2` |
| AC-2 | 返回 0 项 → 无角标；打开浮层显示 `approvals.empty` 文案 |
| AC-3 | 点「批准」→ 立即从列表消失；`fetch` 被以 `POST .../api/confirm` 调用，body 含 `approved: true` 与该项 `session_id` / `request_id` / `agent_id` |
| AC-4 | `/api/confirm` 返回 404 → 该项重新出现，卡片下方出现 `approvals.failed` 文案 |
| AC-5 | `label = "automation:atask_1"` 显示 `sourceAutomation`；`label = ""` 显示 `sourceUnattended` |

### `tests/test_gateway_parked_confirm_rpc.py`（pytest，monkeypatch `GatewayClient._fetch_parked_approvals` 与 `_submit_confirm_and_remove`）

| AC | 断言 |
|---|---|
| AC-6 | `_rpc_confirm_pending` 合并：store 1 项 + parked 2 项（其中 1 项与 store 同 id）→ 返回 2 项，parked 那项 `source == "parked"` |
| AC-7 | `_rpc_confirm_respond` 给 parked 的 `request_id` → 调用了 `_submit_confirm_and_remove`，其 `pending.session_id` 等于 parked 项 |
| AC-8 | `request_id` 既不在 store 也不在 parked → 抛 `LookupError` |
| AC-9 | `request_id` 为空 → 不调用 `_fetch_parked_approvals` |

### 回归与端到端

```bash
cd desktop && npx vitest run src/components/ApprovalInbox.test.tsx src/i18n/message-parity.test.ts
pytest tests/test_gateway_parked_confirm_rpc.py -q
```

手工：建一个 1 分钟后触发的定时任务，提示词要求执行一条会触发确认的命令（例如 `git push --dry-run` 以外的、`command_safety` 判为受保护的命令；可在仓库外的临时 git 仓库里做）。触发后 Desktop 收件箱出现该项；批准后任务继续，任务列表变为成功。另取一项在手机端审批卡里批准，结果相同。
