# StickyTaskBar 旧任务残留与进度诚实化

Plan-Id: 2026-06-01-sticky-task-bar-stale-and-honest-progress
Plan-File: .cursor/plans/2026-06-01-sticky-task-bar-stale-and-honest-progress.plan.md

## 背景 / 问题

Pro 模式（`ChatPane`）输入框上方的常驻「任务进度」卡（`StickyTaskBar`）有两个体验问题：

1. **没做完却显示「已结束」，且进度虚高。** 任务停滞/早停时（模型自己都说「完成进度 1/3，下一步可继续」），
   卡片却显示「2/3 已结束」。根因：`resolveStickyTodoDisplay`（`desktop/src/utils/task-stall-policy.ts:81-87`）
   在 idle 时**无条件**把 `in_progress → completed`，把尚未完成的项谎报为已完成。该行为还被测试
   `task-stall-policy.test.ts:23-27` 固化。仅当存在完成证据（`promotePending`：最后一条 todo 之后还有工具调用
   且产出了完整收尾回复，见 `detectModelForgotFinalTodoUpdate`）才应升级为完成。

2. **结束后问新问题，旧任务进度被反复刷且重新转圈圈。** `StickyTaskBar` 通过
   `pickLatestTodoFromMessages` 从**整个窗格全部消息**倒序找最后一次 `todo_write`，只要历史里仍留着旧
   `todo_write`，它就一直当作「当前任务」。当用户开启全新一轮（与旧任务无关）时：
   - 旧 todo 仍被选中显示；
   - 新一轮在跑（`liveness === "active"`），`resolveStickyTodoDisplay` 直接返回原始状态，
     其中的 `in_progress` 项重新出现 spinner 动画。
   缺少「这条 todo 是否属于当前这一轮任务」的判定。

> 关键事实：`StickyTaskBar` 仅用于 Pro 的 `ChatPane`；Lite 的 `ChatView` 把 todo 作为内联消息渲染，不受影响。

## 范围（严格限定）

- 仅改 `desktop/src/components/StickyTaskBar.tsx` 与 `desktop/src/utils/task-stall-policy.ts`。
- 同步更新 `desktop/src/utils/task-stall-policy.test.ts`。
- 不改后端、不改 todo_write 工具语义、不改 `ChatView`、不改 SSE / 持久化结构。

## 需求

### FR-1 旧任务进度在新一轮后不再显示（问题 2）
在 `StickyTaskBar` 选中最后一条 `todo_write` 快照后，若其 index **之后存在 `role === "user"` 的消息**
（说明已经开启了新一轮，且该新轮自身未再产出 `todo_write`），判定此 todo 属于**上一任务** → 不渲染该卡（返回 null）。
- 新一轮若自己发了新的 `todo_write`，会被 `pickLatestTodoFromMessages` 选为最新快照，其后无 user 消息，正常显示。
- 同一轮内「模型继续工作但忘记收尾 todo」（todo 之后只有 tool/assistant、无新 user 消息）不受影响，仍走 `promotePending`。
- **可测性**：将「todo 快照之后是否存在 user 消息」抽成纯函数
  `isTodoSnapshotSuperseded(messages, todoIndex): boolean`，置于 `task-stall-policy.ts`；
  `StickyTaskBar` 仅调用该 helper。便于 AC-3 在 `task-stall-policy.test.ts` 中单测覆盖，避免 FR-1 逻辑只存在于组件内无法自动化验收。

### FR-2 idle 无完成证据时不虚报完成（问题 1）
修改 `resolveStickyTodoDisplay`：idle（非 active/stalled）时
- `state === "interrupted"`：`in_progress → pending`（维持现状）。
- `promotePending` 成立：`in_progress` 与 `pending` 均 `→ completed`（维持现状，模型忘记收尾的合法补偿）。
- 其余 idle（自然早停 / 停滞停止，**无** `promotePending` 证据）：`in_progress → pending`（停 spinner、计数诚实），
  **不再**把 `in_progress` 谎报为 `completed`。

### FR-3 未完成状态更清晰（问题 1 收尾）
`StickyTaskBar` 在 idle 且未全部完成时，状态标签由「已结束」改为「未完成」；并在 idle-未完成时复用已接好的
`onResume` 提供「继续」按钮（与 stalled 的「恢复」语义一致），让用户可直接续跑早停的任务。
- 全部完成（allDone）仍显示「已结束」；`interrupted` 仍显示「已中断」。

## 验收标准

- AC-1：构造历史 `[..., todo_write(1 项 in_progress / 共 3), assistant("完成进度 1/3"), 用户停滞停止]`，
  idle 且无 promotePending 证据时，卡片显示 **1/3**（in_progress 回落 pending、无 spinner），状态标签「未完成」，
  出现「继续」按钮，而非「2/3 已结束」。
- AC-2：当 todo 之后有后续 tool 调用且产出完整收尾回复（promotePending=true），idle 时仍把残余项升级为完成，
  显示 allDone「已结束」（保持既有合法行为）。
- AC-3：`isTodoSnapshotSuperseded` 单测：todo 之后有 user → true；仅有 tool/assistant → false；新一轮有新
  `todo_write` 且该快照之后无 user → false。集成行为：命中 superseded 时 `StickyTaskBar` 不渲染（旧任务进度消失，
  新一轮不再借旧 todo 转圈）；新一轮自身产出新 `todo_write` 时正常显示其进度。
- AC-4：active/stalled 期间行为不变（in_progress 正常显示 spinner / stalled 警示）；interrupted 仍回落 pending。

## 实施步骤

1. `task-stall-policy.ts`：
   - 新增 `isTodoSnapshotSuperseded(messages, todoIndex)`（FR-1 可测 helper）。
   - 调整 `resolveStickyTodoDisplay` 的 idle 分支（FR-2）。
2. `StickyTaskBar.tsx`：
   - 调用 `isTodoSnapshotSuperseded`，命中则 `return null`（FR-1）。
   - idle-未完成的状态标签与「继续」按钮（FR-3）。
3. `task-stall-policy.test.ts`：
   - 更新原「idle 直接标完成」用例为「无证据时回落 pending」（FR-2 / AC-1）。
   - 新增 `isTodoSnapshotSuperseded` 用例覆盖 AC-3（有 user / 仅 tool+assistant / 新 todo 无 user）。
   - 保持 promotePending 升级、interrupted 回落等既有用例。
4. 跑 `npm run test`（vitest）相关用例与 `tsc` typecheck 确认无回归。

## 风险与决策

- 改动会改变一条既有测试断言（idle 直接标完成）。决策：原断言固化的就是问题 1 的错误行为，应随之更正。
- 「继续」按钮在 idle-未完成时出现属新增交互，但复用既有 `onResume`/`resumeCurrentTask`，与 stalled「恢复」一致，风险低。
- **`promotePending` 误判边界（本 plan 不收紧，记为已知限制）**：若最后一条 `todo_write` 之后仍有
  `web_search` 等工具调用，且 assistant 收尾回复在语法上像「完整句」（如「完成进度 1/3，下一步可继续搜嵩基水泥」），
  `detectModelForgotFinalTodoUpdate` 仍可能判 `promotePending=true`，把残余 `pending` 误标为 `completed`。
  这与用户截图中「工具很多 + 模型自述未完成」的部分现象同源。**本 plan 仅修 idle 无证据时的虚报完成（FR-2），
  不改动 promotePending 判定逻辑**；若上线后仍出现误升级，单开 follow-up 收紧条件（例如：assistant 正文含
  「未完成 / 1/3 / 下一步」等显式未完成信号时禁止 promotePending）。
- **FR-1 的已知 trade-off**：用户用自然语言续跑同一任务（如「继续验证嵩基水泥」）但模型**未**再调 `todo_write` 时，
  因 todo 快照之后已有 user 消息，`isTodoSnapshotSuperseded` 为 true，**旧任务卡也会隐藏**。
  决策：优先保证「问无关新问题时不刷旧进度」；续跑同一结构化任务时，依赖模型再次 `todo_write` 或用户点
  idle-未完成时的「继续」走 `resumeCurrentTask`，不在本 plan 做 intent 分类。若后续需要「文本续跑仍显示旧卡」，
  需另加 plan（例如结合 stall 续跑 guard 或显式「继续任务」入口）。
