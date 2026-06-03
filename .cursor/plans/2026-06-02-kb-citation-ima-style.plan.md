---
name: kb-citation-ima-style
overview: 修复知识库检索角标始终显示为纯文本 [1]/[2] 的功能缺口，并将来源卡片 + 正文角标 + hover 溯源卡视觉对齐 ima（绿色数字 pill、引用摘录弹层、知识库资料折叠列表）。
todos:
  - id: diagnose
    content: 先诊断根因——抓 KB 回复的 messages.json 看 committed references 是否为空，并现场区分「流式中未注入」vs「committed 后端没挂上」两种场景，再决定 FR-1 是否够
    status: completed
  - id: stream-refs
    content: 流式阶段在 tool_result 后即时把 pendingReferences 注入 __stream__ 渲染；覆盖 ChatPane 3 处 __stream__ 构造（terminal/clean/im）+ ChatView 一处
    status: completed
  - id: badge-visual
    content: 重做 CitationBadge — ima 风格绿色数字 pill（无方括号），hover/click Popover 展示摘录 + 来源文件名；绿色走新增主题 token，不硬编码
    status: completed
  - id: refs-card-kb
    content: ReferencesCard 在纯 KB 场景改用「找到了 N 篇知识库资料」+ 灰底绿字文件名列表（对齐 ima 图 2）
    status: completed
  - id: snippet-clean
    content: build_kb_references / 前端展示层剥离 score= 前缀，Popover 优先展示 chunk 正文摘录
    status: completed
  - id: kb-open
    content: agx://kb/ 引用点击 — 先确认是否已有打开知识库 Tab 的 hook；有则定位文档，无则降级 toast；web 仍走 openExternal
    status: completed
  - id: verify
    content: 优先测纯函数（formatReferenceSnippet / splitCitationSegments / kb snippet 无 score），辅以手工验收清单（流式/历史/三主题）
    status: completed
isProject: false
---

# 知识库角标溯源 ima 风格对齐

> Plan-Id: 2026-06-02-kb-citation-ima-style  
> Plan-File: `.cursor/plans/2026-06-02-kb-citation-ima-style.plan.md`  
> Owner: Damon  
> 前置：`2026-05-27-near-citation-references` Phase 1/2 已落地基础链路（`references` SSE、`ReferencesCard`、`CitationMarkdownBody`、`CitationBadge`）

## 背景与现象

用户反馈（见截图 1）：知识库检索回复正文里角标仍是纯文本 **`[1]`、`[2]`**，未变成可交互溯源 UI。

对照 **ima**（截图 2–3）期望：

| 区域 | ima | Near 当前 |
|------|-----|-----------|
| 顶部来源 | 「找到了 2 篇知识库资料」+ 灰底圆角列表，**绿色文件名** | 「已检索 N 个关键词，参考 M 篇资料」+ 搜索图标，偏 web 检索语义 |
| 正文角标 | **小绿色圆角 pill，仅数字 `1`**（无 `[]`） | 纯文本 `[1]`，或灰色 pill 显示截断标题 |
| hover 卡片 | 引号图标 + **摘录正文** + 分隔线 + **文件图标 + 绿色文件名** | 标题/域名 + snippet（含 `score=0.xxx` 噪声）+「打开原文」（KB 的 `agx://` 不可点） |

## 根因分析（关键不确定性，先诊断后动手）

正文出现纯文本 `[1]` 的**充要条件**是该条消息 `references` 为空。证据：`CitationMarkdownBody` 仅当 `references.length > 0` 才拆分 `[N]`，否则整段当 Markdown：

```38:40:desktop/src/components/messages/CitationMarkdownBody.tsx
const hasReferences = (references?.length ?? 0) > 0;
const segments = hasReferences ? splitCitationSegments(normalized) : [{ kind: "text" as const, value: normalized }];
```

> 即：只要 references 非空，`[1]` 一定会变成 `CitationBadge`（哪怕样式是旧灰 pill）。所以截图里**仍是字面量 `[1]`** ⟹ 那条消息 references 为空。

为什么为空？有两种场景，**当前无法仅凭截图断定**，必须先诊断（见 FR-0）：

### 场景 A：流式进行中未注入（前端缺口）

`ChatPane` 在 `tool_result` 时已累加 `pendingReferences`，但 `__stream__` 气泡只传 `content`（ChatPane 有 **3 处** `__stream__` 构造：terminal/clean/im，约 `5205/5214/5223` 行；`ChatView` 另有一处）：

```5223:5223:desktop/src/components/ChatPane.tsx
message={{ id: "__stream__", role: "assistant", content: streamTextForCurrentSession }}
```

→ 整个流式周期内角标都是纯文本，回合结束 `referenceExtrasFromTurn` 才补挂。FR-1 修这一场景。

### 场景 B：committed 消息后端就没挂上（后端缺口）

截图 1 顶部是**已折叠的 "Thought"**，更像**已完成**消息。若如此，FR-1 修不了它。但已核对的后端链路看起来是通的：

- KB 在 `auto` / `always` 模式都让模型**调用 `knowledge_search` 工具**（非 prompt 预注入）—— `meta_agent.py:486-490`
- `reset_turn_references` 每轮仅开头调用一次（`agent_runtime.py:1090`），不会中途清空
- 工具返回时 `structured_payload_for_tool_result` 构建 KB references（`agent_runtime.py:2646`）
- FINAL 时 `turn_reference_payload` 写入 `_hist_assistant["references"]`（`agent_runtime.py:1977`）并持久化（`session_manager.py:1343`）

链路理论上完整，所以场景 B 若复现，需用 FR-0 抓 `messages.json` 定位**实际断点**（可能的嫌疑：模型只总结未真正调用工具 / 工具返回 `ok:false` / hits 为空但模型仍编号 / 群聊路径不经此链路）。**在 FR-0 给出结论前，FR-1 之外不预设后端改动。**

### 视觉与交互未对齐 ima（独立于 A/B，确定要做）

- `CitationBadge`：resolved 态 label 用 **title 截断**而非数字；灰色 zinc 主题，非 ima 绿色 pill。
- Popover：无引号装饰、snippet 混 score 元数据、KB 无「打开文档」动作。
- `ReferencesCard`：copy/图标偏 web_search，KB-only 场景信息架构不匹配。

## 目标（Goal）

1. **功能**：只要 `knowledge_search`/`web_search` 返回 structured references，正文 `[N]` 必须渲染为可 hover 的角标（流式 + 历史一致）。
2. **视觉**：KB 场景对齐 ima——绿色数字 pill、顶部资料列表、hover 摘录卡。
3. **范围**：仅 Desktop 聊天气泡链路（`ImBubble` / `CleanBlock` / `TerminalLine` + `ChatPane`/`ChatView` SSE）；不改 Enterprise portal。

## 架构方案

```
tool_result (structured.references)
    → accumulateReferenceTurn (已有)
    → 【新增】streamReferencesRef + setStreamReferencesState
    → __stream__ message.references 即时可见
    → 回合结束 referenceExtrasFromTurn 写入 committed message (已有)

CitationMarkdownBody
    → split [N] → CitationBadge (ima pill)
    → hover → CitationPopover (摘录 + 来源)

ReferencesCard
    → kb-only / mixed 分支文案与列表样式
```

---

## FR-0 诊断（动手前必做，1–2h）

**目的：** 区分场景 A / B，避免在错误假设上写代码。

**步骤：**

1. 在 Meta 单聊启用 KB，提一个**确定命中**的问题，**录屏**观察：
   - 流式过程中 `[1]` 是否纯文本？
   - 回合**结束瞬间**是否跳变为 pill / 出现 references 卡？
   - → 若「流式纯文本、结束变 pill」= **纯场景 A**（FR-1 足够）。
   - → 若「结束后仍纯文本」= 命中**场景 B**，继续步骤 2。
2. 打开该 session 的 `~/.agenticx/sessions/<id>/messages.json`，定位该 assistant 条目：
   - 有 `references` 字段？→ 前端渲染/映射 bug（查 `session-message-map.ts:144`）。
   - 无 `references`？→ 后端未挂；继续步骤 3。
3. 抓 `agx serve` 日志看本轮是否真有 `knowledge_search` 的 `tool_result`、`structured.references` 是否非空：
   - 模型只总结未调用工具 → 属 prompt/模型行为，另案（不在本 plan）。
   - 工具调用了但 `structured` 为空 → 查 `build_kb_references`（hits 结构 / `ok` / `disabled`）。

**产出：** 在本 plan 末尾「诊断结论」记一行：根因 = A / B / A+B，并据此确认 FR-1 之外是否需要后端补丁。

**AC：**

- AC-0.1：明确给出根因归类与证据（messages.json 片段或日志行），后续 FR 据此执行。

---

## FR-1 流式即时注入 references（修场景 A）

**Files:**

- Modify: `desktop/src/components/ChatPane.tsx`（**3 处** `__stream__` 构造：`~5205` terminal / `~5214` clean / `~5223` im）
- Modify: `desktop/src/components/ChatView.tsx`（Lite 模式对称，`~1103` pendingReferences）

**实现要点：**

1. 在 sendChat SSE 循环旁新增 `streamReferencesRef` + 轻量 state（仅 `tool_result` 时 setState，文本仍走现有 RAF 节流，避免每 token 重渲染）。
2. `tool_result` 分支：当前在 `accumulateReferenceTurn` 后 `continue`，只需在 `continue` 前把 `accumulated.references / queries` 同步进 ref/state（不破坏现有累加逻辑）。
3. **3 处 `__stream__` 构造统一补字段**（抽一个 `streamMessage` 局部对象复用，避免漏改其一）：
   ```tsx
   const streamMessage = {
     id: "__stream__",
     role: "assistant" as const,
     content: streamTextForCurrentSession,
     references: streamReferences,
     searchedQueries: streamSearchedQueries,
   };
   ```
4. 回合开始时清空 stream references state（与后端 `reset_turn_references` 对齐）。
5. 回合结束 committed 消息仍走现有 `referenceExtrasFromTurn`（双写无害，final 为权威）。

**AC：**

- AC-1.1：`knowledge_search` 返回后、模型仍在流式输出时，已出现的 `[1]` 立即变为 pill（无需等整轮结束）。
- AC-1.2：流式结束后 committed 消息 references 与流式一致，刷新 session 仍保留。
- AC-1.3：terminal / clean / im 三种 chatStyle 流式态行为一致（不能只修 im）。

---

## FR-2 ima 风格 `CitationBadge` + `CitationPopover`

**Files:**

- Modify: `desktop/src/components/messages/CitationBadge.tsx`
- Create: `desktop/src/components/messages/CitationPopover.tsx`（从 Badge 拆出，便于测试）
- Optional: `desktop/src/components/messages/citation-styles.ts`（token 常量，避免硬编码散落）

**视觉 spec（对齐 ima，适配 dark/dim/light）：**

**配色决策（重要，避免硬编码 / 与主题冲突）：**

- ima 角标是固定绿色，但 Near 现有 citation 用的是 `--theme-color-rgb`（随分身 accent 变）。本次**为 KB 引用引入专用 token**，不复用 accent、也不散落硬编码：
  - 在主题样式表（`desktop/src/index.css` 或对应 theme tokens）新增 `--kb-citation-bg` / `--kb-citation-fg`，按 dark/dim/light 三套给值（绿色系）。
  - web 引用可继续用 accent 色或同一套，FR-0/实现时再定；KB 优先绿色对齐 ima。
- 验收要求三主题对比度可读，禁止只在 dark 下好看。

| 元素 | 样式 |
|------|------|
| Pill | `h-[18px] min-w-[18px] px-1 rounded-[4px]`；背景/文字走 `--kb-citation-bg` / `--kb-citation-fg`（绿色系，三主题各一套） |
| 内容 | **始终显示数字** `id`，不显示 title 截断 |
| 未 resolve | 同色 pill 略淡 + `cursor-default`（占位，非 `[1]` 文本） |
| Popover 宽 | `min(320px, calc(100vw - 2rem))`，白/.surface 底，圆角 12px，轻 shadow |
| Popover 顶 | 灰色 `"` 装饰（lucide `Quote` 或 CSS） |
| Popover 中 | `line-clamp-5` 摘录（见 FR-4） |
| Popover 底 | 分隔线 + 文件类型小图标（按扩展名：pdf/docx/md）+ **绿色 filename**（`reference.title`） |
| 交互 | desktop：`hover` 打开（`onMouseEnter`/`Leave` + 150ms debounce）；touch：`click` toggle；点击文件名触发 FR-5 |

**实现约束：**

- 继续用 `splitCitationSegments` 前置拆分（已稳定），**不**引入 remark 插件（YAGNI）。
- Popover 定位：优先 `bottom-full`；靠近视口边缘时 flip（简单 clamp 即可，不必引 Radix 除非已有依赖）。
- 移除当前全屏遮罩 click-outside（ima 为轻量 hover 卡）；保留 Esc / 失焦关闭。

**AC：**

- AC-2.1：正文中 `[1]` 显示为绿色数字 pill，**无方括号**。
- AC-2.2：hover 出现摘录 + 底部绿色文件名，三主题可读。
- AC-2.3：`references` 缺失时 pill 为占位态，不渲染 `[1]` 字面量。

---

## FR-3 `ReferencesCard` KB 场景改版

**Files:**

- Modify: `desktop/src/components/messages/ReferencesCard.tsx`

**规则：**

| 条件 | 顶部文案 | 列表样式 |
|------|----------|----------|
| 仅 `source === "kb"` | `找到了 ${n} 篇知识库资料` | 灰底圆角容器 `rounded-lg bg-zinc-100/80 dark:bg-white/5`，有序列表，**文件名绿色** `text-emerald-700`，无 Search 图标 |
| 含 web | 保留现有「已检索…参考…」+ Search 图标 | web/kb 分组不变 |
| 混合 | 顶部用混合文案：`参考 ${n} 篇资料（含知识库 ${kbCount} 篇）` | kb 组用 ima 列表，web 组保持链接样式 |

**AC：**

- AC-3.1：纯 KB 回复顶部卡片与 ima 截图 2 信息架构一致（可折叠 chevron 保留）。
- AC-3.2：列表项点击 KB 文档触发 FR-5。

---

## FR-4 摘录文本清洗

**Files:**

- Modify: `agenticx/studio/references.py` — `build_kb_references`
- Create: `desktop/src/utils/reference-snippet.ts` + test

**后端：**

- `snippet` 字段改为 **纯 chunk 文本**（`snippet_trim(hit.text)`），score 移到可选字段 `meta_scores` 或不再写入 snippet。
- 保持 JSON schema 向后兼容（前端仍读 `snippet`）。

**前端：**

- `formatReferenceSnippet(ref)`：剥离遗留 `score=…` / `fused=` 行（正则），Popover 与 Card 预览共用。

**AC：**

- AC-4.1：Popover 摘录不再出现 `score=0.812` 前缀。

---

## FR-5 KB 来源打开（最小可行）

**Files:**

- Create: `desktop/src/utils/open-kb-reference.ts`
- Modify: `CitationBadge.tsx` / `ReferencesCard.tsx`
- Optional: `SettingsPanel` 暴露 `openKnowledgeTab({ highlightDocId })` via store/event（若已有 settings route 则复用）

**前置确认（实现前先查，决定能做到哪一档）：**

- 是否已有「编程方式打开设置面板并切到知识库 Tab」的入口？（`SettingsPanel` 的 `tab` 状态如何被外部驱动——store / 全局事件 / props？`ChatPane` 现有打开设置的方式是什么？）
- 知识库文档列表（`settings/knowledge/`）是否支持按 `doc_id` / 路径定位/高亮某行？

**行为（按已有能力降级）：**

- 解析 `agx://kb/{doc_id}#{chunk}` → `doc_id`
- **若有定位 hook**：打开设置 → 知识库 Tab 并 scroll/highlight 目标文档行。
- **若无现成 hook**：仅打开知识库 Tab（不定位）或直接 toast「请在设置 → 知识库中查看：{title}」——**不为此新建复杂高亮链路**（避免 scope creep）。
- **不做**：内嵌 PDF 预览器、chunk 级跳转、KB 查看器（Out of Scope）。

**AC：**

- AC-5.1：点击 KB 引用至少能到达知识库文档区域并提示目标文件名（定位为加分项，非硬性）。
- AC-5.2：`https://` web 引用仍走 `openExternalUrl`。

---

## FR-6 测试与回归

**Files（优先纯函数测试，hover/Popover 交互靠手工验收，不强求 jsdom 模拟）：**

- Create: `desktop/src/utils/reference-snippet.test.ts`（`formatReferenceSnippet` 剥离 `score=` / `fused=` 等遗留前缀，兼容旧数据）
- Extend: `desktop/src/components/messages/citation-normalize.test.ts`（`splitCitationSegments` 边界：连续 `[1][2]`、无 references 时不渲染）
- Extend: `tests/test_smoke_search_references.py`（`build_kb_references` 的 snippet 为纯 chunk 文本、无 `score=` 前缀）

**手工验收：**

1. Meta 单聊 → 启用 KB → 提问命中 → 流式过程中角标变 pill
2. 回合结束 → 重启 App → 历史消息角标 + 顶部资料卡仍正常
3. dark / dim / light 三主题 Popover 对比度
4. `web_search` + `knowledge_search` 混合回合编号连续、角标不歧义
5. 无 references 的旧消息：`[1]` 保持纯文本（向后兼容）

---

## 非范围（Out of Scope）

- Enterprise web-portal 聊天引用 UI
- favicon / 域名图标
- 来源 URL 去重合并
- 知识库 chunk 内嵌阅读器 / PDF.js
- 修改模型 prompt 引用协议（`meta_agent.py` 已有 `[N]` 规范，保持不变）
- `ToolCallCard` 内 knowledge_search 文本摘要（仍折叠/静默，references 走卡片）
- 群聊 / 多分身 workforce 路径的引用渲染（本 plan 聚焦 Meta 单聊主链路；群聊若也走 `ImBubble` 则视觉自动受益，但不专门为群聊补后端 references 链路——若 FR-0 发现群聊不经此链路，单列后续）
- 「模型只总结未真正调用 `knowledge_search`」这类模型行为问题（属 prompt/路由，另案）

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 流式 references state 导致额外重渲染 | ref 持有数据，仅 tool_result 时 setState；文本仍走 RAF 节流 |
| Popover 被气泡 `overflow:hidden` 裁切 | portal 到 `document.body`（若裁切复现再加） |
| 后端 snippet 变更影响旧历史 | 前端 `formatReferenceSnippet` 兼容旧数据 |

## 提交协议

- 建议 2 个 commit：
  1. `fix(desktop): inject stream references for citation badges`（FR-1）
  2. `feat(desktop): ima-style kb citation popover and references card`（FR-2–5）
- 每个 commit 含：
  ```
  Plan-Id: 2026-06-02-kb-citation-ima-style
  Plan-File: .cursor/plans/2026-06-02-kb-citation-ima-style.plan.md
  Made-with: Damon Li
  ```

## 诊断结论（FR-0 完成后回填）

> 根因 = （A / B / A+B）：________  
> 证据：________（messages.json 片段或 agx serve 日志行）  
> 据此确认 FR-1 之外是否需要后端补丁：________

## 工作量估算（含 FR-0）

| 块 | 耗时 |
|----|------|
| FR-0 诊断 | 1–2h |
| FR-1 流式 references | 0.5d |
| FR-2 角标 + Popover | 0.5d |
| FR-3 ReferencesCard KB | 0.25d |
| FR-4 snippet 清洗 | 0.25d |
| FR-5 KB 打开 MVP | 0.25d |
| FR-6 测试验收 | 0.25d |
| **合计** | **~2d** |

## 下一步

- [ ] 用户确认 plan 后先做 **FR-0 诊断**，按结论调整 FR 范围
- [ ] 再按 FR-1 → FR-2 → FR-3 顺序实施（功能优先，视觉跟进）
- [ ] 完成后 `/update-conclusion --plan=.cursor/plans/2026-06-02-kb-citation-ima-style.plan.md`
