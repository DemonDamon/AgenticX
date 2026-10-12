# Moat-05 · 企业下发并强制执行「本机智能体动作策略」

Planned-with: claude-opus-5.5
Suggested-Impl-Model: grok-4.7
Plan-Id: 2026-10-12-moat-05-enterprise-agent-action-policy
Plan-File: `.cursor/plans/2026-10-12-moat-05-enterprise-agent-action-policy.plan.md`
Parent-Plan: `2026-10-12-governed-longrun-moat-master`

> **For implementer:** 独立 worktree，分支 `feat/moat-05-agent-action-policy`。不要 commit。本计划跨三段：enterprise（管理台 + 门户 + 数据库）、Desktop Electron、Python 运行时。按 §4.1 → §4.6 顺序做，每段测试绿了再进下一段。**不改** `enterprise_runtime_budgets` 表和 `budget-store.ts`（原因见 §1 末段）。

## 1. 要解决的问题

企业现在能下发给员工 Near 的只有：可用模型、能力包（MCP / 技能），以及三个安装开关。见 `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts` 返回的 `models` / `capabilities` / `policy.capabilities`。

企业**管不了**智能体在员工电脑上能执行什么：能不能 `git push`、能不能调某个 MCP 的写工具、能不能用「本会话不再询问」跳过确认。Near 端的工具拒绝 / 放行规则全是员工本人配置（`~/.agenticx/config.yaml` 的 `permissions.denied_tools` / `allowed_tools`，读取见 `agenticx/cli/agent_tools.py:94-145`）。

**为什么另建表：** 现有桌面策略 `desktopCapabilityPolicy` 和 `sessionTokenLimits` 存在 `enterprise_runtime_budgets.config` 里（`enterprise/apps/web-portal/src/lib/desktop-token-policy.ts:95-103`）。而管理台保存计量预算时，`enterprise/apps/admin-console/src/lib/db-stores/postgresql/budget-store.ts:60-72` 的 `normalizeBudget` 会重建整行、丢掉这两个键。新策略如果也放进去，会被同样冲掉。

## 2. 策略模型与执行语义

```ts
type DesktopAgentActionPolicy = {
  /** 这些工具在员工 Near 上直接拒绝执行。 */
  deniedTools: string[];
  /** 这些工具每次执行前必须由人确认；「全部自动执行」、白名单、会话放行都不能跳过。 */
  alwaysAskTools: string[];
  /** 为 true 时，员工点「本会话不再询问」不再生效。 */
  disableSessionAllow: boolean;
};
```

**模式匹配**（`fnmatch`，大小写不敏感）的对象叫「subject」：

- 普通工具：`tool_name`，例如 `bash_exec`、`file_write`、`delegate_to_avatar`。
- MCP 调用：额外生成 `mcp:<arguments.tool_name>`，例如 `mcp:send_message`、`mcp:create_*`。`mcp_call` 的参数键见 `agenticx/cli/agent_tools.py:7916`（`arguments.get("tool_name")`）。
- bash 里的 git 写操作：`bash_exec` 命令匹配 `(?:^|[;&|]\s*)git\s+push\b` 时额外生成 `git:push`（只做这一个，够覆盖最常见的企业诉求；其他命令不派生）。

任一 subject 命中即生效。`deniedTools` 优先于 `alwaysAskTools`。

**校验**（两端都做）：每个列表最多 100 项；每项 trim 后 1–128 字符，只允许 `[A-Za-z0-9_:*.\-/]`；不合法项丢弃；重复项去重。

**执行语义**（Near 端）：

| 情形 | 行为 |
|---|---|
| 未登录企业（`enterprise.enabled` 不为 true，或无 `enterprise.token`） | 策略完全不生效 |
| 命中 deniedTools | `dispatch_tool_async` 立即返回 `ERROR: 企业策略禁止执行「{subject}」。如需使用请联系管理员。`，不进入确认 |
| 命中 alwaysAskTools | 派发前强制一次确认，`risk="policy"`，确认文案 `企业策略要求确认：即将执行「{subject}」`；拒绝则返回 `CANCELLED: 企业策略要求的确认未通过（{denial_note}）`；批准后工具自身的确认（若有）在**同一次派发内**不再重复弹 |
| 无人值守 + 命中 alwaysAskTools | 走无人值守 gate：有 02 时挂起等审批，没有 02 时直接拦下。`risk="policy"` 本身就是受保护等级，不需要额外代码 |
| `disableSessionAllow == true` | `_confirm` 的会话放行分支不生效 |

## 3. In scope / Out of scope

**In scope**

| 段 | 文件 |
|---|---|
| 共享类型 | 新建 `enterprise/packages/config/src/desktop-agent-action-policy.ts`；`enterprise/packages/config/src/index.ts` 加一行 `export *` |
| 数据库 | `enterprise/packages/db-schema/src/schema/runtime-config.ts`、`src/mysql-schema/runtime-config.ts` 各新增一张表；手写迁移 `drizzle/0052_enterprise_desktop_agent_policy.sql`、`drizzle-mysql/0026_enterprise_desktop_agent_policy.sql`，并在两个 `meta/_journal.json` 末尾追加条目（格式照抄 0051 / 0025 条目，`idx` 递增，`when` 取前一条 +1） |
| 管理台 | 新建 `src/lib/db-stores/postgresql/desktop-agent-policy-store.ts`、`src/lib/db-stores/mysql/desktop-agent-policy-store.ts`、分发器 `src/lib/desktop-agent-policy-store.ts`（照抄 `src/lib/budget-store.ts` 的 dialect 分发写法）；新建 API `src/app/api/admin/desktop-agent-policy/route.ts`；新建面板 `src/components/capabilities/DesktopAgentPolicyPanel.tsx`；`src/app/admin/_sections/capabilities.tsx` 增加第四个 tab；`messages/zh.json`、`messages/en.json` 新键 |
| 门户 | 新建 `enterprise/apps/web-portal/src/lib/desktop-agent-policy-reader.ts`；`src/app/api/desktop/bootstrap/route.ts` 返回 `policy.agentActions` |
| Desktop | 新建 `desktop/electron/enterprise-agent-policy.ts`；`desktop/electron/main.ts::scheduleEnterpriseCapabilitySync`（约 :2235-2276）写入配置 |
| Python | 新建 `agenticx/runtime/enterprise_agent_policy.py`；`agenticx/cli/agent_tools.py` 的 `dispatch_tool_async`（:12261 起）与 `_confirm`（:4291 起） |
| 测试 | 见 §5 |

**Out of scope**

- 不改 `enterprise_runtime_budgets`、`budget-store.ts`、`desktop-token-policy.ts`（§1 的覆盖问题另议）。
- 不改 Go 网关（本计划不做审计，审计在 06）。
- 不改 Desktop 设置页 UI。员工端不需要看到这份策略：被拦时的工具结果文案已足够。
- 不做部门 / 用户级策略，本期只做租户级。
- 不改 `agenticx/studio/server.py`。

## 4. 具体改动

### 4.1 共享类型 `enterprise/packages/config/src/desktop-agent-action-policy.ts`

导出：`DesktopAgentActionPolicy` 类型、`DEFAULT_DESKTOP_AGENT_ACTION_POLICY = { deniedTools: [], alwaysAskTools: [], disableSessionAllow: false }`、`normalizeDesktopAgentActionPolicy(raw: unknown): DesktopAgentActionPolicy`（按 §2 校验规则；`disableSessionAllow` 只认真正的 `true`）。写法参照同目录 `desktop-capability-policy.ts`。测试 `src/__tests__/desktop-agent-action-policy.test.ts` 覆盖：非对象输入回落默认、非法字符丢弃、超 100 项截断、去重、`"true"` 字符串不算 true。

### 4.2 数据库

PG（`src/schema/runtime-config.ts` 末尾）：

```ts
/** 租户级「本机智能体动作策略」，Desktop bootstrap 下发。独立成表，避免被预算整行覆盖。 */
export const enterpriseDesktopAgentPolicies = pgTable("enterprise_desktop_agent_policies", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

MySQL 侧照抄 `mysql-schema/runtime-config.ts` 中 `enterpriseRuntimeBudgets` 的 MySQL 写法，表名相同。确认 `src/index.ts` / `src/mysql-schema/index.ts` 已经 `export *` 了 runtime-config（若没有，加上）。

PG 迁移 SQL：

```sql
-- 租户级本机智能体动作策略。
CREATE TABLE IF NOT EXISTS "enterprise_desktop_agent_policies" (
  "tenant_id" varchar(26) PRIMARY KEY NOT NULL,
  "config" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

MySQL 迁移用 `json` 类型、`timestamp DEFAULT CURRENT_TIMESTAMP`，写法照 `drizzle-mysql/` 里已有的 runtime 表迁移。完成后跑 `pnpm -C enterprise/packages/db-schema db:check:parity`。

### 4.3 管理台

- **store**（PG 版）：`getDesktopAgentPolicy(): Promise<DesktopAgentActionPolicy & { updatedAt: string | null }>`，`setDesktopAgentPolicy(input: unknown): Promise<...>`。写库前必须 `normalizeDesktopAgentActionPolicy`，用 `onConflictDoUpdate`。租户 id 取法照抄 `budget-store.ts` 的 `tenant()`（读 `DEFAULT_TENANT_ID`）。MySQL 版对应 upsert。
- **API** `src/app/api/admin/desktop-agent-policy/route.ts`：
  - `GET`：`requireAdminScope(["policy:read"])`，返回 `{ code: "00000", message: "ok", data: { policy } }`。
  - `PUT`：`requireAdminScope(["policy:update"])`；JSON 解析失败返回 `{ code: "40001" }` 400；成功返回同结构。存储异常返回 500 和错误信息，**不得**伪成功。
  - 两个 scope 名已在 `src/app/api/` 的策略规则路由中使用（核验：`rg -n 'requireAdminScope\(\["policy:' enterprise/apps/admin-console/src/app/api`）。
- **面板** `DesktopAgentPolicyPanel.tsx`：两个多行文本框（每行一个模式）分别对应 deniedTools / alwaysAskTools，一个开关对应 disableSessionAllow，底部只有一个「保存」按钮（不在顶部重复）。保存成功 toast，失败保留输入并显示接口返回的错误。每个文本框下给 2–3 个示例芯片（点击追加一行）：`git:push`、`mcp:send_*`、`bash_exec`。不写长段解释文案，也**不出现**任何仓库路径或配置文件名（AGENTS.md 对客户端 UI 的要求）。
- **tab**：`capabilities.tsx` 的 `TABS` 改为 `["packs", "skills", "mcp", "agentPolicy"]`，新增 `<TabsContent value="agentPolicy" className="pt-4"><DesktopAgentPolicyPanel /></TabsContent>`。
- **文案**（`messages/zh.json` / `en.json` 的 `pages.admin.capabilities` 下）：`tabs.agentPolicy`「智能体动作」/「Agent actions」，以及面板内标签：`deniedTools`「禁止执行」、`alwaysAskTools`「必须确认」、`disableSessionAllow`「禁止员工使用『本会话不再询问』」、`onePerLine`「每行一个，支持 * 通配」、`saved`「已保存」。

### 4.4 门户 bootstrap

- `src/lib/desktop-agent-policy-reader.ts`：`loadDesktopAgentPolicy(tenantId: string): Promise<DesktopAgentActionPolicy>`，按 dialect 读新表（写法参照同目录 `desktop-token-policy.ts` 的 `readBudgetConfig`）；无行、无 `DATABASE_URL`、表不存在（复用 bootstrap route 里 `isMissingCapabilityRelation` 的正则思路，把 `enterprise_desktop_agent_policies` 加进去，或在 reader 内单独判断）一律返回默认值并 `console.warn`。
- `bootstrap/route.ts`：`Promise.all` 增加 `loadDesktopAgentPolicy(identity.tenantId)`；返回体 `policy` 增加 `agentActions: <policy>`。其余字段一字不改。
- 测试：在已有 `src/app/api/desktop/bootstrap/__tests__/route.test.ts` 中加一条，mock reader 返回非默认值，断言 `data.policy.agentActions` 透出。

### 4.5 Desktop Electron

- 新建 `desktop/electron/enterprise-agent-policy.ts`：`normalizeAgentActionPolicy(raw: unknown)` → `{ denied_tools: string[]; always_ask_tools: string[]; disable_session_allow: boolean }`（snake_case，校验规则同 §2，与 enterprise 侧逐条一致）。
- `scheduleEnterpriseCapabilitySync`（main.ts 约 :2235）：
  - `resp.json()` 的类型扩展为 `{ data?: { capabilities?: unknown; policy?: { agentActions?: unknown } } }`。
  - 新增局部变量 `let agentPolicy: unknown = cfg.enterprise?.agent_action_policy;`；拿到响应后 `if (json.data?.policy && "agentActions" in json.data.policy) agentPolicy = json.data.policy.agentActions;`。
  - 在已有 `if (cfg.enterprise) { ...; saveAgxConfig(cfg); }` 块内、`saveAgxConfig` 之前，加 `cfg.enterprise.agent_action_policy = normalizeAgentActionPolicy(agentPolicy);`。
  - `EnterpriseSyncConfig` 类型（`desktop/electron/enterprise-capabilities-sync.ts:25-34`）的 `enterprise` 对象加可选字段 `agent_action_policy?: unknown`。
  - bootstrap 请求失败时沿用上次缓存的值（上面变量初值已保证）。
- 测试 `desktop/tests/enterprise-agent-policy.test.ts`：校验规则与 enterprise 侧同一组用例。

### 4.6 Python 运行时

**新建 `agenticx/runtime/enterprise_agent_policy.py`**：

```python
@dataclass(frozen=True)
class EnterpriseAgentPolicy:
    denied: tuple[str, ...] = ()
    always_ask: tuple[str, ...] = ()
    disable_session_allow: bool = False

def load_enterprise_agent_policy() -> EnterpriseAgentPolicy: ...
def policy_subjects(tool_name: str, arguments: dict[str, Any]) -> list[str]: ...
def enterprise_denied_subject(tool_name: str, arguments: dict[str, Any], policy: EnterpriseAgentPolicy | None = None) -> str | None: ...
def enterprise_ask_subject(tool_name: str, arguments: dict[str, Any], policy: EnterpriseAgentPolicy | None = None) -> str | None: ...
```

- `load_enterprise_agent_policy`：`ConfigManager.get_value("enterprise.enabled")` 不为 True，或 `enterprise.token` 为空 → 返回空策略。否则读 `enterprise.agent_action_policy`，再按 §2 校验一次（不信任磁盘）。任何异常返回空策略。
- `enterprise_*_subject` 返回第一个命中的 subject 字符串（用于文案），未命中返回 None。

**`agenticx/cli/agent_tools.py::dispatch_tool_async`**：

(a) 在现有

```python
    policy_denial = tool_denied_by_session_permissions(name)
    if policy_denial:
        return f"ERROR: {policy_denial}"
```

**之后**插入：

```python
    from agenticx.runtime.enterprise_agent_policy import (
        enterprise_ask_subject,
        enterprise_denied_subject,
        load_enterprise_agent_policy,
    )

    enterprise_policy = load_enterprise_agent_policy()
    denied_subject = enterprise_denied_subject(name, arguments, enterprise_policy)
    if denied_subject:
        return f"ERROR: 企业策略禁止执行「{denied_subject}」。如需使用请联系管理员。"
```

（函数内 import，与该文件现有惰性 import 风格一致。）

(b) 在 `gate = confirm_gate or SyncConfirmGate()`（约 :12327）**之后**插入：

```python
    ask_subject = enterprise_ask_subject(name, arguments, enterprise_policy)
    if ask_subject:
        approved = await _confirm(
            f"企业策略要求确认：即将执行「{ask_subject}」",
            confirm_gate=gate,
            context={
                "tool": name,
                "risk": "policy",
                "enterprise_policy": True,
                "policy_subject": ask_subject,
            },
            emit_event=event_callback,
            session=session,
        )
        if not approved:
            note = getattr(gate, "last_denial_note", "") or "用户拒绝"
            return f"CANCELLED: 企业策略要求的确认未通过（{note}）"
        setattr(session, "_enterprise_ask_satisfied_tool", name)
```

并在 `dispatch_tool_async` 现有返回路径之外不做清理：一次性标记由 `_confirm` 消费（下面 c），派发结束时若未被消费，下一次派发开头重置。也就是在 (a) 插入块**之前**加一行 `setattr(session, "_enterprise_ask_satisfied_tool", None)`。

(c) **`_confirm`**（:4291 起），在 `risk_codes = [...]` 计算之后、`path_raw = ...` 之前插入：

```python
    from agenticx.runtime.enterprise_agent_policy import load_enterprise_agent_policy

    enterprise_forced = bool(payload_context.get("enterprise_policy"))
    tool_for_policy = str(payload_context.get("tool") or "")
    if (
        not enterprise_forced
        and session is not None
        and tool_for_policy
        and getattr(session, "_enterprise_ask_satisfied_tool", None) == tool_for_policy
    ):
        setattr(session, "_enterprise_ask_satisfied_tool", None)
        _log.info("[confirm] auto-approved id=%s tool=%s by enterprise pre-confirmation", request_id, tool_for_policy)
        return True
    ent_policy = load_enterprise_agent_policy()
```

然后把现有三处「跳过确认」的条件各加一个前提：

- 允许规则分支 `if tool_allowed_without_confirm(...) or path_allow:` 改为 `if not enterprise_forced and (tool_allowed_without_confirm(...) or path_allow):`。
- 无人值守脚本分支 `if _unattended_workspace_script_allowed(...)` 改为 `if not enterprise_forced and _unattended_workspace_script_allowed(...)`。
- 会话放行分支的 `if (session is not None and sticky_tool and ...)` 条件里追加 `and not enterprise_forced and not ent_policy.disable_session_allow`。

其余逻辑一字不改。`risk="policy"` 已在 `agenticx/runtime/confirm.py:20-22` 的 `PROTECTED_CONFIRM_RISKS` 中，所以「全部自动执行」模式下的 `RiskAwareAutoConfirmGate(delegate=...)` 会转给人确认，不会自动批准。

## 5. 验收标准（AC）与测试

| AC | 测试文件 | 断言 |
|---|---|---|
| AC-1 | `enterprise/packages/config/src/__tests__/desktop-agent-action-policy.test.ts` | §4.1 所列校验规则 |
| AC-2 | `enterprise/apps/admin-console/src/app/api/admin/desktop-agent-policy/__tests__/route.test.ts` | 无 scope 403；PUT 非法 JSON 400；PUT 后 GET 返回规范化结果（非法项被丢弃）；store 抛错返回 500 |
| AC-3 | `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/__tests__/route.test.ts`（追加） | `data.policy.agentActions` 透出；reader 抛「表不存在」时为默认值且接口 200 |
| AC-4 | `desktop/tests/enterprise-agent-policy.test.ts` | 与 AC-1 同组用例结果一致 |
| AC-5 | `tests/test_enterprise_agent_policy.py` | 未登录企业 → 空策略；`mcp_call {"tool_name": "send_message"}` 命中 `mcp:send_*`；`bash_exec {"command": "cd x && git push origin main"}` 命中 `git:push`；`deniedTools` 优先于 `alwaysAskTools` |
| AC-6 | `tests/test_enterprise_agent_policy_dispatch.py` | monkeypatch `load_enterprise_agent_policy`：命中 denied → `dispatch_tool_async` 返回以 `ERROR: 企业策略禁止执行` 开头，且工具实现未被调用 |
| AC-7 | 同上 | 命中 always_ask + 用 `RiskAwareAutoConfirmGate(delegate=AsyncConfirmGate())` 模拟「全部自动执行」→ 产生一次待确认（delegate `_pending` 有 1 项）；resolve True 后工具执行；`file_write` 这类自带确认的工具**只**产生 1 次确认 |
| AC-8 | 同上 | always_ask + 拒绝 → 返回以 `CANCELLED: 企业策略要求的确认未通过` 开头 |
| AC-9 | 同上 | `disable_session_allow=True` 且 `session.sticky_allowed_tools={"file_write"}` → `file_write` 仍弹确认 |
| AC-10 | 同上 | 空策略时，`dispatch_tool_async` 与改动前行为一致（用一个已有测试工具对比结果字符串） |

运行：

```bash
pnpm -C enterprise --filter @agenticx/config test
pnpm -C enterprise --filter @agenticx/db-schema db:check:parity
pnpm -C enterprise --filter admin-console test -- desktop-agent-policy
pnpm -C enterprise --filter web-portal test -- bootstrap
pnpm -C enterprise typecheck
cd desktop && npx vitest run tests/enterprise-agent-policy.test.ts && cd ..
pytest tests/test_enterprise_agent_policy.py tests/test_enterprise_agent_policy_dispatch.py -q
pytest tests -q -k "confirm or permission"
```

（`--filter` 的包名以 `enterprise/apps/*/package.json` 的 `name` 为准，实施前先确认。）

手工：`bash enterprise/scripts/start-dev-with-infra.sh` 起企业栈 → 管理台「能力 → 智能体动作」填必须确认 `git:push` 并保存 → Near 登录企业账号、重启 → 设置「全部自动执行」→ 让模型在临时仓库执行 `git push` → 必须弹确认。
