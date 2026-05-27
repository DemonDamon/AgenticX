---
name: ""
overview: ""
todos: []
isProject: false
---

# Near 桌面端：搜索来源卡片 + 正文引用角标（对齐豆包体验）

> Plan-Id: 2026-05-27-near-citation-references
> Plan-File: .cursor/plans/2026-05-27-near-citation-references.plan.md
> Owner: Damon
> 状态：草拟，等待开工

## 背景

用户对照豆包提出诉求：

- 图 1：搜索后顶部展示「搜索 N 个关键词，参考 M 篇资料」，下方编号列表，每条标题为可点击链接
- 图 2：助理正文里出现灰色角标 `[1]`，hover/click 弹出来源卡片，点击「打开原文」跳转浏览器

Near 当前状态：

- `web_search` 工具已存在（DuckDuckGo / Bocha / Tavily / Serper / Google CSE / Bing 六个 provider），返回结构为 `{title, url, snippet}`，但 `WebSearchService.format_results()` 拼接成纯文本喂给模型，前端没有结构化数据
- `knowledge_search` 在 `ChatPane.formatToolResult` 里被拼成「📚 知识库命中 N 条引用」字符串，仍是纯文本
- 两个工具的结果都进入折叠的 `ToolCallCard`，URL 在工具卡里不能点
- `chatMarkdownComponents` 没有自定义 `a` 标签，正文里的 Markdown 链接点击行为不正确（在 Electron 内导航而非外链）
- 没有 citation badge 解析与渲染

## 范围划分（严格 no-scope-creep）

整个工作拆成两个**独立可验收**的 Phase，Phase 2 仅在 Phase 1 稳定后启动。

---

## Phase 1：来源卡片 + 外链修复（必做）

> 只动「数据透出 + 展示链路」，不改模型输出协议；零回归风险。

### FR-1 后端结构化 payload

- `agenticx/studio/web_search/contracts.py` 不变（已是 `{title, url, snippet}`）
- `agenticx/cli/agent_tools.py::_tool_web_search`：
  - 仍返回当前 plain text 给模型（避免影响已经训练好的对话行为与 token 占用）
  - 同时将结构化 `references` 写入工具调用 metadata，供 SSE 透出
- `agenticx/studio/server.py` SSE `tool_result` 事件：
  - 新增可选字段 `structured.references: SearchReference[]`，schema：
    ```
    {
      id: number,           # 同轮内递增编号，1-based
      title: string,
      url: string,          # web 来源为 http(s)，KB 来源为 agx://kb/<doc_id>#<chunk_idx>
      snippet: string,      # ≤200 字
      source: "web" | "kb",
      provider?: string,    # web 才有：duckduckgo / bocha / ...
      domain?: string,      # web 才有：解析 URL 得到的 host
    }
    ```
- `knowledge_search` 同步走相同 schema（`source = "kb"`），由 `_tool_knowledge_search` 透出
- `references[].id` 在**同一轮 assistant 回合**内全局递增（web + kb 共享编号空间），与 Phase 2 角标对齐

### FR-2 `ReferencesCard` 组件

- 新增 `desktop/src/components/messages/ReferencesCard.tsx`
- 展示位置：替换 `ChatPane.formatToolResult` 里 `web_search` / `knowledge_search` 两个分支的当前文本渲染，渲染为独立卡片（不进折叠工具卡）
- 视觉（参照豆包图 1）：
  - 顶部一行：`🔎 已检索 N 个关键词，参考 M 篇资料 ▸`（关键词区聚合本轮所有 `web_search.toolArgs.query` 去重）
  - 默认折叠，点击展开
  - 展开后编号列表：`1. {title}  ·  {domain or 'KB'}`（标题为链接，hover 显示完整 URL tooltip）
  - 列表底部允许「显示更多」（>5 条折叠剩余项）
- 同一轮内多次 `web_search` / `knowledge_search` 调用必须**合并**为单卡片（不要每次 tool_call 独立一张卡）
  - 实现方式：以 `roundId`（assistant 消息 id 或同一 run_id）作 key，累加 `references[]` 与关键词集合
- KB 与 web 同卡内分组展示（小标题「网络」/「知识库」），但编号连续

### FR-3 Markdown 外链点击修复

- 修改 `desktop/src/components/messages/markdown-components.tsx`：
  - 在 `chatMarkdownComponents` 新增 `a({href, children, ...rest})` 渲染器
  - `http(s)://` → `onClick={e => { e.preventDefault(); window.agenticxDesktop.openExternal(href) }}`，`target="_blank"` `rel="noopener noreferrer"`
  - `file://` / `data:` / `agx://` → 不调用 openExternal（保留默认或自定义处理）
- `desktop/electron/preload.ts` 暴露 `openExternal(url: string): Promise<void>`
- `desktop/electron/main.ts` IPC handler `open-external`：
  - 仅放行 `http://` / `https://` 协议；其余拒绝
  - 调用 `shell.openExternal(url)`
- `desktop/global.d.ts` 补充类型声明

### FR-4 字段持久化（最小集）

- `desktop/src/store.ts` 的 `Message` 类型新增可选字段：
  - `references?: SearchReference[]`（同一轮 assistant 消息累计的引用列表）
  - `searchedQueries?: string[]`（关键词去重列表）
- SSE `tool_result` 到达时累加进 `pendingAssistantMessage.references`
- 写入 `messages.json` 时一并落盘（`agenticx/studio/server.py` 持久化路径）
- 加载历史 session 时反序列化恢复
- **兼容旧消息**：缺字段时按 `undefined` 处理，不渲染卡片

### Phase 1 验收（AC）

- AC-1.1：在元 Agent / 分身会话中触发 `web_search`，气泡上方出现 `ReferencesCard`，可展开
- AC-1.2：点击编号链接 → 系统默认浏览器打开（不在 Electron 窗口内导航）
- AC-1.3：Markdown 正文里的 `[text](https://...)` 链接同样外链打开
- AC-1.4：`knowledge_search` 命中后使用同款卡片，编号与 web 来源共享空间
- AC-1.5：同一轮多次搜索（如模型自检索两次）合并为单卡片，关键词去重展示
- AC-1.6：关闭应用重开，历史消息的 `ReferencesCard` 仍可展开点击
- AC-1.7：`ToolCallCard` 的其他工具（bash_exec / file_read 等）展示不受影响

---

## Phase 2：正文 inline 引用角标（对齐豆包图 2）

> 仅在 Phase 1 稳定（≥1 天无回归）后启动。

### FR-5 system prompt 引用协议

- 修改 `agenticx/runtime/prompts/meta_agent.py::_build_web_search_capability_block()`
- 末尾追加（仅当 `web_search` 启用时注入）：
  ```
  ## 引用规范
  - 每条来自 `web_search` / `knowledge_search` 的事实，必须在句末用 `[N]` 标注来源编号，N 与本轮返回的 references id 对应
  - 多来源并列：`[1][2]`
  - 不要造 `【1】`、`(来源 1)`、`[来源1]` 等变体；不要在角标前后加多余空格
  - 模型自身常识不需要角标
  ```
- 同步在 `_build_kb_capability_block()` 加同样的约束（保持两路工具一致）

### FR-6 流式归一化

- 新增 `desktop/src/components/messages/citation-normalize.ts`：
  - 输入：助理消息 streaming text
  - 处理：正则归一化常见变体 `【(\d+)】` / `\(来源\s*(\d+)\)` / `\[来源\s*(\d+)\]` → `[N]`
  - 仅当该消息存在 `references`（来自 FR-4 字段）时启用
- 接入 `normalizeChatMarkdownContent`，作为可选 pass

### FR-7 `CitationBadge` Markdown 扩展

- 新增 remark 插件 `desktop/src/components/messages/remark-citation.ts`：
  - 扫描文本节点中的 `\[(\d+)\]` 模式
  - 替换为自定义 mdast 节点 `citation` `{value: number}`
  - 仅当上下文（通过 MarkdownContext 注入 `references`）能查到该 id 时才替换；查不到保持原文 `[N]`
- 新增 `desktop/src/components/messages/CitationBadge.tsx`：
  - 灰色 pill，宽度紧凑（高 16px、字号 11px、tabular-nums）
  - hover/click 弹 `Popover`（参考已用过的 Radix popover）
  - Popover 内容：标题（粗体）/ 域名 / 摘要前 120 字 / 「打开原文 ↗」按钮（走 FR-3 的 openExternal）
- 集成到 `chatMarkdownComponents`：在 `chatRemarkPlugins` 中加入新插件

### FR-8 流式 progressive resolve

- 模型可能在 `tool_result` 之前先输出正文 + 角标 `[1]`
- 处理策略：
  - 若 `references` 列表里查不到 `id=1` → 角标渲染为「灰色占位 pill」，不可点
  - `tool_result` 到达、`references` 累加后，pill 自动切换为可点击态（React reactive，无需手动 re-render）
- `useMemo` 缓存 references lookup，避免每个 token 流式触发重渲染

### Phase 2 验收（AC）

- AC-2.1：助理回复中的 `[1]` 渲染为灰色 pill，hover 出来源 Popover
- AC-2.2：点击 Popover 内「打开原文 ↗」→ 浏览器打开
- AC-2.3：模型输出 `【1】` 等变体被归一化为相同 pill
- AC-2.4：流式中先出现 `[1]` 后到达 `tool_result`，pill 从占位态切换为可点击态
- AC-2.5：关闭应用重开，历史消息角标仍可点开
- AC-2.6：未启用 web_search 的会话、未携带 references 的旧消息，正文里的 `[1]` 保持纯文本不变（向后兼容）

---

## 非范围（Out of Scope，明确剔除）

- favicon / 域名 icon 加载（涉及外部网络与缓存策略，二期再议）
- 来源去重（同 URL 多次出现合并为一条）
- 多 hop 检索的引用链可视化（`web_search` → `web_fetch` 联动）
- 修改 `ToolCallCard` 通用展示（保留对其他工具的兜底渲染）
- 修改 voice / IM / Focus 模式的引用展示（聚焦 Desktop 主聊）
- 新增第三方搜索 provider
- 知识库 chunk 跳转预览面板（仅做 URL 链接，不嵌入 KB 查看器）

## 技术要点 / 已知坑

1. **SSE schema 向后兼容**：`structured.references` 必须 optional，老前端忽略即可，便于灰度
2. **外链白名单**：仅放行 `http(s)://`，禁止 `file://` / `data:`，避免被恶意搜索结果利用
3. **流式 progressive resolve**：用 React reactive lookup，不要在每个 token 重建 mdast
4. **字段命名统一**：全链路使用 `references[]`，禁止再造 `sources` / `citations` 同义字段
5. **编号空间**：web + kb 共享同一轮递增编号，避免角标 `[1]` 在两路检索下歧义
6. **persist key**：`messages.json` 写入 `references` 时按消息 id 隔离；不要跨消息共享对象引用
7. **`window.agenticxDesktop.openExternal` 已存在与否**：需先在 preload 检查；若已存在（其他 IPC 复用），直接复用，否则新增

## 工作量估算

| Phase | 主要改动文件 | 预计耗时 |
|------|------------|---------|
| Phase 1 | `agent_tools.py`、`server.py`、`ChatPane.tsx`、新 `ReferencesCard.tsx`、`markdown-components.tsx`、`preload.ts`、`main.ts`、`store.ts` | 1–1.5 天 |
| Phase 2 | `meta_agent.py`、新 `remark-citation.ts`、新 `CitationBadge.tsx`、新 `citation-normalize.ts`、`store.ts`、`markdown-components.tsx` | 1.5–2 天 |

## 提交协议

- Phase 1 与 Phase 2 各自独立提交，按本 plan 的 FR 块拆 commits
- 每个 commit 必须含：
  ```
  Plan-Id: 2026-05-27-near-citation-references
  Plan-File: .cursor/plans/2026-05-27-near-citation-references.plan.md
  Made-with: Damon Li
  ```
- Phase 1 落地后执行 `/update-conclusion --plan=...` 维护模块结论
- Phase 2 同上

## 下一步

等待用户确认开工：

- [ ] Phase 1 立刻开始
- [ ] Phase 2 等 Phase 1 验收通过后再开
