---
name: enterprise-trace-content-policy
overview: Sub-plan B. Add a tenant-level traceContent switch (default off) to the desktop agent policy, expose it in the admin console, deliver it through bootstrap, and enforce it in the portal ingest route so old desktop clients cannot store content excerpts.
todos:
  - id: b1-config
    content: "@agenticx/config DesktopAgentActionPolicy.traceContent + normalizer + tests"
    status: completed
  - id: b2-stores
    content: admin-console PG and MySQL desktop-agent-policy stores persist and return traceContent
    status: completed
  - id: b3-portal-defaults
    content: web-portal policy reader defaults and bootstrap DEFAULT_AGENT_ACTIONS include traceContent false
    status: completed
  - id: b4-admin-ui
    content: DesktopAgentPolicyPanel switch + zh/en messages
    status: completed
  - id: b5-ingest-guard
    content: web-portal /api/desktop/agent-traces strips content keys unless tenant traceContent is true + tests
    status: completed
  - id: b6-verify
    content: vitest + typecheck for config, admin-console, web-portal
    status: completed
isProject: false
---

# Sub-plan B: tenant traceContent policy and ingest guard

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7 xhigh
Master: `.cursor/plans/2026-11-15-enterprise-trace-account-closure.plan.md` (read section 3 "Shared contract" first)

Scope is strictly `enterprise/`. Do not touch `desktop/` or `agenticx/`.

## Root cause

Desktop clients upload `metadata.user_text`, `metadata.reply`, `metadata.thought` (each up to 500 chars). The portal route `enterprise/apps/web-portal/src/app/api/desktop/agent-traces/route.ts` `asSpan()` copies `metadata` verbatim into `agent_token_traces`. No tenant setting controls this, and deployed old clients will keep sending content, so the server must enforce the default.

The tenant policy channel already exists and is reused:
admin `DesktopAgentPolicyPanel` -> `PUT /api/admin/desktop-agent-policy` -> `setDesktopAgentPolicy` (JSON column `enterprise_desktop_agent_policies.config`) -> portal `loadDesktopAgentPolicy(tenantId)` -> `GET /api/desktop/bootstrap` `data.policy.agentActions`.

## Changes

### B1. `enterprise/packages/config/src/desktop-agent-action-policy.ts`

- Type: add
  ```ts
  /** When true, employee run traces may include user, reply, and reasoning excerpts. Default false. */
  traceContent: boolean;
  ```
- `DEFAULT_DESKTOP_AGENT_ACTION_POLICY`: add `traceContent: false`.
- `normalizeDesktopAgentActionPolicy`: return `traceContent: source.traceContent === true`. The non-object branch already spreads the default, so it gets `false`.
- `enterprise/packages/config/src/__tests__/desktop-agent-action-policy.test.ts`: update existing deep-equal expectations to include `traceContent: false`; add cases `{ traceContent: true }` -> true, `{ traceContent: "true" }` -> false, missing -> false.

### B2. Admin stores (both files, same edit)

- `enterprise/apps/admin-console/src/lib/db-stores/postgresql/desktop-agent-policy-store.ts`
- `enterprise/apps/admin-console/src/lib/db-stores/mysql/desktop-agent-policy-store.ts`

In `recordFrom` add `traceContent: policy.traceContent,`. In `setDesktopAgentPolicy` add `traceContent: policy.traceContent,` to the `config` object. No schema/migration change (JSON column).

Update `enterprise/apps/admin-console/src/app/api/admin/desktop-agent-policy/__tests__/route.test.ts` only where its expectations deep-equal the policy shape.

### B3. Portal defaults

- `enterprise/apps/web-portal/src/lib/desktop-agent-policy-reader.ts`: the three literal fallback objects in `loadDesktopAgentPolicy` each get `traceContent: false`.
- `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts`: `DEFAULT_AGENT_ACTIONS` gets `traceContent: false`.
- Update `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/__tests__/route.test.ts` only where it deep-equals `agentActions`.

### B4. Admin UI `enterprise/apps/admin-console/src/components/capabilities/DesktopAgentPolicyPanel.tsx`

- `const [traceContent, setTraceContent] = useState(false);`
- Load: extend the response type with `traceContent?: unknown`, then `setTraceContent(policy?.traceContent === true);`
- Save: include `traceContent` in the PUT body; after save `setTraceContent(policy.traceContent === true)`; add `traceContent` to the `useCallback` deps.
- Render a second switch row directly below the `disableSessionAllow` row, same container classes:
  ```tsx
  <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
    <div className="space-y-1">
      <Label htmlFor="agent-policy-trace-content">{t("traceContent")}</Label>
      <p className="text-muted-foreground text-xs">{t("traceContentHint")}</p>
    </div>
    <Switch id="agent-policy-trace-content" checked={traceContent} onCheckedChange={setTraceContent} />
  </div>
  ```
- Messages under `pages.admin.capabilities` (next to `disableSessionAllow`, around line 1076):
  - `enterprise/apps/admin-console/messages/zh.json`: `"traceContent": "员工运行记录附带对话摘录"`, `"traceContentHint": "开启后回传提问、回复与推理各前 500 字；关闭时只回传耗时、Token、工具名与状态。"`
  - `enterprise/apps/admin-console/messages/en.json`: `"traceContent": "Include conversation excerpts in employee run traces"`, `"traceContentHint": "When on, the first 500 characters of the prompt, reply, and reasoning are included. When off, only timing, tokens, tool names, and status are sent."`

### B5. Ingest guard `enterprise/apps/web-portal/src/app/api/desktop/agent-traces/route.ts`

- Import at top: `import { loadDesktopAgentPolicy } from "../../../../lib/desktop-agent-policy-reader";`
- Add constant: `const CONTENT_METADATA_KEYS = ["user_text", "reply", "thought"] as const;`
- Change `asSpan(span, userId)` to `asSpan(span, userId, allowContent: boolean)`. Inside, build `metadata` as a shallow copy (`{ ...span.metadata }` when plain object, else `{}`), and when `!allowContent` delete each key in `CONTENT_METADATA_KEYS` from that copy before composing the returned metadata (the existing `user_id` / `source` overwrite stays last).
- In `POST`, after the spans array length check and before the validation loop:
  ```ts
  const allowContent = await loadDesktopAgentPolicy(identity.tenantId)
    .then((policy) => policy.traceContent === true)
    .catch(() => false);
  ```
  and pass `allowContent` to `asSpan`.
- Tests `enterprise/apps/web-portal/src/app/api/desktop/agent-traces/__tests__/route.test.ts`:
  - add `const loadDesktopAgentPolicy = vi.fn();` and `vi.mock("../../../../../lib/desktop-agent-policy-reader", () => ({ loadDesktopAgentPolicy: (...args: unknown[]) => loadDesktopAgentPolicy(...args) }));`
  - in `beforeEach`: `loadDesktopAgentPolicy.mockReset(); loadDesktopAgentPolicy.mockResolvedValue({ deniedTools: [], alwaysAskTools: [], disableSessionAllow: false, traceContent: false });`
  - new test "strips content excerpts by default": span metadata `{ user_text: "u", reply: "r", thought: "t", tool_name: "x" }`; assert inserted metadata has no `user_text/reply/thought`, keeps `tool_name`, and has `user_id` + `source: "near"`.
  - new test "keeps excerpts when tenant allows": mock resolves `traceContent: true`; assert `reply === "r"`.
  - new test "strips when policy lookup fails": mock rejects; assert stripped and status 200.
  - existing tests must keep passing.

## Verification

```bash
cd /Users/damon/myWork/AgenticX/enterprise
pnpm -C packages/config test && pnpm -C packages/config typecheck
pnpm -C apps/admin-console exec vitest run src/app/api/admin/desktop-agent-policy && pnpm -C apps/admin-console typecheck
pnpm -C apps/web-portal exec vitest run src/app/api/desktop/agent-traces src/app/api/desktop/bootstrap && pnpm -C apps/web-portal typecheck
```

If a typecheck fails on files unrelated to this sub-plan, report it; do not fix unrelated files.

## Acceptance

- AC-B1: policy unset -> bootstrap returns `agentActions.traceContent === false`.
- AC-B2: admin turns the switch on and saves -> GET returns `traceContent: true`; bootstrap returns `true`.
- AC-B3: ingest with `traceContent` false or lookup failure stores no `user_text/reply/thought`; with `true` stores them.
- AC-B4: listed vitest suites and three typechecks pass.

## Out of scope

Admin manual ingest route `apps/admin-console/src/app/api/agent-traces/ingest/route.ts`, agent-traces page rendering, `DEFAULT_TENANT_ID` usage, DB schema, `error_message` handling, anything outside `enterprise/`.
