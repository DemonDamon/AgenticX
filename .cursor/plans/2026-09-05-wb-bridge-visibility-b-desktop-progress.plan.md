# wb-bridge 可见性 B：Near 进度卡（轮询 describe）

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: composer-2.5（ChatPane SSE 接线 + 一条 Studio 代理；不要上顶配）
主规划：`.cursor/plans/pending/2026-09-05-wb-bridge-desktop-visibility.plan.md`
**前置：** 子规划 A 全绿（`written_paths` / `observed_tools` / `last_activity` 已在 describe 里）。

---

## 1. 根因

进行中用户只看到 `wbBridgeSendToolProgressLabel(sec)`（`desktop/src/utils/wb-bridge-ui.ts` L3-6；`ChatPane.tsx` L10718-10721）：「已等待 Ns」。桥里已经有 `last_activity` / `observed_tools` / `turn_state`，但 `TOOL_PROGRESS` 不带这些字段，**本段仍不改 `agent_runtime.py`**。

改法：`wb_bridge_send` 的 `tool_call` 一旦带上 `session_id`，Desktop 经 **Studio 代理**每 2s `GET describe`，把快照格式化写进**同一条**工具消息；`tool_result` 到达后立刻停轮询。

渲染进程**禁止**直连 `127.0.0.1:9743`（无 CORS、token 不该进前端长期持有）。走已有 `x-agx-desktop-token`。

---

## 2. In scope / Out of scope

### In scope

1. `agenticx/studio/server.py`：在 `/api/wb-bridge/ensure` 与 `# --- Hooks API ---`（约 L8078）**之间**精确插入 `GET /api/wb-bridge/sessions/{session_id}`。
2. `desktop/src/utils/wb-bridge-ui.ts`：success 也展示 `observed_tools`；新增 live snapshot 格式化函数。
3. `desktop/src/utils/wb-bridge-ui.test.ts` 补断言。
4. `ChatPane.tsx`：仅在现有 `wb_bridge_start/send` 分支旁加 start/stop poll；`ChatView.tsx` 只复用格式化（Lite 可不做轮询）。
5. 新建 `desktop/src/utils/wb-bridge-progress.ts`（poll 启停，避免把定时器逻辑塞进 1.4 万行 ChatPane）。

### Out of scope

- 不改 `TOOL_PROGRESS` payload、不改 `cc_bridge_*`、不改 `http_app.py`（A 已加字段）。
- 不在本段接 `TurnArtifactCard`（属 C）。
- 不改 Settings 面板、不改拉起 serve 终端的逻辑（L10792-10799 保留）。
- `server.py` 除这一条新路由外一律不动（尤其文件顶部 import）。

---

## 3. 硬约束

1. 插入 `server.py` 后必须跑：`create_studio_app()` + `GET /api/session` `/api/avatars` `/api/sessions` → 200。
2. `session_id` 必须是 UUID，否则 400（与桥 `_parse_session_id` 一致）。
3. 轮询间隔 2000ms；同一 `tool_call_id` 最多一个 timer；卸载 pane / 换 session / `tool_result` / `abort` 必须 clear。
4. `formatWbBridgeSendToolResult` 解析失败仍返回 `null`（`ChatPane.tsx` L2494-2497 依赖）。
5. 用户可见文案中文。

---

## 4. 改动落点

### FR-B1 Studio 代理

插在 `server.py` `ensure_wb_bridge` 函数结束之后、`# --- Hooks API ---` 之前。**只新增，禁止替换相邻函数。**

```python
    @app.get("/api/wb-bridge/sessions/{session_id}")
    async def get_wb_bridge_session(
        session_id: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        import uuid as _uuid

        try:
            sid = str(_uuid.UUID(session_id))
        except ValueError:
            raise HTTPException(status_code=400, detail="session_id must be a UUID") from None
        try:
            import httpx
            from agenticx.wb_bridge.settings import (
                parse_wb_bridge_url,
                wb_bridge_base_url,
                wb_bridge_token,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        base = wb_bridge_base_url().rstrip("/")
        tok = wb_bridge_token()
        is_loopback, _h, _p = parse_wb_bridge_url(base)
        kwargs: dict = {"timeout": 5.0, "trust_env": False}
        if is_loopback:
            kwargs["transport"] = httpx.HTTPTransport()
        try:
            with httpx.Client(**kwargs) as client:
                resp = client.get(
                    f"{base}/v1/sessions/{sid}",
                    headers={"Authorization": f"Bearer {tok}"},
                )
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="wb-bridge unreachable") from None
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="session not found")
        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        data = resp.json()
        if not isinstance(data, dict):
            raise HTTPException(status_code=502, detail="invalid describe payload")
        return data
```

说明：这里的 `import httpx` / `uuid` 在函数体内，是为了**不碰文件顶部 import 区**。与「禁止 inline import」的通用规则冲突时，**以 server.py 顶部敏感约束为准**（本路由是例外，且写在函数内）。

### FR-B2 格式化

`desktop/src/utils/wb-bridge-ui.ts`：

1. 改 `observedToolsLine`：`status === "success" || status === "running"` 时也输出 `本轮已执行：A → B`（**不要**「重试前请先核验」）。blocked/error 保持现有核验句。
2. 新增：

```ts
export function formatWbBridgeLiveSnapshot(snap: Record<string, unknown>): string {
  const turnState = String(snap.turn_state ?? "");
  const activity = String(snap.last_activity ?? "").trim();
  const elapsed = snap.turn_elapsed_sec;
  const tools = Array.isArray(snap.observed_tools) ? snap.observed_tools.map(String) : [];
  const stalledAge = snap.last_activity_age_sec;
  const paths = Array.isArray(snap.written_paths) ? snap.written_paths.map(String) : [];
  const parts = [`⏳ WB：${turnState || "running"}`];
  if (typeof elapsed === "number") parts.push(`已 ${elapsed}s`);
  if (activity) parts.push(`当前 ${activity}`);
  if (tools.length) parts.push(`已执行 ${tools.join(" → ")}`);
  if (typeof stalledAge === "number" && stalledAge >= 30) parts.push("疑似等待确认");
  if (paths.length) parts.push(`写入 ${paths.length} 个文件`);
  return parts.join(" · ");
}
```

`wbBridgeSendToolProgressLabel` **签名不变**，作为 poll 失败时的回落。

### FR-B3 poll helper

新建 `desktop/src/utils/wb-bridge-progress.ts`：

```ts
const polls = new Map<string, ReturnType<typeof setInterval>>();

export function startWbBridgeProgressPoll(opts: {
  key: string; // tool_call_id
  sessionId: string;
  apiBase: string;
  apiToken: string;
  onSnapshot: (snap: Record<string, unknown>) => void;
}): void {
  stopWbBridgeProgressPoll(opts.key);
  const tick = async () => {
    const resp = await fetch(
      `${opts.apiBase}/api/wb-bridge/sessions/${opts.sessionId}`,
      { headers: { "x-agx-desktop-token": opts.apiToken } },
    );
    if (!resp.ok) return;
    const snap = (await resp.json()) as Record<string, unknown>;
    opts.onSnapshot(snap);
  };
  void tick();
  polls.set(opts.key, setInterval(() => void tick(), 2000));
}

export function stopWbBridgeProgressPoll(key: string): void {
  const t = polls.get(key);
  if (t) clearInterval(t);
  polls.delete(key);
}
```

单测：用 fake timers + mock `fetch`，断言 2s 第二次请求、stop 后不再请求。文件：`desktop/src/utils/wb-bridge-progress.test.ts`。

### FR-B4 ChatPane 接线（精确行块）

`desktop/src/components/ChatPane.tsx`：

1. 顶部 import 增加 `formatWbBridgeLiveSnapshot`、`startWbBridgeProgressPoll`、`stopWbBridgeProgressPoll`。
2. **L10718-10721** `wb_bridge_send` 的 `TOOL_PROGRESS` 分支：保留秒数回落；若该 `tool_call_id` 已有 poll，**不要**用秒数文案覆盖 live snapshot（poll 文案优先）。
3. **L10792-10799** `wb_bridge_start || wb_bridge_send` 旁，仅当 `toolNameStr === "wb_bridge_send"` 且 `toolArgs.session_id` 为 UUID 时：

```ts
startWbBridgeProgressPoll({
  key: toolCallId,
  sessionId: String(toolArgs.session_id),
  apiBase,
  apiToken,
  onSnapshot: (snap) => {
    updatePaneToolMessageForSession(toolCallId, {
      toolStatus: "running",
      content: formatWbBridgeLiveSnapshot(snap),
    });
  },
});
```

4. 处理 `tool_result` / `tool_error` / abort / pane unmount：`stopWbBridgeProgressPoll(toolCallId)`。在现有 `payload.type === "tool_result"`（同文件 SSE 循环内，搜 `tool_result`）对 `name === "wb_bridge_send"` 加一行 stop。组件 `useEffect` cleanup 对 map 内全部 key stop。

`ChatView.tsx` L223：无需 poll；`formatWbBridgeSendToolResult` 的 success 工具链会自动变好。

---

## 5. AC

- **AC-B1** `pytest` 不必覆盖代理。用一段最小脚本或 `tests/studio/` 若已有 wb 测试则追加；否则在 `tests/test_smoke_wb_bridge.py` **不要** import `server.py` 全应用（太重）。代理用 Desktop vitest mock fetch 即可。`server.py` 改完后强制：

```
python -c "from agenticx.studio.server import create_studio_app; create_studio_app()"
```

并对临时端口 `GET /api/session` `/api/avatars` `/api/sessions` 断言 200（与 AGENTS.md 一致）。

- **AC-B2** `formatWbBridgeSendToolResult` success + `observed_tools:["Write"]` 含 `Write`，**不含**「重试前请先核验」。
- **AC-B3** `formatWbBridgeLiveSnapshot` 含 `当前 Write`、`已执行 Write`、`写入 1 个文件`（`written_paths:["/tmp/a.txt"]`）。
- **AC-B4** poll helper：start 后立刻 1 次 fetch；`advanceTimersByTime(2000)` 再 1 次；stop 后再 advance 不再 fetch。
- **AC-B5** `npx vitest run src/utils/wb-bridge-ui.test.ts src/utils/wb-bridge-progress.test.ts`（在 `desktop/`）。
- **AC-B6** `git diff --name-only`：允许 `server.py`、`wb-bridge-ui.ts`、`wb-bridge-ui.test.ts`、`wb-bridge-progress.ts`、`wb-bridge-progress.test.ts`、`ChatPane.tsx`（及本 plan）。`ChatPane.tsx` diff 不得改附件上传、群聊路由、KB 检索。不得出现 `cc_bridge/**`、`agent_runtime.py`。

---

## 6. 实施顺序

1. vitest：success 也展示 tools（先改测试再改 `observedToolsLine`）。
2. `formatWbBridgeLiveSnapshot` + 测试。
3. `wb-bridge-progress.ts` TDD。
4. **精确插入** server 路由 → smoke `create_studio_app`。
5. ChatPane 四点接线 → 人工：发 `wb_bridge_send` 后 2s 内工具卡出现「当前 Write」而不只是秒数。

## 7. 提交

`feat(desktop): show live delegated-session progress on the tool card`

禁止 commit 里写第三方产品名。
