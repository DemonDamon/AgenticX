---
name: kb-retrieval-mode-per-session
overview: 把知识库检索模式（智能/始终）从「全局唯一」改为「按 session 绑定」。当前 desktop 切换按钮与后端 meta_agent 都只读写全局 ~/.agenticx/config.yaml 的 retrieval.mode，多会话共享一份导致来回切换时互相覆盖、模式乱跳。改为：desktop 按 sessionId 持久化用户选择并随每次 /api/chat 透传 retrieval_mode；后端按请求覆盖并记到内存 session 让 continue/loop 沿用；全局配置降级为「新会话默认」。
todos:
  - id: desktop-util
    content: 新增 desktop/src/utils/kb-retrieval-mode.ts（按 sessionId 读写 localStorage map，含 get/set/默认回退）并补 vitest
    status: pending
  - id: desktop-toggle
    content: PaneKnowledgeRetrievalModeSwitch 接收 sessionId，显示读 per-session（缺省回退全局默认，不写全局），切换只写 per-session map
    status: pending
  - id: desktop-send
    content: sendChat body 增加 retrieval_mode（取当前 requestSessionId 的 per-session 值），随 /api/chat 透传
    status: pending
  - id: backend-protocol
    content: ChatRequest 增加 retrieval_mode 可选字段
    status: pending
  - id: backend-prompt
    content: build_meta_agent_system_prompt / _build_kb_retrieval_policy_block 接收 kb_retrieval_mode_override；server.py /api/chat 解析 payload.retrieval_mode、setattr 到 session、并在主 build 传 override；loop/continue build 经 session 字段回退
    status: pending
  - id: verify
    content: 改动文件无 lint/类型错误；desktop vitest + 后端冒烟通过
    status: pending
isProject: false
---

# 知识库检索模式按 Session 绑定

## 背景与现象

用户在 session A 选「始终检索」，在 session B 选「智能检索」，反复切换后 A 的模式被改回 B 的选择（或互相乱跳）。用户预期检索模式应与 session 绑定。

## 根因（已 trace）

检索模式当前是**全局唯一**，根本未按 session 绑定：

- Desktop 切换组件 `PaneKnowledgeRetrievalModeSwitch`（`desktop/src/components/ChatPane.tsx:815`）的 `mode` 来自 `api.readConfig()` 读全局 `~/.agenticx/config.yaml` 的 `retrieval.mode`；`saveMode`（:849）写回同一全局字段。
- 后端 `agenticx/runtime/prompts/meta_agent.py:442 _build_kb_retrieval_policy_block()` 从全局 `cfg.retrieval.mode` 读，决定 `knowledge_search` 是「智能」还是「始终」。
- `/api/chat`（`ChatRequest`，`agenticx/studio/protocols.py:21`）不接受按请求的 `retrieval_mode` 覆盖。

多 pane/session 共用一份全局值 + 每次切换 `refresh()` 回读全局 → 最后写的赢，表现为「我之前在 A 选的被改了」。

## 修复方案

### FR-1 Desktop per-session 存储（`desktop/src/utils/kb-retrieval-mode.ts` 新增）

- localStorage map `agx-kb-retrieval-mode-by-session-v1`：`{ [sessionId]: "auto" | "always" }`。
- 导出 `getSessionKbRetrievalMode(sessionId): "auto"|"always"|null`、`setSessionKbRetrievalMode(sessionId, mode)`、`clampKbRetrievalMode(raw)`（legacy `manual`→`auto`，未知→`auto`）。
- 纯函数 + 可测；读写异常吞掉（localStorage 不可用时回退）。

### FR-2 切换组件按 session（`desktop/src/components/ChatPane.tsx`）

- `PaneKnowledgeRetrievalModeSwitch` 新增 prop `sessionId`。
- 显示态 `mode`：优先 `getSessionKbRetrievalMode(sessionId)`；为 null 时回退读全局配置作为**默认**（仅展示，不写回 per-session、不写全局）。
- `saveMode`：只 `setSessionKbRetrievalMode(sessionId, next)`，**不再写全局 config**（避免 clobber）。失败回退本地 state。
- 渲染处（:8031）传 `sessionId={pane.sessionId}`。
- sessionId 变化时 refresh 显示态。

### FR-3 chat 请求透传（`desktop/src/components/ChatPane.tsx` sendChat）

- body 初始化处（:5759 附近）：`const kbMode = getSessionKbRetrievalMode(requestSessionId); if (kbMode) body.retrieval_mode = kbMode;`
- 仅 meta、非群聊场景需要（与现有 knowledge_search 注入一致）；群聊/分身可不传（保持现状）。

### FR-4 后端协议（`agenticx/studio/protocols.py`）

- `ChatRequest` 增加 `retrieval_mode: Optional[str] = None`。

### FR-5 后端 prompt 按 session 覆盖（`agenticx/runtime/prompts/meta_agent.py` + `agenticx/studio/server.py`）

- `_build_kb_retrieval_policy_block(mode_override: Optional[str] = None)`：`mode_override in {auto,always}` 时用它，否则读全局配置（其余逻辑不变）。
- `build_meta_agent_system_prompt(..., kb_retrieval_mode_override: Optional[str] = None)`：effective = `kb_retrieval_mode_override` or `getattr(session, "kb_retrieval_mode", None)`；传入 `_build_kb_retrieval_policy_block(effective)`。
- `StudioSession`（`agenticx/cli/studio.py`）增加字段 `kb_retrieval_mode: Optional[str] = None`（内存态，per session）。
- `server.py` `/api/chat`：解析 `payload.retrieval_mode`，若属于 {auto,always} 则 `setattr(session, "kb_retrieval_mode", val)`；在主 build（:2647）传 `kb_retrieval_mode_override=val`。loop/continue build（:3097）通过 session 字段回退自动生效（同进程内）。

## 验收

- AC-1：session A 选「始终」、session B 选「智能」，反复切换后各自保持，互不影响。
- AC-2：A 选「始终」后该会话每轮 `/api/chat` 带 `retrieval_mode=always`，后端系统提示按 always 构建（始终先 knowledge_search）。
- AC-3：未做过 per-session 选择的新会话，切换组件展示全局设置面板的默认值。
- AC-4：同会话 continue / max_rounds loop 续跑沿用该会话的模式（不回退全局）。
- AC-5：全局「设置 → 知识库 → 检索」仍可改默认值，仅影响未显式选择过的会话展示默认，不再被聊天页切换 clobber。

## 范围与排除

- 只做 Pro `ChatPane` + 后端 meta 路径；不动 `ChatView`（Lite）、不动 KB 检索通道（vector/bm25/hybrid，那是 retrieval_mode 的另一语义，归 `retrieval.retrieval_mode`，与本 mode 不同）。
- per-session 模式为内存态 + localStorage；不落 server 端持久化文件（重启后 desktop 仍按 localStorage 重新透传，行为一致）。
- 不改群聊/分身的检索模式语义（保持现状走全局/默认）。
