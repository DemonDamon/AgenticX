# Mobile Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机端第二批功能升级——新建任务入口（懒创建）、AI 回复 Markdown 渲染、工具调用完成态结构化分组展示、技能/插件只读卡。

**Architecture:** 网关新增 3 个薄转发（RPC 层 + REST 层，复用 FakeDesktop 测试模式）；手机端消息归一化升级为 `buildChatEntries` 纯函数（tool 消息分组、reasoning 提取、老消息容错），UI 层按 kind 分发渲染。懒创建 = new-task 页 `createSession` 成功后 `router.replace` 到会话页并传 `initialText` 自动发送。

**Tech Stack:** FastAPI + httpx（网关）；Expo 57 / RN 0.86 / expo-router（手机端）；react-native-markdown-display（Markdown）；vitest（手机端纯函数测试）；pytest（网关测试）。

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-batch2-design.md`

**环境备忘：**
- pytest 命令必须用 `python3 -m pytest tests/test_gateway_mobile_api.py -o addopts=""`（.venv 无 pytest，去 cov 插件参数）
- tsc：`cd mobile && npx tsc --noEmit`
- vitest：`cd mobile && npx vitest run`
- Metro 已在 8788 端口后台运行（job-f012902c…），模拟器 emulator-5554（逻辑分辨率 320×640，tap 前必须 uiautomator dump）

---

## File Structure

```
agenticx/gateway/client.py          # 改：_dispatch_device_rpc + 3 个 _rpc_* 方法
agenticx/gateway/app.py             # 改：3 个 /api/mobile/* REST 端点
tests/test_gateway_mobile_api.py    # 改：新端点契约测试
mobile/src/api/types.ts             # 改：MobileMessage 显式 tool 字段 + 3 个新响应类型
mobile/src/api/client.ts            # 改：createSession / getToolsRegistry / getMcpServers
mobile/src/lib/messages.ts          # 新：buildChatEntries 纯函数（分组/容错）
mobile/src/lib/messages.test.ts     # 新：vitest 纯函数测试
mobile/src/components/AssistantMarkdown.tsx  # 新：品牌主题 Markdown
mobile/src/components/ToolGroupCard.tsx      # 新：工具分组折叠卡
mobile/src/components/ReasoningBlock.tsx     # 新：思考过程折叠块
mobile/src/components/CapabilityCard.tsx     # 新：技能/MCP 只读卡
mobile/app/sessions/[id].tsx        # 改：buildChatEntries 接入 + 渲染分发 + initialText 自动发送
mobile/app/sessions.tsx             # 改：header 右上「+」按钮
mobile/app/new-task.tsx             # 新：新建任务页（懒创建）
```

---

### Task 1: 网关 RPC 层——sessions.create / tools.registry / mcp.servers

**Files:**
- Modify: `agenticx/gateway/client.py:521-532`（_dispatch_device_rpc）及其后追加 3 个 _rpc_ 方法
- Test: `tests/test_gateway_mobile_api.py`

- [ ] **Step 1: 写失败测试**（追加到 test_gateway_mobile_api.py 末尾，FakeDesktop 模式）

```python
# --------------------------------------------------------------------------
# batch2：sessions.create / tools.registry / mcp.servers
# --------------------------------------------------------------------------


async def test_session_create_roundtrip(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])
    desktop = await gateway.start_desktop()

    desktop.replies["sessions.create"] = {
        "ok": True,
        "data": {"ok": True, "session_id": "s-new", "session_name": None, "created_at": 1.0},
    }
    r = await http.post("/api/mobile/sessions", json={}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["session_id"] == "s-new"
    frame = desktop.received[-1]
    assert frame["method"] == "sessions.create"
    assert frame["params"] == {}


async def test_session_create_rpc_error_502(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])
    await gateway.start_desktop()
    desktop = gateway.desktop
    assert desktop is not None
    desktop.replies["sessions.create"] = {"ok": False, "error": "studio down"}
    r = await http.post("/api/mobile/sessions", json={}, headers=h)
    assert r.status_code == 502
    assert r.json()["detail"] == "studio down"


async def test_tools_registry_and_mcp_servers_roundtrip(
    gateway: _Gateway, http: httpx.AsyncClient
) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])
    desktop = await gateway.start_desktop()

    desktop.replies["tools.registry"] = {
        "ok": True,
        "data": [{"name": "bash_exec", "description": "run shell", "category": "system", "is_meta": False}],
    }
    r = await http.get("/api/mobile/tools", headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "tools": [{"name": "bash_exec", "description": "run shell", "category": "system", "is_meta": False}]
    }
    assert desktop.received[-1]["method"] == "tools.registry"

    desktop.replies["mcp.servers"] = {
        "ok": True,
        "data": [{"name": "m1", "connected": True, "connection_state": "healthy", "tool_count": 2}],
    }
    r = await http.get("/api/mobile/mcp", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["servers"][0]["name"] == "m1"
    assert desktop.received[-1]["method"] == "mcp.servers"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/test_gateway_mobile_api.py -o addopts="" -k "session_create or tools_registry" -v`
Expected: FAIL（404 Not Found——端点不存在）

- [ ] **Step 3: 实现 RPC 分发（client.py）**

`_dispatch_device_rpc`（client.py:521）追加三个分支：

```python
        if method == "sessions.create":
            return await self._rpc_sessions_create(params)
        if method == "tools.registry":
            return await self._rpc_tools_registry()
        if method == "mcp.servers":
            return await self._rpc_mcp_servers(params)
```

类中追加三个方法（放在 `_rpc_sessions_list` 之后，复用同一 httpx 模式）：

```python
    async def _rpc_sessions_create(self, params: Dict[str, Any]) -> Any:
        body = params if isinstance(params, dict) else {}
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"{self._settings.studio_base_url}/api/sessions",
                headers=headers,
                json=body,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"session create failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
            if not isinstance(payload, dict) or not str(payload.get("session_id") or "").strip():
                raise RuntimeError("session create reply missing 'session_id'")
            return payload

    async def _rpc_tools_registry(self) -> Any:
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/tools/registry",
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"tools registry failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
            rows = payload.get("tools") if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                raise RuntimeError("tools registry reply missing 'tools' array")
            return rows

    async def _rpc_mcp_servers(self, params: Dict[str, Any]) -> Any:
        session_id = str(params.get("session_id") or "").strip()
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/mcp/servers",
                params={"session_id": session_id} if session_id else None,
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"mcp servers failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
            rows = payload.get("servers") if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                raise RuntimeError("mcp servers reply missing 'servers' array")
            return rows
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest tests/test_gateway_mobile_api.py -o addopts="" -k "session_create or tools_registry" -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add agenticx/gateway/client.py tests/test_gateway_mobile_api.py
git commit -m "feat(gateway): 设备 RPC 新增 sessions.create / tools.registry / mcp.servers 转发"
```

---

### Task 2: 网关 REST 层——3 个 /api/mobile/* 端点

**Files:**
- Modify: `agenticx/gateway/app.py:490-548`（mobile 端点区域追加）
- Test: `tests/test_gateway_mobile_api.py`（Task 1 的测试已覆盖本任务，无需新测试——REST 端点即被测对象）

- [ ] **Step 1: 实现端点（app.py，插在 api_mobile_sessions 之前）**

```python
    @app.post("/api/mobile/sessions")
    async def api_mobile_session_create(request: Request) -> JSONResponse:
        did = _require_mobile_auth(request)
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="invalid body")
        reply = await _bridge_device_rpc(did, "sessions.create", body)
        if not reply.get("ok"):
            raise HTTPException(status_code=502, detail=str(reply.get("error") or "rpc failed"))
        return JSONResponse(reply.get("data"))

    @app.get("/api/mobile/tools")
    async def api_mobile_tools(request: Request) -> JSONResponse:
        did = _require_mobile_auth(request)
        reply = await _bridge_device_rpc(did, "tools.registry", {})
        if not reply.get("ok"):
            raise HTTPException(status_code=502, detail=str(reply.get("error") or "rpc failed"))
        return JSONResponse({"tools": reply.get("data")})

    @app.get("/api/mobile/mcp")
    async def api_mobile_mcp(request: Request) -> JSONResponse:
        did = _require_mobile_auth(request)
        reply = await _bridge_device_rpc(did, "mcp.servers", {})
        if not reply.get("ok"):
            raise HTTPException(status_code=502, detail=str(reply.get("error") or "rpc failed"))
        return JSONResponse({"servers": reply.get("data")})
```

- [ ] **Step 2: 全量跑网关 mobile API 测试**

Run: `python3 -m pytest tests/test_gateway_mobile_api.py -o addopts="" -v`
Expected: 全部 passed（原有用例 + 新增 3 例）

- [ ] **Step 3: Commit**

```bash
git add agenticx/gateway/app.py
git commit -m "feat(gateway): mobile REST 新增会话创建/工具注册表/MCP 列表端点"
```

---

### Task 3: 手机端 types + client 扩展 + vitest 环境

**Files:**
- Modify: `mobile/src/api/types.ts`、`mobile/src/api/client.ts`、`mobile/package.json`（devDep vitest）
- Create: `mobile/src/lib/messages.ts`、`mobile/src/lib/messages.test.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd mobile && npm install react-native-markdown-display && npm install -D vitest
```

- [ ] **Step 2: types.ts 扩展**

`MobileMessage` 替换为：

```ts
export interface MobileMessage {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  ts?: number;
  /** batch2：tool 消息结构化字段（老消息缺省 → 纯文本回退） */
  tool_call_id?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_status?: "done" | "error" | string;
  /** batch2：assistant 思考过程 */
  reasoning?: string;
  [key: string]: unknown;
}
```

文件末尾追加：

```ts
export interface CreateSessionResponse {
  ok: boolean;
  session_id: string;
  session_name: string | null;
  [key: string]: unknown;
}

export interface ToolRegistryItem {
  name: string;
  description: string;
  category: string;
  is_meta: boolean;
  [key: string]: unknown;
}

export interface McpServerInfo {
  name: string;
  connected: boolean;
  connection_state: string;
  tool_count: number;
  [key: string]: unknown;
}

export interface ToolsResponse {
  tools: ToolRegistryItem[];
}

export interface McpServersResponse {
  servers: McpServerInfo[];
}
```

- [ ] **Step 3: client.ts 新增方法（加在 unbind 之后）**

imports 补充：`CreateSessionResponse, McpServersResponse, ToolsResponse`。

```ts
  async createSession(body: Record<string, unknown> = {}): Promise<CreateSessionResponse> {
    return await this.request<CreateSessionResponse>("POST", "/api/mobile/sessions", body);
  }

  async getToolsRegistry(): Promise<ToolsResponse> {
    return await this.request<ToolsResponse>("GET", "/api/mobile/tools");
  }

  async getMcpServers(): Promise<McpServersResponse> {
    return await this.request<McpServersResponse>("GET", "/api/mobile/mcp");
  }
```

- [ ] **Step 4: package.json 加 test 脚本**

`"scripts"` 内加：`"test": "vitest run"`

- [ ] **Step 5: 写失败测试 mobile/src/lib/messages.test.ts**

```ts
import { describe, expect, it } from "vitest";
import type { MobileMessage } from "../api/types";
import { buildChatEntries } from "./messages";

function toolMsg(over: Partial<MobileMessage>): MobileMessage {
  return {
    role: "tool",
    text: "",
    tool_name: "bash_exec",
    tool_status: "done",
    tool_args: { command: "ls -la" },
    content: "file1\nfile2",
    ...over,
  } as MobileMessage;
}

describe("buildChatEntries", () => {
  it("连续 tool 消息归入一个 toolGroup", () => {
    const entries = buildChatEntries([
      { role: "user", text: "hi" },
      toolMsg({}),
      toolMsg({ tool_args: { command: "pwd" } }),
      { role: "assistant", text: "done" },
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["user", "toolGroup", "assistant"]);
    const g = entries[1];
    expect(g.kind === "toolGroup" && g.steps).toHaveLength(2);
  });

  it("toolGroup 被 user/assistant/system 消息打断", () => {
    const entries = buildChatEntries([
      toolMsg({}),
      { role: "assistant", text: "a" },
      toolMsg({}),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["toolGroup", "assistant", "toolGroup"]);
  });

  it("assistant 携带 reasoning", () => {
    const entries = buildChatEntries([
      { role: "assistant", text: "ok", reasoning: "先看看目录" },
    ]);
    const a = entries[0];
    expect(a.kind === "assistant" && a.reasoning).toBe("先看看目录");
  });

  it("bash_exec 提取 command，其它工具取参数 JSON", () => {
    const entries = buildChatEntries([
      toolMsg({}),
      toolMsg({ tool_name: "file_read", tool_args: { path: "/tmp/a" }, content: "" }),
    ]);
    const g = entries[0];
    if (g.kind !== "toolGroup") throw new Error("not group");
    expect(g.steps[0].detail).toBe("ls -la");
    expect(g.steps[1].detail).toContain("/tmp/a");
  });

  it("error 状态与结果预览截断", () => {
    const entries = buildChatEntries([
      toolMsg({ tool_status: "error", content: "x".repeat(200) }),
    ]);
    const g = entries[0];
    if (g.kind !== "toolGroup") throw new Error("not group");
    expect(g.steps[0].status).toBe("error");
    expect(g.steps[0].resultPreview).toHaveLength(120);
  });

  it("老消息（无 tool 字段）按纯文本回退不崩溃", () => {
    const entries = buildChatEntries([
      { role: "user", text: "u" },
      { role: "assistant", text: "a" },
      { role: "system", text: "s" },
      toolMsg({ tool_name: undefined, tool_args: undefined, content: undefined }),
    ]);
    expect(entries).toHaveLength(4);
    const g = entries[3];
    if (g.kind !== "toolGroup") throw new Error("not group");
    expect(g.steps[0].toolName).toBe("tool");
    expect(g.steps[0].detail).toBe("");
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `cd mobile && npx vitest run`
Expected: FAIL（buildChatEntries 未定义）

- [ ] **Step 7: 实现 mobile/src/lib/messages.ts**

```ts
import type { MobileMessage } from "../api/types";

/** 工具分组卡里的单步 */
export interface ToolStep {
  toolName: string;
  status: "done" | "error" | "unknown";
  /** bash_exec → command；其它工具 → 参数 JSON 摘要 */
  detail: string;
  /** 结果 content 单行截断预览 */
  resultPreview: string;
}

/** 消息流渲染条目（inverted FlatList 的 data 源） */
export type ChatEntry =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string; reasoning?: string }
  | { kind: "system"; key: string; text: string }
  | { kind: "toolGroup"; key: string; steps: ToolStep[] };

const RESULT_PREVIEW_MAX = 120;

function readText(m: MobileMessage): string {
  const raw = typeof m.text === "string" ? m.text : m.content;
  return typeof raw === "string" ? raw : "";
}

function readToolName(m: MobileMessage): string {
  const raw = m.tool_name ?? m.name;
  return typeof raw === "string" && raw.trim() !== "" ? raw : "tool";
}

function readToolStatus(m: MobileMessage): ToolStep["status"] {
  if (m.tool_status === "done") return "done";
  if (m.tool_status === "error") return "error";
  return "unknown";
}

function toolDetail(m: MobileMessage): string {
  const args = m.tool_args;
  if (args !== null && typeof args === "object") {
    const cmd = (args as Record<string, unknown>).command;
    if (typeof cmd === "string" && cmd.trim() !== "") return cmd.trim();
    try {
      return JSON.stringify(args).slice(0, RESULT_PREVIEW_MAX);
    } catch {
      return "";
    }
  }
  return "";
}

function resultPreview(m: MobileMessage): string {
  const raw = typeof m.content === "string" ? m.content : "";
  return raw.replace(/\s+/g, " ").trim().slice(0, RESULT_PREVIEW_MAX);
}

/**
 * 后端消息线 → 手机端渲染条目：
 * - 连续 tool 消息归入一个 toolGroup（遇 user/assistant/system 断组）
 * - assistant 携带 reasoning 供「思考过程」折叠块
 * - 老消息（无 tool 字段）按纯文本回退
 */
export function buildChatEntries(messages: MobileMessage[]): ChatEntry[] {
  const entries: ChatEntry[] = [];
  let group: ToolStep[] | null = null;

  const flush = () => {
    if (group !== null && group.length > 0) {
      entries.push({ kind: "toolGroup", key: `tg-${entries.length}`, steps: group });
    }
    group = null;
  };

  messages.forEach((m, i) => {
    if (m.role === "tool") {
      if (group === null) group = [];
      group.push({
        toolName: readToolName(m),
        status: readToolStatus(m),
        detail: toolDetail(m),
        resultPreview: resultPreview(m),
      });
      return;
    }
    flush();
    const text = readText(m);
    const key = `${i}-${m.role}-${m.ts ?? "nots"}`;
    if (m.role === "user") {
      entries.push({ kind: "user", key, text });
    } else if (m.role === "assistant") {
      const reasoning =
        typeof m.reasoning === "string" && m.reasoning.trim() !== ""
          ? m.reasoning.trim()
          : undefined;
      entries.push({ kind: "assistant", key, text, reasoning });
    } else {
      entries.push({ kind: "system", key, text });
    }
  });
  flush();
  return entries;
}
```

- [ ] **Step 8: 跑测试确认通过**

Run: `cd mobile && npx vitest run`
Expected: 6 passed

- [ ] **Step 9: Commit**

```bash
git add mobile/src/api/types.ts mobile/src/api/client.ts mobile/src/lib/messages.ts mobile/src/lib/messages.test.ts mobile/package.json mobile/package-lock.json
git commit -m "feat(mobile): 消息结构化归一化纯函数 + 会话创建/技能/MCP client"
```

---

### Task 4: 渲染组件——AssistantMarkdown / ToolGroupCard / ReasoningBlock

**Files:**
- Create: `mobile/src/components/AssistantMarkdown.tsx`、`mobile/src/components/ToolGroupCard.tsx`、`mobile/src/components/ReasoningBlock.tsx`

- [ ] **Step 1: AssistantMarkdown.tsx**

```tsx
import Markdown from "react-native-markdown-display";
import { StyleSheet } from "react-native";
import { brand, color, fontSize, radius, spacing } from "../ui/theme";

/** AI 回复 Markdown 主题：代码块暖色深底，链接/列表点用品牌橙 */
const mdStyles = StyleSheet.create({
  body: { color: color.textPrimary, fontSize: fontSize.bodyLg, lineHeight: 22 },
  strong: { color: color.textPrimary },
  em: { color: color.textPrimary },
  link: { color: brand.primary },
  heading1: {
    color: color.textPrimary,
    fontSize: fontSize.title,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  heading2: {
    color: color.textPrimary,
    fontSize: fontSize.bodyLg + 2,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  heading3: {
    color: color.textPrimary,
    fontSize: fontSize.bodyLg,
    fontWeight: "600",
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  bullet_list_icon: { color: brand.primary },
  ordered_list_icon: { color: brand.primary },
  code_inline: {
    backgroundColor: brand.creamDeep,
    color: brand.primaryDark,
    fontFamily: "Menlo",
    fontSize: fontSize.body - 1,
  },
  fence: {
    backgroundColor: "#2B2620",
    borderRadius: radius.sm + 2,
    padding: spacing.sm + 2,
    borderWidth: 0,
    marginVertical: spacing.xs,
  },
  fence_text: {
    color: "#F5EFE6",
    fontFamily: "Menlo",
    fontSize: fontSize.caption + 1,
    lineHeight: 18,
  },
  blockquote: {
    backgroundColor: brand.cream,
    borderLeftWidth: 3,
    borderLeftColor: brand.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginVertical: spacing.xs,
  },
  hr: { backgroundColor: color.border },
});

/** AI 回复 Markdown 渲染（用户气泡保持纯文本，勿用于 user role） */
export function AssistantMarkdown({ text }: { text: string }) {
  return <Markdown style={mdStyles}>{text}</Markdown>;
}
```

- [ ] **Step 2: ReasoningBlock.tsx**

```tsx
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { brand, color, fontSize, fontWeight, radius, spacing } from "../ui/theme";

/** 「思考过程」折叠块：assistant 气泡上方，有 reasoning 才渲染 */
export function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.toggle}
        onPress={() => {
          setOpen(!open);
        }}
      >
        <Text style={styles.toggleText}>{open ? "收起思考过程" : "思考过程"}</Text>
        <Text style={styles.chevron}>{open ? "⌄" : "›"}</Text>
      </Pressable>
      {open ? <Text style={styles.body}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: brand.cream,
    borderRadius: radius.sm + 2,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    alignSelf: "stretch",
  },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  toggleText: { fontSize: fontSize.caption, color: brand.primaryDark, fontWeight: fontWeight.medium },
  chevron: { fontSize: fontSize.caption, color: brand.primaryDark },
  body: {
    fontSize: fontSize.caption,
    color: color.textSecondary,
    lineHeight: 18,
    marginTop: spacing.xs,
    fontFamily: "Menlo",
  },
});
```

- [ ] **Step 3: ToolGroupCard.tsx**

```tsx
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ToolStep } from "../lib/messages";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../ui/theme";

/** 工具调用分组折叠卡（方案 1 完成态）：收起「执行 N 个步骤 ›」，展开逐条明细 */
export function ToolGroupCard({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  const errCount = steps.filter((s) => s.status === "error").length;

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.header}
        onPress={() => {
          setOpen(!open);
        }}
      >
        <Text style={styles.headerText}>执行 {steps.length} 个步骤</Text>
        {errCount > 0 ? <Text style={styles.errBadge}>{errCount} 失败</Text> : null}
        <Text style={styles.chevron}>{open ? "⌄" : "›"}</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {steps.map((s, i) => (
            <View key={`${i}-${s.toolName}`} style={styles.step}>
              <Text style={[styles.statusIcon, s.status === "error" ? styles.statusError : null]}>
                {s.status === "error" ? "✕" : "✓"}
              </Text>
              <View style={styles.stepBody}>
                <Text style={styles.toolName}>{s.toolName}</Text>
                {s.detail !== "" ? (
                  <Text style={styles.detail} numberOfLines={6}>
                    {s.detail}
                  </Text>
                ) : null}
                {s.resultPreview !== "" ? (
                  <Text style={styles.preview} numberOfLines={2}>
                    {s.resultPreview}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: color.card,
    borderRadius: radius.md + 2,
    borderWidth: 1,
    borderColor: color.border,
    alignSelf: "stretch",
    marginVertical: spacing.xs,
    ...shadow.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  headerText: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: color.textPrimary, flexShrink: 1 },
  errBadge: {
    fontSize: fontSize.caption,
    color: color.danger,
    backgroundColor: color.dangerBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
    overflow: "hidden",
  },
  chevron: { fontSize: fontSize.body, color: brand.primary, marginLeft: "auto" },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
    padding: spacing.md,
    gap: spacing.sm + 2,
  },
  step: { flexDirection: "row", gap: spacing.sm },
  statusIcon: { fontSize: fontSize.body, color: color.online, marginTop: 1 },
  statusError: { color: color.danger },
  stepBody: { flexShrink: 1, flex: 1, gap: 2 },
  toolName: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, color: brand.primaryDark },
  detail: {
    fontSize: fontSize.caption,
    color: color.textPrimary,
    fontFamily: "Menlo",
    backgroundColor: brand.cream,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: spacing.xs,
  },
  preview: { fontSize: fontSize.caption, color: color.textMuted, lineHeight: 16 },
});
```

- [ ] **Step 4: tsc 验证**

Run: `cd mobile && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/AssistantMarkdown.tsx mobile/src/components/ToolGroupCard.tsx mobile/src/components/ReasoningBlock.tsx
git commit -m "feat(mobile): Markdown 渲染/工具分组卡/思考折叠组件"
```

---

### Task 5: 会话页接入——结构化渲染 + 发送刷新 + initialText 自动发送

**Files:**
- Modify: `mobile/app/sessions/[id].tsx`

- [ ] **Step 1: 改造 ChatEntry 与渲染分发**

文件顶部 imports 增加：

```tsx
import { ToolGroupCard } from "../../src/components/ToolGroupCard";
import { ReasoningBlock } from "../../src/components/ReasoningBlock";
import { AssistantMarkdown } from "../../src/components/AssistantMarkdown";
import { buildChatEntries, type ChatEntry } from "../../src/lib/messages";
```

删除本地 `interface ChatEntry`（改用 lib 导出版）与 `readText` 函数；`ChatEntry` 增加 pending 变体——在 lib/messages.ts 的 `ChatEntry` union 追加：

```ts
  | { kind: "pending"; key: string }
```

（pending 是本地乐观占位，不进 buildChatEntries，仅页面内使用。）

`MessageBubble` 整体替换为分发渲染：

```tsx
function PendingBubble() {
  return (
    <View style={[styles.bubble, styles.bubbleAssistant]}>
      <View style={styles.pendingRow}>
        <ActivityIndicator size="small" color={brand.primary} />
        <Text style={styles.pendingText}>正在执行…</Text>
      </View>
    </View>
  );
}

function AssistantBlock({ text, reasoning }: { text: string; reasoning?: string }) {
  return (
    <View style={styles.bubbleColumn}>
      {reasoning !== undefined ? (
        <View style={styles.reasoningWrap}>
          <ReasoningBlock text={reasoning} />
        </View>
      ) : null}
      <View style={[styles.bubble, styles.bubbleAssistant]}>
        {text.trim() === "" ? (
          <Text style={styles.bubbleAssistantText}>（无文本回复）</Text>
        ) : (
          <AssistantMarkdown text={text} />
        )}
      </View>
    </View>
  );
}

function MessageItem({ entry }: { entry: ChatEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <View style={styles.bubbleColumnUser}>
          <View style={[styles.bubble, styles.bubbleUser]}>
            <Text style={styles.bubbleUserText}>{entry.text}</Text>
          </View>
        </View>
      );
    case "assistant":
      return <AssistantBlock text={entry.text} reasoning={entry.reasoning} />;
    case "system":
      return (
        <View style={styles.systemWrap}>
          <Text style={styles.systemText}>{entry.text}</Text>
        </View>
      );
    case "toolGroup":
      return (
        <View style={styles.toolGroupWrap}>
          <ToolGroupCard steps={entry.steps} />
        </View>
      );
    case "pending":
      return <PendingBubble />;
  }
}
```

styles 增补：

```ts
  reasoningWrap: { alignSelf: "stretch", maxWidth: "84%", marginBottom: spacing.xs },
  toolGroupWrap: { maxWidth: "92%" },
```

- [ ] **Step 2: fetchMessages / handleSend 改造**

`fetchMessages` 替换：

```tsx
  const fetchMessages = useCallback(async () => {
    if (client === null) return;
    const resp = await client.getMessages(id);
    setEntries(buildChatEntries(resp.messages));
  }, [client, id]);
```

`handleSend` 替换（支持 initialText 覆写；成功后拉结构化消息，失败回退纯文本）：

```tsx
  const handleSend = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim();
      if (text === "" || sending || client === null) return;
      setSending(true);
      const pendingKey = `local-pending-${Date.now()}`;
      setEntries((prev) => [...(prev ?? []), { kind: "pending", key: pendingKey }]);
      try {
        const resp = await client.sendMessage(id, { text, sender_name: "Near 手机" });
        setDraft("");
        if (resp.pending_confirm !== null) {
          notifyConfirmsChanged();
        }
        // 完成态结构化：从后端拉真实消息线（tool 分组 + reasoning + Markdown）
        try {
          await fetchMessages();
        } catch {
          setEntries((prev) => [
            ...(prev ?? []).filter((e) => e.key !== pendingKey),
            { kind: "assistant", key: `local-reply-${Date.now()}`, text: resp.reply },
          ]);
        }
      } catch (err) {
        setEntries((prev) => (prev ?? []).filter((e) => e.key !== pendingKey));
        if (!(err instanceof ApiError && err.status === 401)) {
          showToast(`发送失败：${describeError(err)}`);
        }
      } finally {
        setSending(false);
      }
    },
    [draft, sending, client, id, showToast, fetchMessages],
  );
```

FlatList 的 renderItem 改为 `<MessageItem entry={item} />`；`keyExtractor` 保持。

- [ ] **Step 3: initialText 自动发送（懒创建链路收口）**

`useLocalSearchParams` 增加 `initialText`，组件内加：

```tsx
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (
      typeof initialText === "string" &&
      initialText.trim() !== "" &&
      !autoSentRef.current &&
      client !== null
    ) {
      autoSentRef.current = true;
      void handleSend(initialText.trim());
    }
  }, [initialText, client, handleSend]);
```

- [ ] **Step 4: tsc + vitest 回归**

Run: `cd mobile && npx tsc --noEmit && npx vitest run`
Expected: 均通过

- [ ] **Step 5: Commit**

```bash
git add mobile/app/sessions/[id].tsx mobile/src/lib/messages.ts
git commit -m "feat(mobile): 会话页结构化时间线渲染（Markdown+工具分组+思考折叠）+ 懒创建自动发送"
```

---

### Task 6: 会话列表「+」按钮 + new-task 页

**Files:**
- Modify: `mobile/app/sessions.tsx`
- Create: `mobile/app/new-task.tsx`

- [ ] **Step 1: sessions.tsx header 右上「+」**

imports 增加 `import { Stack } from "expo-router";`；组件 return 的 `<View style={styles.page}>` 首行加：

```tsx
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              style={({ pressed }) => [styles.plusButton, pressed && styles.plusPressed]}
              onPress={() => {
                router.push("/new-task");
              }}
            >
              <Text style={styles.plusText}>＋</Text>
            </Pressable>
          ),
        }}
      />
```

styles 增补：

```ts
  plusButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: brand.creamDeep,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  plusPressed: { backgroundColor: brand.primaryLight },
  plusText: { fontSize: 20, lineHeight: 24, color: brand.primaryDark, fontWeight: fontWeight.bold },
```

（Pressable 已在 imports 中。）

- [ ] **Step 2: new-task.tsx**

```tsx
import { Stack, router } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGateway } from "../src/hooks/useGateway";
import { describeError } from "../src/lib/errors";
import { CapabilityCard } from "../src/components/CapabilityCard";
import { BrandMark } from "../src/ui/BrandMark";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../src/ui/theme";

/**
 * 新建任务页（懒创建）：
 * - 进入不创建会话；首条消息发出时 createSession → replace 到会话页并带 initialText 自动发送
 * - 放弃不产生垃圾会话；创建失败保留输入 + toast
 */
export default function NewTaskScreen() {
  const insets = useSafeAreaInsets();
  const { client } = useGateway();
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleStart = useCallback(async () => {
    const text = draft.trim();
    if (text === "" || creating || client === null) return;
    setCreating(true);
    try {
      const resp = await client.createSession({});
      const sessionId = resp.session_id;
      router.replace({
        pathname: "/sessions/[id]",
        params: { id: sessionId, title: text.slice(0, 20), initialText: text },
      });
    } catch (err) {
      setToast(`创建任务失败：${describeError(err)}`);
      setCreating(false);
      setTimeout(() => {
        setToast(null);
      }, 2_500);
    }
  }, [draft, creating, client]);

  const canSend = creating || draft.trim() === "";

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: "新建任务" }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.hero}>
          <BrandMark size={56} plated />
          <Text style={styles.heroTitle}>新建任务</Text>
          <Text style={styles.heroSub}>Near, Always Near.</Text>
        </View>

        <View style={styles.inputCard}>
          <TextInput
            style={styles.input}
            multiline
            autoFocus
            placeholder="想让 Near 做什么？"
            placeholderTextColor={color.textMuted}
            value={draft}
            onChangeText={setDraft}
            editable={!creating}
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendButton,
              canSend ? styles.sendDisabled : null,
              pressed && !canSend ? styles.sendPressed : null,
            ]}
            disabled={canSend}
            onPress={() => {
              void handleStart();
            }}
          >
            {creating ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.sendButtonText}>开始</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.capabilityWrap}>
          <CapabilityCard client={client} />
        </View>
      </KeyboardAvoidingView>

      {toast !== null ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
      {/* insets.bottom 保底：内容区避开手势条 */}
      <View style={{ height: Math.max(insets.bottom, 8) }} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  hero: { alignItems: "center", paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  heroTitle: { fontSize: fontSize.titleLg ?? fontSize.title, fontWeight: fontWeight.bold, color: color.textPrimary, marginTop: spacing.sm },
  heroSub: { fontSize: fontSize.caption, color: color.textMuted, letterSpacing: 1 },
  inputCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.md,
    gap: spacing.md,
    ...shadow.card,
  },
  input: {
    minHeight: 96,
    maxHeight: 180,
    fontSize: fontSize.bodyLg,
    color: color.textPrimary,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  sendButton: {
    backgroundColor: brand.primary,
    borderRadius: radius.pill,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sendPressed: { backgroundColor: brand.primaryPressed },
  sendDisabled: { opacity: 0.4 },
  sendButtonText: { color: "#FFFFFF", fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
  capabilityWrap: { marginTop: spacing.lg, paddingHorizontal: spacing.lg, flex: 1 },
  toast: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    backgroundColor: "rgba(43, 38, 32, 0.92)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    maxWidth: "82%",
  },
  toastText: { color: "#FFFFFF", fontSize: fontSize.body },
});
```

注意：`fontSize.titleLg` 若 theme 中不存在则直接用 `fontSize.title`（实现时以 theme.ts 实际 token 为准，勿发明不存在的 token）。

- [ ] **Step 3: tsc 验证**

Run: `cd mobile && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add mobile/app/sessions.tsx mobile/app/new-task.tsx
git commit -m "feat(mobile): 会话列表新建任务入口 + new-task 懒创建页"
```

---

### Task 7: 技能/插件只读卡（CapabilityCard）

**Files:**
- Create: `mobile/src/components/CapabilityCard.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { GatewayClient } from "../api/client";
import type { McpServerInfo, ToolRegistryItem } from "../api/types";
import { brand, color, fontSize, fontWeight, radius, spacing } from "../ui/theme";

const MAX_TOOLS = 6;

/** 「Near 会什么」只读卡：技能（工具注册表）+ MCP 连接状态；失败整体隐藏不阻塞输入 */
export function CapabilityCard({ client }: { client: GatewayClient | null }) {
  const [tools, setTools] = useState<ToolRegistryItem[] | null>(null);
  const [mcps, setMcps] = useState<McpServerInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (client === null) return;
    let alive = true;
    void Promise.all([client.getToolsRegistry(), client.getMcpServers()])
      .then(([t, m]) => {
        if (!alive) return;
        setTools(t.tools);
        setMcps(m.servers);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [client]);

  if (failed || (tools === null && mcps === null)) {
    return tools === null && mcps === null && !failed ? (
      <View style={styles.wrap}>
        <ActivityIndicator size="small" color={brand.primary} />
      </View>
    ) : null;
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Near 会什么</Text>
      {tools !== null ? (
        <View style={styles.section}>
          {tools.slice(0, MAX_TOOLS).map((t) => (
            <View key={t.name} style={styles.toolRow}>
              <Text style={styles.toolName} numberOfLines={1}>
                {t.name}
              </Text>
              <Text style={styles.toolDesc} numberOfLines={1}>
                {t.description}
              </Text>
            </View>
          ))}
          {tools.length > MAX_TOOLS ? (
            <Text style={styles.moreText}>…等 {tools.length} 项能力</Text>
          ) : null}
        </View>
      ) : null}
      {mcps !== null && mcps.length > 0 ? (
        <View style={styles.section}>
          {mcps.map((m) => (
            <View key={m.name} style={styles.mcpRow}>
              <View
                style={[
                  styles.dot,
                  m.connection_state === "healthy" ? styles.dotOk : styles.dotOff,
                ]}
              />
              <Text style={styles.mcpName} numberOfLines={1}>
                {m.name}
              </Text>
              <Text style={styles.mcpCount}>{m.tool_count} 工具</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  section: { gap: spacing.xs + 2 },
  toolRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toolName: {
    fontSize: fontSize.caption,
    color: brand.primaryDark,
    fontWeight: fontWeight.medium,
    fontFamily: "Menlo",
    flexShrink: 0,
  },
  toolDesc: { fontSize: fontSize.caption, color: color.textMuted, flexShrink: 1 },
  moreText: { fontSize: fontSize.caption, color: color.textMuted },
  mcpRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotOk: { backgroundColor: color.online },
  dotOff: { backgroundColor: color.offline },
  mcpName: { fontSize: fontSize.caption, color: color.textSecondary, flexShrink: 1 },
  mcpCount: { fontSize: fontSize.caption, color: color.textMuted, marginLeft: "auto" },
});
```

- [ ] **Step 2: tsc 验证**

Run: `cd mobile && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/CapabilityCard.tsx
git commit -m "feat(mobile): 新建任务页「Near 会什么」只读能力卡"
```

---

### Task 8: 端到端验证（模拟器）

**Files:** 无新改动（验证 + 修缺陷）

- [ ] **Step 1: 全量测试回归**

```bash
python3 -m pytest tests/test_gateway_mobile_api.py tests/test_gateway_device_rpc.py -o addopts="" -v
cd mobile && npx tsc --noEmit && npx vitest run
```
Expected: pytest 全绿、tsc 无错、vitest 全绿

- [ ] **Step 2: 重启网关使新端点生效**

杀掉旧 gateway 进程（job-b7b79047…），重新：
`PATH="/opt/homebrew/share/android-commandlinetools/platform-tools:$PATH" agx gateway -c gateway_config.dev.yaml`（后台，需关沙箱——配置文件含真实 token）

- [ ] **Step 3: 模拟器冒烟**（uiautomator dump 取 bounds 再 tap，分辨率 320×640）

1. 会话列表右上「＋」→ new-task 页（hero + 输入框 + 能力卡）
2. 输入「查看当前目录有哪些文件」→ 开始 → 自动跳会话页 → 乐观气泡 → 回合完成
3. 验证：Markdown 渲染、「执行 N 个步骤」分组卡可展开、bash command 明细、「思考过程」折叠块（若模型输出 reasoning）
4. 返回会话列表，新会话出现在列表中

- [ ] **Step 4: 缺陷修复后重复 Step 1-3；全部通过后提交收尾**

```bash
git add -A && git commit -m "fix(mobile): 端到端联调缺陷修复"（如有）
```

---

## Self-Review 记录

- **Spec coverage:** 网关 3 RPC（Task 1/2）、消息模型+Markdown（Task 3/4/5）、分组卡+reasoning（Task 4/5）、新建任务+懒创建（Task 6）、能力只读卡（Task 7）、测试与端到端（Task 8）——全覆盖。
- **Placeholder:** 无 TBD；theme token 以实际 `mobile/src/ui/theme.ts` 为准（`fontSize.titleLg` 若不存在则用 `title`，已在 Task 6 标注）。
- **类型一致性:** `ChatEntry` 在 Task 5 中需给 lib/messages.ts 的 union 追加 `pending` 变体（已写入步骤）；`ToolStep` 字段名 `toolName/status/detail/resultPreview` 与 ToolGroupCard 用法一致。
