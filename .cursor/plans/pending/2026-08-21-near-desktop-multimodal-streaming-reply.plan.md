# Near Desktop 多模态流式回复（类豆包：流中文+图）

- **Plan-Id**: 2026-08-21-near-desktop-multimodal-streaming-reply
- **Plan-File**: `.cursor/plans/pending/2026-08-21-near-desktop-multimodal-streaming-reply.plan.md`
- **状态**: pending（待开工 backlog）
- **作者**: AgenticX planner
- **日期**: 2026-08-21（v2：修正图片渐进加载时间线与部署形态设计）

## 1. 背景与目标

### 1.1 用户诉求
在 Near Desktop（`desktop/`，Electron 桌面端）实现**多模态流式回复**：assistant 在流式回复过程中能够内联返回图片（"给我回复一张图片"），对标豆包桌面端在流式输出中插入图片的体验——文字 token 与图片块在同一轮 assistant 回复中**有序交错**，图片有渐进式 UX（生成中占位 → 就绪淡入），点击可放大查看原图。

### 1.2 现状（已核对代码）
| 维度 | 现状 | 文件锚点 |
|------|------|----------|
| 桌面消息模型 | `Message.content: string`，无有序 content-blocks 数组；图片靠 sidecar `attachments`/`references`/`metadata` | `desktop/src/store.ts:217-280` |
| 流式写入 | `addPaneMessage` / `updateLastPaneMessage` 把 token 累加进 `content` 字符串 | `desktop/src/store.ts:1720-1805`；消费侧 `desktop/src/App.tsx:1470-1493` |
| 主聊天流 | `ChatView` 通过 agent registry 回调（`streamTextRef`/`addAssistantMessage`）接收 token | `desktop/src/components/ChatView.tsx:457-530` |
| AG-UI 协议 | `BaseMessage.content` 已支持 `Union[str, List[Any]]`；存在 `CustomEvent(name,value)` 逃生舱；但**无原生 image 事件类型** | `agenticx/protocols/agui.py:36-164` |
| SSE 适配 | `SSEFormatter` 把内部 action 映射为 24 种 SSE 事件 | `agenticx/server/sse_adapter.py`、`agenticx/server/sse_formatter.py` |
| 内联渲染基建 | 已有 `ZoomableImage`/`ZoomableViewport`、`WidgetBlock`（渐进 SVG，`show-widget-partial.ts`）、`HtmlPreviewChrome`、`ViewImageInjectCard` | `desktop/src/components/ds/ZoomableImage.tsx` 等 |
| 图片注入 hack | `MessageRenderer.displayMessage` 已把工具结果图片以 markdown `![](url)` **后置追加**到 `content`——非首类 block、非 mid-stream | `desktop/src/components/messages/MessageRenderer.tsx:280-287`、`desktop/src/utils/session-artifacts.ts` |
| 图片生成能力 | Python SDK 内**无** `generate_image`/`text_to_image` 工具（仅 observability 命中） | grep `generate_image\|text_to_image` |

### 1.3 目标
1. **数据层**：assistant 回复从"单一字符串"升级为**有序 content-blocks**（text / image / 后续可扩展），同时保持 `content` 字符串作为文本投影以向后兼容。
2. **协议层**：在 AG-UI 流中增加**多模态内容块事件**，能在 text chunk 之间插入图片块；支持"生成中 → 就绪"两段式渐进。
3. **体验层**：四阶段渐进 UX——发起（骨架占位）→ 生成中（不阻塞文字流）→ 就绪（淡入）→ 点击（灯箱看原图）；按部署形态（本地/远程）区分就绪阶段的加载策略。
4. **渲染层**：Near Desktop 在 assistant 气泡列内按序渲染 block；图片块复用 `ZoomableImage`；图片数据隔离在流式重渲染 diff 路径之外；遵循 `DESIGN.md` 的气泡列宽与扁平化约束。
5. **来源层**：打通三类图片来源中至少一类作为 P0：工具结果图（generate_image / view_image / web fetch image）→ 内联图片块。

### 1.4 非目标
- 不做用户输入侧多模态（已有 `chat_attachments` / `view_image` 注入模型上下文）。
- 不重写 markdown 渲染器；图片块作为独立 React 节点插入，不依赖 markdown `![]()`。
- P0 不接入原生多模态模型输出（如 Doubao Seedream-in-chat、GPT image），留 P2。
- 不改 IM 群聊的 bubble 宽度体系（`DESIGN.md` locked layout 不动）。
- P0 不做生成中途的渐进解码（依赖上游 API 能力，如分块/渐进 JPEG），仅做"占位→就绪"两态。

## 2. 关键设计决策

### 2.1 采用 content-blocks 模型（非纯 markdown 注入）
**决策**：新增 `Message.blocks?: ContentBlock[]` 有序数组，与 `content: string` 并存。`content` 由 text block 投影而来，保证旧渲染/导出/历史回放零改动。

**为何不沿用 `appendMissingImageMarkdown`**：markdown 图片无法做真正的渐进占位、无法在任意位置可靠插队、无法携带 `status/mime/dimensions` 等元数据。豆包式体验要求"生成中占位→就绪淡入"和"文图交错"，必须首类 block。

```ts
type ContentBlock =
  | { type: "text"; text: string }                      // 流式累加
  | { type: "image"; id: string; url?: string;          // 原图 URL（本地 artifacts 路由或远程 URL）
      thumbDataUrl?: string;                            // 远程模式：内联缩略图（≤100KB）
      mime?: string; alt?: string;
      status: "generating" | "ready" | "error" | "cancelled";
      width?: number; height?: number; source?: "tool" | "model" | "plugin"; };
```

### 2.2 协议：复用 AG-UI `CustomEvent` 承载块事件
**决策**：不动 AG-UI 标准 `EventType` 枚举，用 `CustomEvent(name="agenticx.block", value={...})` 承载多模态块。这与协议已有的 escape-hatch 一致，且 `BaseMessage.content` 本就支持 `List[Any]`。

**为何不新增 `IMAGE_MESSAGE_CHUNK` 枚举值**：避免破坏 AG-UI 上游协议内化约定；`CustomEvent` 已足够表达力，且面向未来（音频/文件块同理）。

**时间线前提（重要）**：`mode=start` 发生在**工具调用发起时**，此刻图片尚未生成（上游 API 还在跑，2~10s），因此 **start 事件不携带任何图片数据**——它只声明"这里将有一张图"。图片数据在 `mode=end`（工具返回后）才出现。

**Wire 格式（SSE `data:` JSON）**：
```jsonc
// 文本块（仍走标准 TEXT_MESSAGE_CHUNK，不变）
{ "type": "TEXT_MESSAGE_CHUNK", "message_id": "m1", "delta": "这是图：" }

// 图片块——发起（生成中占位；无图片数据）
{ "type": "CUSTOM", "name": "agenticx.block",
  "value": { "message_id": "m1", "mode": "start",
    "block": { "type": "image", "id": "img-1", "status": "generating",
               "alt": "一只猫", "source": "tool" } } }

// ……此处模型/工具可以继续产生 TEXT_MESSAGE_CHUNK，文字流不被阻塞……

// 图片块——就绪（本地模式：带原图 url）
{ "type": "CUSTOM", "name": "agenticx.block",
  "value": { "message_id": "m1", "mode": "end",
    "block": { "type": "image", "id": "img-1", "status": "ready",
               "url": "http://127.0.0.1:PORT/api/sessions/SID/artifacts/img-1.png",
               "thumbDataUrl": null, "mime": "image/png",
               "width": 1024, "height": 1024 } } }

// 图片块——就绪（远程模式：带内联缩略图 + 原图 url）
{ "type": "CUSTOM", "name": "agenticx.block",
  "value": { "message_id": "m1", "mode": "end",
    "block": { "type": "image", "id": "img-1", "status": "ready",
               "url": "https://gateway/artifacts/SID/img-1.png",
               "thumbDataUrl": "data:image/jpeg;base64,...(≤100KB)",
               "mime": "image/png", "width": 1024, "height": 1024 } } }

// 后续文本块
{ "type": "TEXT_MESSAGE_CHUNK", "message_id": "m1", "delta": " 如上。" }
```
- `mode=start` → 桌面端渲染骨架占位（shimmer + "生成图片中…"）。
- `mode=end` → 按 blockId 定向更新：本地模式 `<img src=url>` 加载完成后淡入；远程模式先显示 `thumbDataUrl`，同时静默加载 `url`，载毕无感切换。
- 失败/中断：`mode=end` 携带 `status: "error" | "cancelled"`，占位卡转入终态。
- `message_id` 与 `TEXT_MESSAGE_CHUNK` 的 `message_id` 对齐，决定插入到哪条 assistant 消息。
- 一条回复多张图：多个 blockId 各自独立 start/end，天然支持文图多重交错。

### 2.3 图图片来源（P0 选定）
P0 走**工具结果图**：当某工具的返回结果声明为图片（约定 `result = {type:"image", url|data, mime, alt}`）时，agent loop 把该 tool result 映射成一个 `agenticx.block` 图片块事件（工具发起时 start、工具返回时 end），**并折叠该工具卡**（默认 collapsed，内联图片替代展示）。

- 候选工具：新增 `generate_image` 工具（封装 Seedream / 火山 / OpenAI image），或复用 `view_image` 在"输出方向"的语义扩展。
- 图片落盘：复用 `session-artifacts` / 现有 image-attachment 存储路径，经本地 server 路由暴露 URL（避免大 base64 长期驻留 SSE）。

### 2.4 图片渐进加载体验（四阶段时间线）

这是本 plan 的体验核心。按真实时间线分四个阶段，每个阶段有明确的 UX 目标与技术实现：

```
T0 模型发起 generate_image ──► T1 工具执行中(2~10s) ──► T2 工具返回 ──► T3 用户点击
     │                              │                        │              │
  骨架占位出现                 占位持续,文字流照常            图片淡入        灯箱 1:1 原图
```

| 阶段 | 触发 | 用户看到 | UX 目标 | 实现 |
|------|------|----------|---------|------|
| ① 发起 | TOOL_CALL_START | 骨架卡：shimmer + 图片图标 + "生成图片中…" | 立即反馈"正在出图"，消除文字停顿的困惑感 | `agenticx.block` start 事件，无图数据 |
| ② 生成中 | 工具执行 2~10s | 骨架卡持续；已流出的文字可继续阅读、可自由滚动 | 等待可感知、不锁 UI | block 与 token 流并行；**禁止 lock scroll-to-bottom**（DESIGN.md 既有约束） |
| ③ 就绪 | 工具返回 | 图片在骨架位置淡入（~300ms），后续文字继续流 | 图片"即时"出现、无闪白 | end 事件；按部署形态分策略（见下） |
| ④ 点击 | 用户交互 | `ZoomableImage` 灯箱 1:1 原图，瞬时打开 | 查看细节、缩放 | 复用现有组件；原图已在③被 `<img>` 加载并进缓存 |

**阶段③的加载策略按部署形态区分（关键决策）**：

| 形态 | end 事件载荷 | 桌面端行为 | 理由 |
|------|-------------|-----------|------|
| **本地后端**（P0 默认，Electron + 127.0.0.1） | `url`（loopback artifacts 路由） | `<img src=url>` 隐藏加载，`onLoad` 后淡入替换骨架 | loopback 加载 2MB 原图 <50ms，肉眼与内联 data URL 无差别；**省去后端缩略图管线**（Pillow 依赖、CDN 代理下载、CPU 开销），复杂度减半 |
| **远程后端**（desktop 连远程 gateway，P1） | `thumbDataUrl`（≤100KB 内联）+ `url`（原图） | 先渲缩略图（0 延迟），同时静默加载 `url`，载毕无感切换 | 图片走公网，URL 直载有 300ms~1s 首字节延迟且带鉴权复杂性；缩略图内联保证"就绪即见"，原图后台升级 |

**SSE 帧大小红线**：任何 SSE `data:` 帧（含 `thumbDataUrl`）**≤100KB**。两条理由：
1. NDJSON/SSE 是顺序流，远程模式下大帧传输期间后续 `TEXT_MESSAGE_CHUNK` 全部排队，用户看到"文字停住几秒然后图和文字一起蹦出来"——破坏流式感。
2. 大 data URL 存进 store 的 message 对象后，流式期间每个 token 触发的重渲染都会对其 diff（见 2.5 渲染隔离）。

红线在 `AgUiEncoder.encode` 前加 **guard 强制执行**（超限 → warning log + 降级为只发 URL），不靠调用方自觉。

**点击 ≠ 拉图**：阶段③的 `<img>` 加载已把原图拉进浏览器缓存，阶段④灯箱直接 1:1 渲染同一 `url`，无二次网络请求，打开瞬时。

### 2.5 渲染性能：图片数据隔离在流式 diff 路径之外
流式期间每个 token 都触发 `updateLastPaneMessage` → 消息数组更新 → MessageRenderer 重渲染。若图片 `thumbDataUrl`/`url` 直接挂在传入 props 的 message 对象上，兆级字符串会在每次 token 到来时被 React diff。

**决策**：
- `InlineImageBlock` 用 `React.memo` 包裹，props 只传 `blockId` + `messageId`。
- 组件内部用 zustand selector（`useAppStore((s) => selectImageBlock(s, paneId, messageId, blockId))`）精确订阅该 block。
- 图片数据变化（start→end）只触发该 block 组件重渲染，不影响整条消息流。

## 3. 实施方案

### 3.1 后端（agenticx Python SDK）

**a. 协议层** `agenticx/protocols/agui.py`
- 新增 `ContentBlock` / `AssistantBlockEvent` 模型（`mode: start|end`，`block: ContentBlock`）；或直接用 `CustomEvent` + helper `build_image_block_event(message_id, block, mode)`。
- `AgUiEncoder.encode` 增加**帧大小 guard**：序列化后 >100KB → 降级（剥离 `thumbDataUrl` 仅保留 `url`）+ warning log。

**b. 事件转换** `agui.py` 的内部事件→AG-UI 映射处
- 工具发起时（image-producing 工具的 TOOL_CALL_START）`yield` `agenticx.block` start 事件（无图数据）。
- 工具返回时（TOOL_CALL_RESULT 为图片约定）`yield` end 事件：本地模式带落盘后 `url`；远程模式另生成缩略图（长边 480px JPEG q75）内联 `thumbDataUrl`。
- 给 `LLMResponseEvent` 增加可选 `content_blocks` 字段，原生多模态模型输出（P2）走同一条块事件。

**c. 工具层** `agenticx/tools/builtin.py` / `agenticx/cli/agent_tools.py`
- 新增 `generate_image` 内置工具：入参 `prompt`/`size`/`n`，调用图片后端（Seedream 插件 MCP / 火山 / OpenAI），返回 `{type:"image", url|data, mime, alt}` 约定结果。
- 在 tool executor 标注"image-producing"工具集，供 SSE 适配层决定折叠工具卡 + 发块事件。

**d. 图片存储与缩略图**
- 原图：落盘会话工作区 artifacts 目录（与 `collectTurnPreviewImagePaths` 对齐），本地 server 增加 `GET /api/sessions/{id}/artifacts/{name}` 静态服务（带 session 归属校验）。
- 缩略图（仅远程模式启用）：Pillow 生成长边 480px JPEG q75；本地模式跳过整个缩略图分支。
- data URL 仅允许作为 thumbDataUrl 且受 100KB guard 约束；原图永不内联 SSE。

### 3.2 桌面端（Near Desktop）

**a. Store 数据模型** `desktop/src/store.ts`
- `Message` 增 `blocks?: ContentBlock[]`。
- 新增流式 block API：`appendPaneAssistantBlock(paneId, block)`、`updatePaneBlock(paneId, blockId, patch)`、`finalizePaneBlocks(paneId)`。
- `updateLastPaneMessage` 增维护逻辑：有 `blocks` 时，`content` 由 text block `join("")` 投影（保持旧读取方不变）。

**b. SSE 客户端解析**
- 主路径 `desktop/src/components/ChatView.tsx`：agent registry 回调里新增 `agenticx.block`（`payload.name === "agenticx.block"`）分支 → 调 block API；`mode=start` 立即插骨架占位，`mode=end` `updatePaneBlock` 定向补 url/thumbDataUrl。
- 副路径 `desktop/src/App.tsx:1470`：auto-report SSE 同样补一个 `payload.type === "custom" && payload.name === "agenticx.block"` 分支。

**c. 渲染层**
- `desktop/src/components/messages/MessageRenderer.tsx`：`displayMessage` 优先用 `blocks`；无 `blocks` 时走原 markdown 路径（零回归）。
- `desktop/src/components/messages/AssistantBubble.tsx` 与 `ImBubble.tsx`：当 `blocks` 存在，按序渲染 `<TextBlockStream>` 与 `<InlineImageBlock>`；否则沿用 `CitationMarkdownBody content`。
- 新增 `desktop/src/components/messages/InlineImageBlock.tsx`（状态机 + memo，见 2.5）：
  - `status==="generating"` → `Shimmer` + "生成图片中…"（复用 `desktop/src/components/ds/Shimmer.tsx`）。
  - `status==="ready"` 本地模式 → `<img src={url}>` 隐藏加载，`onLoad` 后淡入（~300ms）替换骨架，无闪白。
  - `status==="ready"` 远程模式 → 先渲 `thumbDataUrl`，`<img src={url}>` 静默加载，`onLoad` 后无感切换。
  - `status==="error" | "cancelled"` → 终态卡片（错误说明 / "已取消"）。
  - 点击 → `ZoomableImage` 灯箱 1:1 原图（复用 `desktop/src/components/ds/ZoomableImage.tsx`；原图已在 `<img>` 缓存，瞬时打开）。
  - 宽度上限对齐 assistant 气泡列宽（`DESIGN.md`：不宽于回复气泡 baseline）。
- 去掉/收窄 `appendMissingImageMarkdown` 后置注入（`blocks` 存在时不再走该 hack）。

**d. 持久化与历史回放**
- `messages.json` 序列化 `blocks`（含 `url`，不含 `thumbDataUrl`——历史回放直接走本地 artifacts URL）；并投影 `content` 文本 + 末尾 markdown 图片链接，保证旧版/导出可读。
- 历史重建复用现有 image-attachment 重建路径（`test_chat_attachments.py` 的 `storage_path → image_url` 逻辑）。

### 3.3 测试
- `tests/test_agui_block_event.py`：后端图片块事件序列化 + **帧大小 guard**（>100KB 降级路径）。
- `tests/test_generate_image_tool.py`：工具返回图片约定结构。
- `desktop/src/components/messages/InlineImageBlock.test.tsx`：骨架→就绪（本地/远程两模式）渲染、error/cancelled 终态、blocks 缺省走旧路径、memo 隔离（block 更新不触发整条消息重渲染）。

## 4. 分阶段任务

| 阶段 | 范围 | 交付 |
|------|------|------|
| **P0** | 工具结果图 → 内联图片块（本地模式） | `generate_image` 工具；`agenticx.block` start/end 事件 + 帧大小 guard；桌面 store blocks + InlineImageBlock 骨架→就绪（URL+onLoad 淡入）+ 灯箱；折叠图片工具卡 |
| **P1** | 渐进体验补全 + 远程模式 + 持久化 | 远程模式缩略图管线（thumbDataUrl 内联 + 原图静默升级）；error/cancelled 终态；多图/文图交错；messages.json blocks 持久化与历史回放；移除 markdown 注入 hack；"另存为/复制图片"气泡操作 |
| **P2** | 原生多模态模型输出 | provider 层把模型返回的 image part 映射为块事件（Doubao/GPT image）；群聊内联图 |

## 5. 验收标准
1. 在 Near Desktop 对 assistant 说"画一张猫"：文字流出后出现"生成图片中"骨架占位 → 图片生成完成后在占位位置淡入 → 文字继续在图下方流式输出，全程文字流未被图片事件阻塞或停顿。
2. 点击内联图片，灯箱瞬时打开 1:1 原图（无二次加载等待），支持缩放。
3. 关闭并重开会话，图片仍内联显示（历史回放正常）。
4. 无图片块的回复，渲染与改动前完全一致（回归零退化）。
5. 图片列宽不超出 assistant 气泡 baseline（符合 `DESIGN.md`）。
6. 任何 SSE `data:` 帧 ≤100KB（含 thumbDataUrl 场景）；guard 生效时有 warning log 且降级为纯 URL。
7. 流式期间图片 block 更新不引发整条消息列表的重渲染（memo/selector 隔离，可用 React DevTools Profiler 验证）。
8. `agenticx.block` 事件可被非 Near 客户端（如 CLI）忽略而不报错（`CustomEvent` 向后兼容）。

## 6. 风险与缓解
| 风险 | 缓解 |
|------|------|
| `Message.content`→`blocks` 迁移爆炸半径大 | `blocks` 可选；`content` 由 text block 投影；旧路径无 blocks 时原样渲染 |
| 大 base64 经 SSE 阻塞流式 / store 膨胀 | 原图永不内联（只发 URL）；thumbDataUrl 受 100KB 硬 guard；本地模式连缩略图都不做 |
| 流式 token 重渲染 diff 图片大字符串 | InlineImageBlock memo + blockId selector 精确订阅（见 2.5） |
| 远程模式缩略图管线引入 Pillow 依赖与 CDN 代理复杂度 | 缩略图仅在远程模式启用；本地模式（P0 主场景）完全跳过 |
| `onLoad` 竞态（end 到达时组件已卸载/块已被取消） | updatePaneBlock 幂等 + 组件卸载清理 onLoad handler |
| AG-UI `CustomEvent` 被误过滤 | 桌面解析层显式识别 `name==="agenticx.block"`，其余 custom 忽略；文档化该约定 |
| 图片生成能力依赖外部后端 | `generate_image` 工具抽象 provider，后端可切 Seedream/火山/OpenAI；未配置时工具返回友好错误而非崩溃 |
| 群聊列宽/锁定布局回归 | P0 仅单聊；群聊走 P2 且单独验证 `DESIGN.md` locked layout |

## 7. 开放问题
1. P0 图片后端首选 Seedream 插件还是火山 API？（影响 `generate_image` 默认 provider 与鉴权落点）
2. 图片工具卡默认折叠还是保留可展开查看 prompt？（建议折叠，图已内联）
3. 生成中骨架卡是否显示已耗时（如"生成图片中… 3s"）？（低成本可感知进度，建议 P0 就带上）
4. 远程模式的 artifacts URL 鉴权方案（签名 URL vs session token header）？

## 8. 相关文件索引
- 协议：`agenticx/protocols/agui.py`、`agenticx/server/sse_adapter.py`、`agenticx/server/sse_formatter.py`
- 桌面 store/流式：`desktop/src/store.ts`、`desktop/src/App.tsx`、`desktop/src/components/ChatView.tsx`
- 桌面渲染：`desktop/src/components/messages/MessageRenderer.tsx`、`AssistantBubble.tsx`、`ImBubble.tsx`、`ds/ZoomableImage.tsx`、`ds/Shimmer.tsx`
- 现有图片基建：`desktop/src/utils/session-artifacts.ts`、`desktop/src/components/messages/ViewImageInjectCard.tsx`、`tests/test_view_image_tool.py`、`tests/test_chat_attachments.py`
- 设计约束：`desktop/DESIGN.md`、`.cursor/plans/pending/README.md`
