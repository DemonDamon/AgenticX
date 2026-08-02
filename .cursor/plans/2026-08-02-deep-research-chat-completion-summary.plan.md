# 深度调研收尾：聊天区改完成摘要，终稿只落产物

Planned-with: cursor-grok-4.5
Suggested-Impl-Model: `composer-2.5-fast`（改 orchestrator 流式路径 + 一段摘要拼装 + 前端隐藏重复正文，边界清晰）
Parent-Plan: `.cursor/plans/2026-08-02-deep-research-kimi-parity.plan.md`

---

## 0. 一句话

深度调研结束后，**左侧聊天不应再整篇复述 `final-report.md`**；应改成「做完了什么 + 产物在哪」的收尾摘要，完整报告只出现在右侧产物预览 / 交付卡片。

## 1. 根因与证据链

### 证据 1：撰写阶段把全文当 SSE delta 灌进会话正文
`orchestrator.ts` 在 synthesize 里对标题、目录、每一节都调用 `enqueueDelta`（约 `L1186–L1214`），
而 `enqueueDelta`（`L502`）会写出 OpenAI 风格 `choices[0].delta.content`——前端把它累加进
`message.content`，于是左侧聊天气泡出现整篇报告。

同一段文本随后又写入 `research/<runId>/final-report.md`（`L1238–L1258`），右侧预览打开的就是这份 artifact。
**左 = 右，纯重复。**

### 证据 2：交付条已经在正文下方再挂一遍终稿卡片
`MessageList.tsx:888–898` 在正文之后渲染 `DeepResearchDelivery`（终稿卡 + 全部文件 + 导出）。
若正文仍是全文，用户会看到「全文气泡 + 终稿卡 + 右侧预览」三重重复。

### 证据 3：期望体验（外部对照，仅作产品动机，不进 commit 文案）
完成态应是：简短「完成情况」+ 文件树/路径说明 + 可点开的产物入口；**不是**把报告再打印一遍。

---

## 2. In scope / Out of scope

### In scope
- 改 `orchestrator.ts`：synthesize **不再**把终稿正文 `enqueueDelta` 到聊天；仍写入 artifact / run-store 报告缓冲
- 新建 `completion-summary.ts`：根据 outline / stats / artifact 路径拼装收尾 Markdown
- 完成后 `enqueueDelta` **仅**推送该摘要（短）
- 前端：`DeepResearchDelivery` 文案微调（可选）；单测覆盖「聊天内容不含全文标题堆叠」
- 相应 `orchestrator.test.ts`

### Out of scope（**违反即回退**）
- 不改检索 / clarify / lane / page-fetch 逻辑
- 不改 `final-report.md` / HTML / 导出格式本身
- 不做「推送到 GitHub 仓库」类能力（对照产品有、本产品无）
- 不在撰写过程中向聊天流式「假进度正文」；进度继续只走 `phase` / workbench events
- 不引入新依赖

---

## 3. FR-1：撰写阶段静默落盘，不灌聊天

**改** `orchestrator.ts` 的 `streamSectionInto` 与 synthesize 循环。

### Before（意图）
```typescript
// 每个 delta 既进 reportContentParts，又 enqueueDelta → 聊天全文
if (typeof piece === "string") {
  sectionParts.push(piece);
  reportContentParts.push(piece);
  writer?.pushReport(piece);
}
safeControllerEnqueue(encoder.encode(`${frame}\n\n`)); // 含 delta
```

### After（意图）
```typescript
// 报告正文只进内存 + run-store；转发 SSE 时剥离 choices[].delta.content
// 或：不把含 content delta 的 frame 转给 transport，只 writer?.pushReport + 本地累加
if (typeof piece === "string") {
  sectionParts.push(piece);
  reportContentParts.push(piece);
  writer?.pushReport(piece);
}
// 不再 enqueueDelta(title/toc/heading/section)
// 对 upstream 的非报告控制帧（如 usage）仍可透传；纯 content delta 不进聊天
```

实现时优先选**更干净**的一种，二选一写死在代码里并测：

**方案 A（推荐）**：synthesize 阶段完全不 `enqueueDelta` 报告文本；`streamSectionInto` 只累加字符串 + `writer.pushReport`，不把 content delta 帧 `safeControllerEnqueue`。

**方案 B**：仍 enqueueDelta，前端在 `deep_research.status === "completed"` 时隐藏 `message.content`——**禁止采用**，因为历史消息会永久存下巨量重复正文，且流式阶段仍会刷屏。

### AC-1
`orchestrator.test.ts`：
- 完成后 SSE 聚合出的聊天 `text` **不含**完整 `# 标题` + 多节 `##` 长文（允许含摘要里的短标题提及）
- `artifact` 事件仍有 `final-report.md`（或等价 path）
- run-store / `writer.pushReport` 路径仍能拼出完整报告（若测试可观测）

---

## 4. FR-2：收尾摘要（LLM 生成，非固定模板）

**新建** `enterprise/apps/web-portal/src/lib/deep-research/completion-summary.ts`。

固定模板会显得机械，与「高度智能」的产品调性不符。改为 LLM 生成自然语言摘要，
仅保留**结构化约束**（必须出现的关键信息）+ **兜底模板**（LLM 失败时用）。

### 契约
```typescript
export type CompletionSummaryInput = {
  topic: string;
  outline: { title: string; sections: Array<{ title: string; brief: string }> };
  stats: {
    queriesPlanned: number;
    urlsDiscovered: number;
    sourcesSelected: number;
    pagesFetched: number;
    citationCount: number;
  };
  artifacts: Array<{ path: string; title: string; kind: string }>;
  runId: string;
};

export type CompletionSummaryDeps = {
  callJson: (messages: Array<{ role: string; content: string }>) => Promise<string>;
};

export const COMPLETION_SUMMARY_MAX_CHARS = 1_600;

/** LLM 生成；失败/空时回落到 fallbackSummary()。 */
export async function buildCompletionSummary(
  input: CompletionSummaryInput,
  deps: CompletionSummaryDeps,
): Promise<string>;

/** 极简兜底，不调模型。 */
export function fallbackSummary(input: CompletionSummaryInput): string;
```

### LLM 摘要要求（system prompt）
- 用与用户提问相同的语言；Markdown；≤ 600 字
- 必须包含三块信息，但措辞与详略由模型据实决定：
  1. **本次做了什么**：基于 outline.sections 的 title/brief 与 stats，自然概括调研覆盖范围与关键发现（不是堆数字）
  2. **关键结论亮点**：从 outline 提炼 2–4 条最具价值的结论（若有证据编号则带 [N]）
  3. **产物在哪**：列出实际产生的 artifact 路径（仅列存在的），指引用户在右侧 / 交付卡片打开
- 禁止复述整篇报告正文；禁止编造未出现的文件
- 输出纯正文，不要 ```markdown 围栏

### 兜底模板（LLM 失败时）
极简、不假装智能：
```markdown
🎉「{topic}」深度调研完成。

本次规划检索 {queriesPlanned} 次、选用来源 {sourcesSelected} 个、抓取正文 {pagesFetched} 篇，
共 {citationCount} 个引用。报告章节：{sectionTitles 顿号连接，最多 8}。

产物：{实际 artifact 路径列表}。完整正文请打开 final-report.md。
```

### 接线
synthesize 全部 artifact 写完、`finalizeReportArtifacts` 返回后：
```typescript
const summary = await buildCompletionSummary(
  { topic, outline, stats, artifacts: producedArtifacts, runId },
  { callJson: (messages) => callGatewayJson(toolDeps, { ...baseBody, messages }) },
);
enqueueDelta(summary);
```
然后再 `phase: done`。

`producedArtifacts` 由本轮 `artifact` 事件累积（含 final-report.md / report.html / mindmap 等）。

### AC-2
`completion-summary.test.ts`：
- LLM 返回正常文本时，摘要等于该文本（截断到上限）
- LLM 返回空 / 抛错时，回落 `fallbackSummary`，含 topic 与 `final-report.md`（若 artifact 存在）
- 无 `final-report` artifact 时，兜底不写该路径
- 摘要长度 ≤ `COMPLETION_SUMMARY_MAX_CHARS`

---

## 5. FR-3：前端呈现

**改动极小**：
- `DeepResearchDelivery` 注释从「放在报告正文之后」改为「放在完成摘要之后」
- 可选：`MessageList` 在 `deep_research` 完成且 content 已是摘要时保持现状（摘要 + 交付卡）即可
- **不要**在前端再藏一份全文——源头已不推全文

### AC-3
手工 / 单测：
- 完成后左侧可见摘要 + 交付卡，**不可**再出现与右侧 `final-report.md` 同构的长文
- 点交付卡 / 全部文件仍能打开终稿

---

## 6. 验收

```bash
cd enterprise/apps/web-portal
pnpm exec vitest run src/lib/deep-research
```

### 人工
- 跑一轮深度调研：左侧收尾是摘要风格；右侧打开 `final-report.md` 仍是完整报告
- 导出 HTML/MD/DOCX 内容仍完整

## 7. 已知限制
- 撰写过程中聊天区不再「长文流式打字」；用户靠 workbench 的 phase / lane 进度感知仍在写报告（与对照产品「先过程卡、后摘要」一致）
- 旧会话里已落库的全文 `message.content` **不回溯清洗**（仅新 run 生效）
