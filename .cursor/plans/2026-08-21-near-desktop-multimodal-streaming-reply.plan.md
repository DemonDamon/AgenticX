# Near Desktop 气泡内联图流式回复

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: 见「子任务 → 推荐模型」表（P0 协议收口用 `gpt-5.6-sol-medium`，ChatPane 流式视觉用 `Cursor Grok 4.6`，工具样板用 `composer-2.5-fast`）
Status: pending
Plan-Id: 2026-08-21-near-desktop-multimodal-streaming-reply

> **For implementer:** 只改本 plan 列出的文件与函数。`agenticx/studio/server.py` 的 import 区禁止整段替换，只能精确增删目标行；本 P0 **不要**给 `server.py` 加静态文件路由。不要 commit，除非用户明确要求。

**Goal:** 单聊 assistant 回复里，文字 token 与图片块按时间顺序交错出现：工具一发起就出骨架占位，工具返回后在原位淡入，点击灯箱看原图；关掉会话再打开仍能内联显示。

**Architecture:** Desktop Pro 吃的是 Studio `RuntimeEvent` SSE（`token` / `tool_call` / `tool_result` / `final`），不是 AG-UI。新增 `EventType.CONTENT_BLOCK = "content_block"`，在 image-producing 工具的 `tool_call` / `tool_result` 两侧各 yield 一次。ChatPane 把块挂在 `__stream__` 叠加消息上（流式期间不走 `updateLastPaneMessage`），`final` 提交时写入 `Message.blocks`。图片用本机绝对路径 + 已有 `pathToFileUrl`，不内联原图到 SSE。

**Tech Stack:** Python 3.10（`agenticx/runtime/events.py`、`agenticx/runtime/agent_runtime.py`、`agenticx/cli/agent_tools.py`、`agenticx/studio/session_manager.py`）+ React/Zustand（`desktop/src/components/ChatPane.tsx`、`desktop/src/store.ts`、新增 `InlineImageBlock.tsx`）+ pytest / vitest。

---

## 规划模型建议

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| Runtime 事件 + agent loop 映射 + `_normalize_messages` 白名单 | `gpt-5.6-sol-medium` | 事件时序 / 历史丢字段，序列敏感 |
| `generate_image` 工具 + fake provider 单测 | `composer-2.5-fast` | 工具 schema + 约定 JSON，样板活 |
| ChatPane `__stream__` 叠加 + `InlineImageBlock` | `Cursor Grok 4.6` | 流式路径易回归，骨架/淡入要视觉判断 |
| Lite `ChatView` / 自动汇报旁路（P1） | `composer-2.5-fast` | 照抄 Pro 事件分支 |

---

## In scope

- 新增 `EventType.CONTENT_BLOCK`（`"content_block"`），wire 为 Studio `SseEvent`，**不**走 AG-UI `CustomEvent`
- 新增 `generate_image` 内置工具；工具结果约定 `{type:"image", path, mime, alt}`
- `Message.blocks?: ContentBlock[]`；`content` 仍由 text 投影，旧读取方不变
- ChatPane Pro 单聊：`content_block` start → `__stream__` 骨架；end → 原位补路径；`final` 提交带 `blocks`
- `InlineImageBlock`：generating 骨架（含已耗时）→ ready 淡入 → 点击 `ZoomableImage`
- `messages.json` 持久化 `blocks`（只存 `path`/`url`/`mime`/`status`/`alt`/`id`/`type`，不存 data URL）
- `_normalize_messages` 白名单放行 `blocks`，否则历史回放会被剥掉
- `generate_image` 工具卡默认折叠（图已内联）
- pytest + vitest 冒烟

## Out of scope / no-scope-creep

- **不改** AG-UI 协议枚举（`agenticx/protocols/agui.py` 的 `EventType`）、不改 `agenticx/server/sse_adapter.py` / `sse_formatter.py`（那是 Workforce 栈，不是 Desktop `/api/chat`）
- **不改** `view_image` / `analyze_image` 语义（它们是**输入方向**：把图喂给模型，不是出图）
- **不改** 用户输入侧多模态（已有 `chat_attachments`）
- **不改** 群聊 bubble 宽度 / `DESIGN.md` locked layout；群聊 `group_token` 路径不接 `content_block`（P2）
- **不做** Desktop 远程后端 / 缩略图管线 / Pillow（Desktop 仍硬绑 `127.0.0.1`；远程是另一份 plan）
- **不加** `GET /api/sessions/{id}/artifacts/{name}`（P0 用 `file://`；避免碰 `server.py` 新路由）
- **不重写** markdown 渲染器；有 `blocks` 时图片是独立 React 节点，不再靠 `![]()`
- **不接** 原生多模态模型输出（模型自己吐 image part），留 P2
- **不改** `enterprise/`、IM 适配器、Focus Mode 语音
- P0 **不改** Lite `ChatView.tsx` 与 `App.tsx` 自动汇报 SSE（P1）

---

## 根因与证据链

### 1. 消息模型只有字符串，图靠后置 hack

`desktop/src/store.ts:218-221`：`Message.content: string`，没有有序 content-blocks。

`desktop/src/components/messages/MessageRenderer.tsx:312-318`：`displayMessage` 用 `collectTurnPreviewImagePaths` + `appendMissingImageMarkdown` 把同轮产物图 **后置追加** 成 markdown。只能出现在回复末尾，不能 mid-stream 占位，也不能带 `status`。

`desktop/src/utils/session-artifacts.ts:546-601`：产物路径是从 `file_write` / `bash_exec` 文本里扫出来的，**扫不到**「工具返回了一张生成图」这种结构。

### 2. Desktop 主聊天吃的是 Studio RuntimeEvent，不是 AG-UI

`agenticx/studio/server.py:339-354` `_runtime_event_to_sse_lines`：把 `RuntimeEvent.type` 原样打成 `SseEvent`。类型在 `agenticx/runtime/events.py:27-52`：`token` / `tool_call` / `tool_result` / `final`……**没有** `TEXT_MESSAGE_CHUNK` / `CUSTOM`。

因此旧稿把 wire 写成 AG-UI `CustomEvent(name="agenticx.block")` 会让 ChatPane **永远收不到**。`_runtime_event_to_sse_lines` 是通用序列化：只要 runtime yield 新 `type`，SSE 会原样出去，**不必改这段函数**（除非要加帧大小 guard）。

### 3. Pro 流式文字不在 store 里累加

`desktop/src/components/ChatPane.tsx:3308-3319`：流式中的 assistant 是合成消息 `id: "__stream__"`，`content` 来自 `streamedAssistantText`。

`ChatPane.tsx:10397-10414`：`payload.type === "token"` 只改本地 `full` + `scheduleStreamTextUpdate`，**不**调用 `updateLastPaneMessage`。

`ChatPane.tsx:11419-11441`：SSE 结束后才 `addPaneMessageIfSessionActive(..., "assistant", full, ...)` 提交。

所以骨架必须先挂在 `__stream__` 上，否则用户在生成中只会看到工具卡 + 文字，看不到「生成图片中」。旧稿按 `updateLastPaneMessage` 设计，对 Pro 主路径是错的。

### 4. 没有出图工具；`view_image` 不能复用做出图

`agenticx/cli/agent_tools.py:2027-2052`：`view_image` 描述是 “Load an image so the model can visually inspect it”。

`_tool_view_image`（同文件 `:6125-6161`）返回的是 `[image loaded: ...]` 文本，并把 data URL 塞进 pending visual attachments。这是**喂给模型看**，不是**给用户看生成结果**。

仓库里没有 `generate_image` / `text_to_image` 工具实现。

### 5. 历史归一化是白名单，新字段默认丢

`agenticx/studio/session_manager.py:2507-2532` `_normalize_messages` 只拷贝固定字段。`blocks` 若不显式写入 `row`，落盘后再读会消失。这是「关窗再开图没了」的第一嫌疑点。

`_text_from_chat_history_item`（`:1435-1439`）已经能从 `[{type:"text", text}]` 抽标题用纯文本——后端并非完全不认识 list content，但 Desktop 消息行仍是扁平 `content: string`。

### 6. 本机出图不需要新 HTTP 静态路由

`desktop/src/utils/session-artifacts.ts:720-729` 已有 `pathToFileUrl`。ChatPane 工作区预览已经在用（`:5530`）。P0 原图用绝对路径 + `file://`，loopback 加载与内联 data URL 观感接近，且避开 `server.py` 新路由。

现有 `GET /api/artifacts`（`server.py:2035-2047`）列的是 session 内存里的代码产物 path→code，**不是**读磁盘图片。

---

## 已拍板决策（原开放问题，实施者不要再问）

1. **出图后端**：P0 做 `generate_image` 工具 + `ImageGenProvider` Protocol。默认读 `~/.agenticx/config.yaml` 的 `image_generation:`（`provider` / `api_key` / `api_base` / `model`）。未配置时工具返回明确错误字符串，**不崩溃**。单测用 fake provider 写一张 1×1 PNG 到临时目录。真实厂商适配器可后补，**不要**在 P0 锁死某一个云厂商 SDK。
2. **工具卡**：`generate_image` 默认折叠；内联图替代展示。用户仍可展开看 prompt。
3. **骨架耗时**：P0 就带「生成图片中… 3s」，用块上的 `startedAt` 本地计时，不另开 SSE。
4. **远程鉴权 / thumbDataUrl**：整段移出本 plan（Desktop 无远程模式）。SSE 帧仍禁止内联原图；P0 不发 `thumbDataUrl`，100KB guard 可只做单元测试里的纯函数，不必改 AG-UI encoder。

---

## 不变量

1. 无 `blocks` 的历史消息渲染与改动前完全一致（仍走 markdown + `appendMissingImageMarkdown`）。
2. 有 `blocks` 时，`appendMissingImageMarkdown` **不再**给该条追加图片（避免双份图）。
3. `content` 永远是 text block 的 `join("")` 投影；导出 / 复制 / 标题仍读 `content`。
4. `content_block` start **不带**任何图片字节；end 只带本机绝对路径（或 `file://`），永不带原图 base64。
5. 用户打断时，仍为 `generating` 的块改为 `cancelled`，已 `ready` 的块保留。
6. 流式期间不 lock scroll-to-bottom（`DESIGN.md` 既有约束）。
7. 图片列宽不宽于 assistant 气泡 baseline。
8. 未知 SSE `type` 必须被 ChatPane 现有 `catch` 忽略；新类型只在显式分支里处理。

---

## 数据契约（写全，禁止按需推断）

### ContentBlock

```ts
type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      id: string;                    // 稳定 id，同一张图 start/end 相同
      status: "generating" | "ready" | "error" | "cancelled";
      path?: string;                 // 本机绝对路径（P0 主字段）
      url?: string;                  // 可选；P0 由 pathToFileUrl(path) 在渲染层派生
      mime?: string;
      alt?: string;
      width?: number;
      height?: number;
      source?: "tool";
      error?: string;
      startedAt?: number;            // epoch ms，仅前端计时，可不落盘
    };
```

### SSE `content_block`

```jsonc
// start：与 tool_call 同时或紧随其后
{
  "type": "content_block",
  "data": {
    "agent_id": "meta",
    "mode": "start",
    "block": {
      "type": "image",
      "id": "img-<tool_call_id>",
      "status": "generating",
      "alt": "<prompt 截断 80 字>",
      "source": "tool"
    }
  }
}

// end：与 tool_result 同时或紧随其后
{
  "type": "content_block",
  "data": {
    "agent_id": "meta",
    "mode": "end",
    "block": {
      "type": "image",
      "id": "img-<tool_call_id>",
      "status": "ready",
      "path": "/Users/me/.agenticx/sessions/<sid>/workspace/generated/img-xxx.png",
      "mime": "image/png",
      "alt": "...",
      "width": 1024,
      "height": 1024,
      "source": "tool"
    }
  }
}
```

失败：`mode=end` 且 `status="error"`，`error` 为短中文原因（如「未配置 image_generation」）。

`id` 必须等于 `img-` + 该次 `tool_call_id`，保证重连 / 重复 end 幂等。

### 工具结果约定

`generate_image` 成功时，工具返回给模型的可见文本可以是短确认（如 `OK: wrote <path>`），同时在 runtime 侧识别结构化结果：

```json
{"type":"image","path":"<abs>","mime":"image/png","alt":"<prompt>","width":1024,"height":1024}
```

识别入口：工具函数返回 JSON 字符串，或返回值里带 `__image_result__` 键。实施时**只选一种**并在测试里写死：优先「返回 JSON 字符串，`json.loads` 后 `type=="image"`」。

---

## FR / AC

### FR-1：Runtime 增加 `content_block` 事件

**落点：** `agenticx/runtime/events.py:27-52`

before：`EventType` 在 `STALL` 处结束。

after：在 `TOKEN` 与 `FINAL` 之间（或枚举末尾）增加：

```python
CONTENT_BLOCK = "content_block"
```

**落点：** `agenticx/runtime/agent_runtime.py` 发出 `TOOL_CALL` / `TOOL_RESULT` 的现有 yield 点（约 `:2490`、`:2566`、`:4401` 一带；以「刚 yield 完 `EventType.TOOL_CALL` / `TOOL_RESULT`」为锚，**不要**改无关 yield）。

意图：当 `tool_name == "generate_image"`（或工具结果 JSON `type=="image"`）时：

1. yield `TOOL_CALL` 之后立刻 yield `CONTENT_BLOCK` start（无 path）。
2. yield `TOOL_RESULT` 之后立刻 yield `CONTENT_BLOCK` end（ready/error）。
3. 用户 interrupt / 工具异常：end + `status=error|cancelled`。

`server.py:_runtime_event_to_sse_lines` **不改**（通用序列化已够用）。

**AC-1**

- 测试：`tests/test_content_block_event.py`
- 用最小 fake runtime 或直接构造 `RuntimeEvent(type="content_block", data={...})`，经 `_runtime_event_to_sse_lines` 得到的 JSON `type == "content_block"`，`data.mode` / `data.block.id` 齐全。
- 断言 start 的 `block` **没有** `path` / `url` / base64。
- 断言 end 的 `path` 是绝对路径字符串，payload 序列化后 `< 8KB`。

### FR-2：`generate_image` 工具

**落点：** `agenticx/cli/agent_tools.py`

- 在 `STUDIO_TOOLS` 列表、`view_image` 条目**之后**插入 `GENERATE_IMAGE_TOOL` schema：

```python
{
    "type": "function",
    "function": {
        "name": "generate_image",
        "description": (
            "Generate an image from a text prompt and save it to the session workspace. "
            "Use when the user asks to draw / generate / 画一张图. "
            "Returns a local file path. Do not invent a URL."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "Image prompt."},
                "size": {
                    "type": "string",
                    "enum": ["1024x1024", "1024x1792", "1792x1024"],
                    "description": "Optional size. Default 1024x1024.",
                },
            },
            "required": ["prompt"],
            "additionalProperties": False,
        },
    },
}
```

- `dispatch_tool_async` 增加 `name == "generate_image"` 分支。
- 实现放 `agenticx/tools/image_generation.py`（新文件）：读 config、调 provider、把 PNG 写到 `<session workspace>/generated/<uuid>.png`，返回 JSON 字符串。
- 未配置：`{"type":"image","status":"error","error":"image_generation is not configured"}` 对应的工具可见文本为 `ERROR: image_generation is not configured`。

**AC-2**

- 测试：`tests/test_generate_image_tool.py`
- fake provider 写出文件存在且 `json.loads(result)["type"] == "image"`。
- 无 config 时返回以 `ERROR:` 开头的字符串，不抛未捕获异常。
- 断言 **没有** 把整图 base64 塞进返回给模型的长字符串（path + 短确认即可）。

### FR-3：消息模型与 store extras

**落点：** `desktop/src/store.ts:218-281` `Message` 类型；`addPaneMessage` extras（约 `:1685`）；`MessageToolExtras` 旁增加 `MessageAssistantExtras` 或把 `blocks` 放进 extras 联合类型。

after：

```ts
blocks?: ContentBlock[];
```

`addPaneMessageIfSessionActive(..., extras)` 必须能把 `blocks` 写进新 assistant 行。

新增纯函数（建议新文件 `desktop/src/utils/content-blocks.ts`，避免把逻辑堆进 1万行 `ChatPane`）：

```ts
export function upsertImageBlock(blocks: ContentBlock[], incoming: ContentBlock): ContentBlock[]
export function projectContentFromBlocks(blocks: ContentBlock[]): string
export function markGeneratingBlocksCancelled(blocks: ContentBlock[]): ContentBlock[]
```

**AC-3**

- 测试：`desktop/src/utils/content-blocks.test.ts`
- start 再 end 同一 `id` → 一条 block，`status` 从 generating 变 ready，`path` 补上。
- 不同 `id` 保持顺序（文、图、文）。
- `projectContentFromBlocks` 只拼接 `type==="text"`。
- cancel 只改 generating，不动 ready。

### FR-4：ChatPane 流式叠加 + 提交

**落点（只改这些锚点，禁止顺手重构 SSE 大循环）：**

1. `ChatPane.tsx:3308-3319` `streamAssistantMessage`：给合成消息加 `blocks: streamedBlocks`。
2. 在现有 `streamedAssistantText` state 旁增加 `streamedBlocks` state（或 ref + 触发更新，与 `scheduleStreamTextUpdate` 同风格）。
3. `ChatPane.tsx` SSE 循环，紧挨 `payload.type === "token"`（`:10397`）之后增加：

```ts
if (payload.type === "content_block" && eventAgentId === "meta") {
  const mode = String(payload.data?.mode ?? "");
  const block = payload.data?.block;
  // upsert into streamedBlocks; mode=start 立即可见骨架
  continue;
}
```

4. `ChatPane.tsx:11432-11441` `addPaneMessageIfSessionActive` 的 extras 并入 `blocks: streamedBlocks`（若有）。`mergeLastPaneMessageByRole` 的 mid-commit 分支同样补 `blocks`。
5. 中断路径（搜现有 abort / stop，约 `:7189` 注释附近）：对 `streamedBlocks` 调 `markGeneratingBlocksCancelled` 再提交。
6. SSE 开始时清空 `streamedBlocks`（与清空 `streamTextRef` 同一处）。

**AC-4**

- 测试：优先抽纯函数测 upsert；ChatPane 用 vitest 测「token → content_block start → token → content_block end → commit extras 含 blocks」可放 `desktop/src/utils/content-block-sse.test.ts`（把分支抽成 `applyContentBlockEvent`，**不要**为测这一条去挂载整页 ChatPane）。
- 手动 AC：Pro 单聊「画一只猫」→ 文字流出后出现骨架（带秒）→ 淡入 → 图下继续出字；向上滚不被拽回底部。

### FR-5：渲染 `InlineImageBlock`

**落点：**

- 新文件 `desktop/src/components/messages/InlineImageBlock.tsx`
- `MessageRenderer.tsx:312-318`：若 `message.blocks?.some(b => b.type==="image")`，**跳过** `appendMissingImageMarkdown`。
- `ImBubble.tsx` / assistant 正文：当 `message.blocks` 存在且长度 > 0，按序渲染 text（仍走现有 `CitationMarkdownBody`）与 `<InlineImageBlock />`；否则保持现状。

`InlineImageBlock` 行为：

| status | UI |
|---|---|
| generating | 复用 `desktop/src/components/ds/Shimmer.tsx` + 「生成图片中… Xs」 |
| ready | `<img src={pathToFileUrl(path)}>` 隐藏加载，`onLoad` 后 ~300ms 淡入；点击打开 `ZoomableImage` |
| error | 终态短文案，不用红底大卡片 |
| cancelled | 「已取消」 |

宽度：与当前 assistant 气泡 `maxWidth` 同一套，不另写死 px。

**AC-5**

- 测试：`desktop/src/components/messages/InlineImageBlock.test.tsx`
- generating 看得到「生成图片中」；ready 有 `img`；error/cancelled 无 `img`。
- `MessageRenderer`：有 image block 时 `appendMissingImageMarkdown` 不被调用（可测 `displayMessage.content` 不含后置 `![](`）。

### FR-6：历史回放白名单

**落点：** `agenticx/studio/session_manager.py:2507` `_normalize_messages`

在 `row` 构造之后、return 之前（assistant 分支，约 `:2679` 附近）增加：

```python
raw_blocks = item.get("blocks")
if role == "assistant" and isinstance(raw_blocks, list) and raw_blocks:
    row["blocks"] = _sanitize_content_blocks(raw_blocks)
```

`_sanitize_content_blocks`：只保留 `type in {"text","image"}`；image 丢掉任何 `data:` / 超长字符串；`path` 必须是绝对路径或空。

Desktop 把 `GET /api/session/messages` 映到 `Message` 的地方（ChatPane 载历史，搜 `loadSessionMessages` / `role === "assistant"` 映射）必须抄 `blocks`。

后端在写入 assistant 行时（runtime persist 最终可见回复的那次 append，**精确搜** `chat_history.append` 且 `role=="assistant"` 的主回合路径，不要改子智能体汇总那条 `:3286`）带上 `blocks`。若主回合只写 `content`、图只在 tool 行：允许 P0 用「历史载入时若无 blocks、但本轮有 `generate_image` tool 且结果 JSON `type==image`，前端合成一条 ready block」。两种里**选后端写入**为默认，合成路径仅作缺字段回退。

**AC-6**

- 测试：`tests/test_normalize_messages_blocks.py`（或扩现有 session_manager 单测）
- 输入含 `blocks` 的 assistant → 输出仍有同一 `id` 的 image block 与 `path`。
- 输入 image block 带 `data:image/png;base64,AAAA...`（任意长）→ 输出**没有**该 data URL。
- 无 `blocks` 的旧消息输出与现在字段集一致。

---

## 分阶段

| 阶段 | 范围 | 交付 |
|---|---|---|
| **P0** | 本 plan 全部 FR-1…FR-6 | 单聊 Pro：骨架→淡入→灯箱；历史回放；`generate_image`；工具卡折叠 |
| **P1** | Lite `ChatView.tsx:1471` token 旁路；`App.tsx:1471` 自动汇报；另存为/复制图片 | 与 Pro 同一事件，不改协议 |
| **P2** | 群聊；原生模型出图；远程 URL + 缩略图；可选 AG-UI 适配 | 另开 plan，不要挤进本次 |

---

## 验收标准（P0）

1. Pro 单聊「画一张猫」：文字流不因出图停住；骨架出现在文中插入点；返回后原位淡入；可继续在图下出字。
2. 点击内联图，灯箱打开本机原图（`file://`），可缩放。
3. 关掉窗格再打开同一 session，图仍在气泡内（`blocks` 活过 `_normalize_messages`）。
4. 无 `blocks` 的旧回复像素级行为不变（含现有产物图 markdown hack）。
5. 未配置 `image_generation` 时：骨架 → error 终态，聊天不崩。
6. 生成中点停止：骨架变「已取消」，已完成的图保留。
7. 图片不超出 assistant 气泡宽。

---

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 按旧稿改 AG-UI，Desktop 收不到事件 | 本 plan 已改走 `RuntimeEvent`；AC-1 用 `_runtime_event_to_sse_lines` 验 |
| 只改 store、不改 `__stream__`，骨架永远不出现 | FR-4 强制挂 `streamAssistantMessage.blocks` |
| `_normalize_messages` 丢 `blocks` | FR-6 白名单 + 单测 |
| 误改 `view_image` 导致附图注入回归 | Out of scope；禁止动 `_tool_view_image` |
| 误给 `server.py` 加路由 / 整段替换 import | P0 不加路由；改 `server.py` 仅当 persist append 必须动到目标行 |
| Electron `file://` 在部分环境下被拦 | 若灯箱空白，再开 P1 用已有 desktop token 做 loopback 文件路由；P0 先用 `pathToFileUrl` |
| 出图 API 未定 | fake provider + 未配置错误；不在 P0 绑死厂商 SDK |

---

## 相关文件索引

- 事件：`agenticx/runtime/events.py`、`agenticx/runtime/agent_runtime.py`、`agenticx/studio/server.py`（`_runtime_event_to_sse_lines` 只读对照）
- 工具：`agenticx/cli/agent_tools.py`、新建 `agenticx/tools/image_generation.py`
- 持久化：`agenticx/studio/session_manager.py` `_normalize_messages`
- 桌面流式：`desktop/src/components/ChatPane.tsx`（`__stream__`、`token` 分支、final 提交）
- 桌面模型：`desktop/src/store.ts`
- 渲染：`desktop/src/components/messages/MessageRenderer.tsx`、`ImBubble.tsx`、`ds/ZoomableImage.tsx`、`ds/Shimmer.tsx`
- 现有 hack：`desktop/src/utils/session-artifacts.ts`（`appendMissingImageMarkdown` / `pathToFileUrl`）
- 设计约束：`desktop/DESIGN.md`
