---
name: desktop-trace-sharing-settings
overview: Sub-plan C. Keep the tenant traceContent flag when Desktop syncs the agent policy to disk, expose trace_upload through a new IPC, and show a sharing status line with a pause switch in the signed-in enterprise card of the Account settings tab.
todos:
  - id: c1-normalizer
    content: desktop/electron/enterprise-agent-policy.ts keeps trace_content + tests
    status: completed
  - id: c2-ipc
    content: main.ts config type, load-enterprise-account fields, set-enterprise-trace-upload handler; preload + global.d.ts
    status: completed
  - id: c3-ui
    content: AccountTab status line + SettingsSwitch + zh/en locale keys
    status: completed
  - id: c4-verify
    content: vitest + electron and renderer tsc
    status: completed
isProject: false
---

# Sub-plan C: Desktop trace sharing status and switch

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7 xhigh
Master: `.cursor/plans/2026-11-15-enterprise-trace-account-closure.plan.md` (read section 3 "Shared contract" first)

Scope is strictly `desktop/`. Do not touch `enterprise/` or `agenticx/`.

## Root cause

1. `desktop/electron/enterprise-agent-policy.ts` `normalizeAgentActionPolicy` returns only `denied_tools`, `always_ask_tools`, `disable_session_allow`. `scheduleEnterpriseCapabilitySync` in `desktop/electron/main.ts` (around L2357-2410) writes its result to `cfg.enterprise.agent_action_policy`, so a new `traceContent` from bootstrap would be dropped before the Python runtime can read `enterprise.agent_action_policy.trace_content`.
2. `enterprise.trace_upload` (read by `agenticx/runtime/enterprise_trace.py` `trace_upload_enabled`; missing = on, explicit `false` = off) has no GUI. `AccountTab` shows only name, email, portal URL, logout.

## Changes

### C1. `desktop/electron/enterprise-agent-policy.ts`

- `NormalizedAgentActionPolicy`: add `trace_content: boolean;`
- Add helper:
  ```ts
  function readBool(source: Record<string, unknown>, camel: string, snake: string): boolean {
    if (camel in source) return source[camel] === true;
    if (snake in source) return source[snake] === true;
    return false;
  }
  ```
- Non-object branch returns `{ denied_tools: [], always_ask_tools: [], disable_session_allow: false, trace_content: false }`.
- Object branch adds `trace_content: readBool(source, "traceContent", "trace_content")`. Leave `readFlag` as is.
- `desktop/tests/enterprise-agent-policy.test.ts`: update existing deep-equal expectations to include `trace_content: false`; add `{ traceContent: true }` -> true, `{ trace_content: true }` -> true, `{ traceContent: "yes" }` -> false.

### C2. Main process and bridge

`desktop/electron/main.ts`:

- In the `enterprise?: { ... }` config type (around L458-471) add:
  ```ts
  /** 员工本人对运行记录回流的开关；缺省视为开启，仅显式 false 暂停。 */
  trace_upload?: boolean;
  ```
- `ipcMain.handle("load-enterprise-account", ...)` (around L9167): add to the returned object
  ```ts
  traceUpload: ent?.trace_upload !== false,
  traceContent: normalizeAgentActionPolicy(ent?.agent_action_policy).trace_content,
  ```
  (`normalizeAgentActionPolicy` is already imported in main.ts; verify the import, do not duplicate.)
- Add a new handler directly after the `enterprise-logout` handler:
  ```ts
  ipcMain.handle("set-enterprise-trace-upload", async (_event, payload?: { enabled?: unknown }) => {
    if (typeof payload?.enabled !== "boolean") return { ok: false, error: "invalid-payload" };
    const cfg = loadAgxConfig();
    cfg.enterprise = { ...(cfg.enterprise ?? {}), trace_upload: payload.enabled };
    saveAgxConfig(cfg);
    return { ok: true, traceUpload: payload.enabled };
  });
  ```
- Do not modify `enterprise-login-start` or `enterprise-logout`.

`desktop/electron/preload.ts` (around L1211): extend the `loadEnterpriseAccount` return type with `traceUpload?: boolean; traceContent?: boolean;` and add next to it:
```ts
  setEnterpriseTraceUpload: async (payload: { enabled: boolean }) =>
    ipcRenderer.invoke("set-enterprise-trace-upload", payload) as Promise<{
      ok: boolean;
      traceUpload?: boolean;
      error?: string;
    }>,
```

`desktop/src/global.d.ts` (around L1157): mirror both changes exactly.

### C3. `desktop/src/components/AccountTab.tsx`

- Import `SettingsSwitch` from `./settings/SettingsSwitch`.
- State next to the other `ent*` states:
  ```ts
  const [entTraceUpload, setEntTraceUpload] = useState(true);
  const [entTraceContent, setEntTraceContent] = useState(false);
  const [entTraceSaving, setEntTraceSaving] = useState(false);
  ```
- In the mount effect after `setEntPortalUrl(...)`: `setEntTraceUpload(r.traceUpload !== false); setEntTraceContent(r.traceContent === true);`
- In `onEnterpriseAccountChanged` handler: when `payload.loggedIn` is true, call `window.agenticxDesktop.loadEnterpriseAccount()` and apply the same two setters (ignore errors), so a fresh login shows the current values.
- Handler:
  ```ts
  const onToggleTraceUpload = async (next: boolean) => {
    if (entTraceSaving) return;
    setEntTraceSaving(true);
    setEntTraceUpload(next);
    try {
      const r = await window.agenticxDesktop.setEnterpriseTraceUpload({ enabled: next });
      if (!r.ok) {
        setEntTraceUpload(!next);
        setEntError(r.error || t("account.traceUploadSaveFailed"));
      }
    } catch (e) {
      setEntTraceUpload(!next);
      setEntError(String(e));
    } finally {
      setEntTraceSaving(false);
    }
  };
  ```
- Render inside the signed-in enterprise card, after the `entPortalUrl` line and before the logout `Button`:
  ```tsx
  <div className="flex items-start justify-between gap-3 rounded-md bg-surface-hover px-3 py-2">
    <div className="min-w-0">
      <div className="text-xs font-medium text-text-primary">{t("account.traceUploadTitle")}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-text-subtle">
        {!entTraceUpload
          ? t("account.traceUploadOff")
          : entTraceContent
            ? t("account.traceUploadOnContent")
            : t("account.traceUploadOnMetrics")}
      </div>
    </div>
    <SettingsSwitch
      size="sm"
      checked={entTraceUpload}
      disabled={entTraceSaving}
      onChange={(next) => void onToggleTraceUpload(next)}
      aria-label={t("account.traceUploadTitle")}
    />
  </div>
  ```
  Also render `{entError ? <p className="text-xs text-amber-500">{entError}</p> : null}` inside the signed-in card only if not already shown there (today it is shown only in the signed-out card).
- The block must not render when signed out (it lives inside the `entLoggedIn` branch).

Locale keys, inside the existing `"account"` object (near `logoutEnterpriseMsg`, line ~970):

- `desktop/locales/zh/settings.json`:
  - `"traceUploadTitle": "运行记录回流"`
  - `"traceUploadOnMetrics": "正在向企业回传运行指标（耗时、Token、工具名与状态），不含对话内容。"`
  - `"traceUploadOnContent": "正在向企业回传运行指标；企业已开启对话摘录，提问、回复与推理各附前 500 字。"`
  - `"traceUploadOff": "已暂停。暂停期间的运行记录不会上传，也不会补传。"`
  - `"traceUploadSaveFailed": "保存失败，请重试"`
- `desktop/locales/en/settings.json`:
  - `"traceUploadTitle": "Run trace sharing"`
  - `"traceUploadOnMetrics": "Sharing run metrics (timing, tokens, tool names, status) with your organization. No conversation content."`
  - `"traceUploadOnContent": "Sharing run metrics. Your organization enabled excerpts: the first 500 characters of prompts, replies, and reasoning are included."`
  - `"traceUploadOff": "Paused. Runs during the pause are not uploaded later."`
  - `"traceUploadSaveFailed": "Could not save. Try again."`

## Verification

```bash
cd /Users/damon/myWork/AgenticX/desktop
npx vitest run tests/enterprise-agent-policy.test.ts
npx tsc -p electron/tsconfig.json --noEmit
npx tsc -p tsconfig.json --noEmit
```

If a typecheck reports errors in files you did not touch, report them; do not fix unrelated files.

## Acceptance

- AC-C1: bootstrap `agentActions.traceContent: true` -> after sync, `~/.agenticx/config.yaml` has `enterprise.agent_action_policy.trace_content: true`.
- AC-C2: switch off -> config `enterprise.trace_upload: false`; on -> `true`; failure reverts the switch and shows an error.
- AC-C3: status text follows the three states (off / on metrics only / on with excerpts).
- AC-C4: signed out -> block absent.
- AC-C5: listed vitest and both tsc runs pass.

## Out of scope

Login/logout handlers, capability sync logic other than the normalizer, Topbar/sidebar indicators, Python runtime, enterprise apps, `agenticx/studio/server.py`.
