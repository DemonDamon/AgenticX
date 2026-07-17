# Near 决策项按需多选实施计划

Planned-with: GPT-5.6 Sol

Suggested-Impl-Model: Cursor Grok 4.5 Medium

> 该任务是现有 `request_clarification` HITL 链路的聚焦增量。实施模型只需阅读本计划，不依赖本次对话上下文。

## 目标

让结构化 `decisions[]` 中的每个决策显式声明单选或多选；旧 payload 继续保持单选。多选决策可以声明排他选项，例如选中「直接采用上面草案」时自动清除「补充硬件监控」「补充模型架构设计」等组合项。

## 根因与证据链

当前链路已经存在两套隐式语义：

- `agenticx/cli/agent_tools.py` 的顶层 `options` schema 声明用户可以多选。
- 同文件 `decisions[].options` 明确写为 `mutually exclusive`。
- `desktop/src/components/messages/ClarificationCard.tsx` 使用 `Set<string>` 保存顶层选项，却使用 `Record<string, string>` 保存每项 decision，因此 grouped mode 永远只能单选。
- 截图中的「补充硬件监控/集群运维能力」与「补充模型架构设计能力」可以同时成立，单选会丢失用户意图；但「直接采用上面草案」又应与补充项互斥。

因此不能把 grouped mode 全局改成多选。必须在 decision 协议中增加显式选择模式，并为多选提供可选的排他项约束。

## 协议设计

### Before

```json
{
  "id": "system-prompt-adjustment",
  "question": "系统提示是否需要调整？",
  "options": [
    "直接采用上面草案",
    "需要补充硬件监控/集群运维能力",
    "需要补充模型架构设计能力",
    "我来调整（自由文本说明）"
  ]
}
```

所有 `decisions[]` 均按单选处理。

### After

```json
{
  "id": "system-prompt-adjustment",
  "question": "系统提示是否需要调整？",
  "options": [
    "直接采用上面草案",
    "需要补充硬件监控/集群运维能力",
    "需要补充模型架构设计能力"
  ],
  "selection_mode": "multiple",
  "exclusive_options": ["直接采用上面草案"]
}
```

字段约束：

- `selection_mode?: "single" | "multiple"`：缺省或非法值必须回落为 `"single"`，保证旧调用和历史消息行为不变。
- `exclusive_options?: string[]`：仅在 `multiple` 下生效；值必须与 `options` 中的完整字符串精确匹配，归一化时过滤不存在项、空项和重复项。
- 不新增 `min_selections` / `max_selections`。本期维持“每项至少选择一个选项或填写自定义回复”的现有提交门槛，避免无实际需求的协议扩张。
- 顶层 flat `options` 继续保持现有多选语义，不受此改动影响。

## In scope

- 扩展 `request_clarification.decisions[]` tool schema 与 Meta-Agent 调用说明。
- Python 归一化层校验并透传 `selection_mode`、`exclusive_options`。
- Desktop 类型、持久化恢复解析和 inline `ClarificationCard` 支持 per-decision 单选/多选。
- 多选排他逻辑、答案序列化、旧 payload 兼容测试。
- 更新原有 Python/TypeScript 单元测试并执行 Desktop build。

## Out of scope

- 不修改 `POST /api/clarify`、`ClarifyResponse` 或 gate answer 的 `{answer_text, selected_options}` 结构。
- 不把答案改成新的结构化 JSON；继续使用现有自然语言 `"问题：选项"` 编码。
- 不修改权限确认 `confirm_required`、`request_action_confirmation` 或自动放行策略。
- 不重构子智能体当前使用的 legacy `ClarificationDialog`；本计划只覆盖截图所示的 inline `ClarificationCard` 决策链。
- 不顺手修复 `AsyncClarifyGate.last_request` / `team_manager.pending_clarification` 尚未保存 `decisions` 的既有缺口。
- 不改群聊路由、会话状态机、SSE 事件名和 Studio API。

## FR / NFR

### FR-1：声明选择模式

`agenticx/cli/agent_tools.py` 的 `STUDIO_TOOLS` → `request_clarification` → `decisions.items.properties` 增加：

```python
"selection_mode": {
    "type": "string",
    "enum": ["single", "multiple"],
    "description": "Selection behavior for this decision. Defaults to single.",
},
"exclusive_options": {
    "type": "array",
    "items": {"type": "string"},
    "description": (
        "Exact option labels that cannot be combined with other selections. "
        "Only used when selection_mode is multiple."
    ),
},
```

同时把 `options` 文案从固定 `mutually exclusive` 改为由 `selection_mode` 决定。

### FR-2：后端归一化

在 `agenticx/cli/agent_tools.py::_normalize_clarification_decisions()` 中：

1. `selection_mode = "multiple"` 仅在原值严格等于 `"multiple"` 时成立，其余一律为 `"single"`。
2. 先归一化 `options`，并保持现有最多 8 项限制。
3. 将 `exclusive_options` 归一化为去空白、去重、保持原顺序且属于 `options` 的字符串列表。
4. `single` 模式强制输出 `exclusive_options: []`，避免前端误应用。
5. 每个归一化 decision 固定输出：

```python
{
    "id": decision_id,
    "question": question,
    "options": options,
    "selection_mode": selection_mode,
    "exclusive_options": exclusive_options,
}
```

`_request_clarification()`、SSE 和 `_persist_clarification_prompt()` 已整体透传 `decisions`，不得为此改写 `agenticx/studio/server.py`。

### FR-3：模型调用说明

修改 `agenticx/runtime/prompts/meta_agent.py` 中“向用户提问”段落的 `request_clarification` 调用要点：

- 默认不写 `selection_mode`，表示互斥单选。
- 同一决策内允许组合选择时写 `selection_mode: "multiple"`。
- “采用默认方案/无需调整”这类不能与补充项并存的选项，写入 `exclusive_options`。
- 禁止为了多选而把多个独立决策维度重新压回顶层 flat `options`。

### FR-4：Desktop 类型与恢复

修改：

- `desktop/src/store.ts::ClarificationDecision`
- `desktop/src/utils/clarification-notice.ts::ClarificationDecisionPayload`
- `desktop/src/utils/clarification-notice.ts::parseClarificationDecisions()`

新增字段：

```ts
selectionMode: "single" | "multiple";
exclusiveOptions: string[];
```

解析规则必须与 Python 一致：

- `rec.selection_mode === "multiple"` 才是多选，否则为单选。
- `exclusive_options` 只保留存在于 `options` 的唯一字符串。
- `single` 模式的 `exclusiveOptions` 固定为空数组。
- `inferClarificationDecisions()` 生成的 legacy decision 显式使用 `selectionMode: "single"`、`exclusiveOptions: []`。

由于 `clarificationPayloadFromMeta()`、`clarification-inline.ts` 和 `session-message-map.ts` 已统一调用 `parseClarificationDecisions()`，新字段应通过解析器自然进入实时卡片和历史恢复；不要在这些调用方重复写解析逻辑。

### FR-5：按 decision 切换选择行为

修改 `desktop/src/components/messages/ClarificationCard.tsx`：

1. 将 `selectedByDecision` 从 `Record<string, string>` 改为 `Record<string, string[]>`。
2. `decisionAnswered()` 判断该 decision 的数组是否至少有一项，或存在自定义回复。
3. 用一个纯函数实现选项切换，建议放在 `desktop/src/utils/clarification-notice.ts` 并导出，便于 Vitest 直接验证：

```ts
toggleDecisionSelection(
  decision: ClarificationDecisionPayload,
  current: string[],
  option: string,
): string[]
```

行为必须满足：

- `single`：点击未选项后仅保留该项；再次点击已选项后清空，保持当前可取消选择体验。
- `multiple` 普通项：切换该项；选中普通项前清除当前已选排他项。
- `multiple` 排他项：选中时仅保留该项；再次点击时清空。
- 结果顺序按 `decision.options` 原始顺序稳定输出，不按点击顺序输出。

4. UI 的 `role` 与文案随模式变化：
   - single：`role="radiogroup"` / 子按钮 `role="radio"`。
   - multiple：容器 `role="group"` / 子按钮 `role="checkbox"`。
   - decision 标题右侧以低噪音文字显示“可多选”，单选不增加标签。
5. footer 从固定“每项决策选一项”改为“完成每项决策后提交”；当本卡存在多选 decision 时补充“标记为可多选的决策可组合选择”。

### FR-6：答案序列化

`ClarificationCard.tsx::buildAnswer()` 对每个 decision 读取字符串数组：

- 单选示例：`系统提示是否调整？：直接采用上面草案`
- 多选示例：`系统提示是否调整？：补充硬件监控、补充模型架构设计`
- 有自定义补充：`系统提示是否调整？：补充硬件监控、补充模型架构设计（补充：重点覆盖 GPU 集群）`
- 只有自定义文本时维持：`系统提示是否调整？：重点覆盖 GPU 集群`

每个 decision 仍只生成一个 `selectedOptions` 元素，多个选项在该元素内部用中文顿号 `、` 拼接。因此后端 `build_clarification_tool_result()`、API 和持久化 answer schema 均无需修改。

### NFR-1：向后兼容

- 历史 `decisions` 无新字段时必须渲染为单选。
- 顶层 flat options 多选保持不变。
- 已持久化的 answered card 和旧 `selected_options` 文本不做迁移。
- `allow_free_text` 行为不变，选项与自定义补充仍可同时提交。

### NFR-2：范围与质量

- 不新增 npm/Python 依赖。
- 不使用 `any`；所有 TypeScript union 必须显式收窄。
- Python 新增注释/docstring 仅使用英文。
- 不改 `agenticx/studio/server.py`，避免触碰本地后端敏感入口。

## 实施步骤（TDD）

### Task 1：先锁定后端协议兼容

Files:

- Modify: `tests/test_request_clarification.py`，在现有 import 中加入 `_normalize_clarification_decisions`
- Modify: `agenticx/cli/agent_tools.py::STUDIO_TOOLS`
- Modify: `agenticx/cli/agent_tools.py::_normalize_clarification_decisions`
- Modify: `agenticx/runtime/prompts/meta_agent.py` 的 human-in-the-loop 段落

Steps:

1. 新增测试：缺省模式为 single；multiple + 合法排他项保留；未知模式回退 single；不存在/重复排他项被过滤。
2. 运行失败测试：

```bash
pytest -q tests/test_request_clarification.py
```

Expected before implementation: 新断言因缺少 `selection_mode` / `exclusive_options` 失败。

3. 实现最小 schema 与 normalize 逻辑。
4. 更新 Meta prompt。
5. 重跑同一命令，Expected: all passed。

### Task 2：先锁定 Desktop 解析与选择状态机

Files:

- Modify: `desktop/src/utils/clarification-notice.test.ts`
- Modify: `desktop/src/utils/clarification-notice.ts`
- Modify: `desktop/src/store.ts::ClarificationDecision`

Steps:

1. 为 `parseClarificationDecisions()` 新增四组断言：
   - legacy decision → single + 空排他项；
   - multiple + 合法排他项；
   - 非法模式 → single；
   - 排他项过滤、去重与 options 顺序兼容。
2. 为纯函数 `toggleDecisionSelection()` 新增断言：
   - single 互斥与再次点击取消；
   - multiple 累加与取消；
   - 排他项清空普通项；
   - 普通项清空排他项；
   - 输出始终按 options 顺序。
3. 新增 metadata restore 断言，确认 `clarificationPayloadFromMeta()` 保留多选字段。
4. 运行失败测试：

```bash
cd desktop && npx vitest run src/utils/clarification-notice.test.ts
```

5. 实现类型、解析器和纯函数。
6. 重跑同一命令，Expected: all passed。

### Task 3：接入 inline 决策卡

Files:

- Modify: `desktop/src/components/messages/ClarificationCard.tsx`

Steps:

1. 按 FR-5 将 grouped state 改为数组并接入 `toggleDecisionSelection()`。
2. 按 FR-5 更新 ARIA 角色、“可多选”提示与 footer。
3. 按 FR-6 更新 grouped answer 文本编码。
4. 不修改 flat mode 的 `selectedFlat`、`toggleFlatOption()` 和渲染分支。
5. 运行：

```bash
cd desktop && npx vitest run src/utils/clarification-notice.test.ts
cd desktop && npm run build
```

Expected: Vitest passed；Vite build 与 Electron TypeScript compile 均成功。

### Task 4：全量聚焦验收

Run:

```bash
pytest -q tests/test_request_clarification.py
cd desktop && npx vitest run src/utils/clarification-notice.test.ts
cd desktop && npm run build
```

手工验收 payload：

```json
{
  "prompt": "请确认系统提示调整范围",
  "decisions": [
    {
      "id": "scope",
      "question": "系统提示是否需要调整？",
      "options": ["直接采用上面草案", "补充硬件监控", "补充模型架构设计"],
      "selection_mode": "multiple",
      "exclusive_options": ["直接采用上面草案"]
    },
    {
      "id": "tone",
      "question": "整体语气选择？",
      "options": ["专业克制", "轻松活泼"]
    }
  ],
  "allow_free_text": true
}
```

验收点：

- scope 可同时选择两个补充项。
- 选择「直接采用上面草案」后两个补充项自动取消。
- 已选「直接采用上面草案」时再选普通项，排他项自动取消。
- tone 仍只能单选。
- 刷新/切换会话后，未回答卡从持久化 metadata 恢复相同模式。
- 提交给后端的 `selected_options` 包含 `系统提示是否需要调整？：补充硬件监控、补充模型架构设计`。

## AC（验收标准）

- AC-1：`decisions[].selection_mode="multiple"` 时，同一 decision 可选择多个非排他项。
- AC-2：`exclusive_options` 中的选项与同 decision 其他选项绝不同时处于选中态。
- AC-3：缺少或传入非法 `selection_mode` 时，行为与现有版本一致，仍为单选。
- AC-4：顶层 flat `options` 仍可多选，无回归。
- AC-5：多选结果以单个 `"问题：A、B"` 字符串进入现有 `selected_options`，`POST /api/clarify` 无协议变更。
- AC-6：实时 SSE 卡片和历史恢复卡片使用同一解析结果。
- AC-7：Python 聚焦测试、Desktop Vitest 与 Desktop build 全部通过。
- AC-8：改动仅限本计划列出的文件，不触碰 `agenticx/studio/server.py` 和 legacy `ClarificationDialog`。

## 提交要求

实施完成后只暂存本计划及本计划列出的实际改动文件。commit trailer 必须按以下顺序填写，实际实施模型由执行者确认，不得猜测：

```text
Plan-Id: 2026-07-17-clarification-decision-multiselect
Plan-File: .cursor/plans/2026-07-17-clarification-decision-multiselect.plan.md
Plan-Model: GPT-5.6 Sol
Impl-Model: Cursor Grok 4.5 Medium
Made-with: Damon Li
```
