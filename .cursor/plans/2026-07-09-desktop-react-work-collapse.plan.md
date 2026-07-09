# Desktop ReAct 过程折叠卡（思考+工具执行整体折叠）

Planned-with: claude-opus-4.8
Suggested-Impl-Model: claude-opus-4.8（前端交互 + 视觉对齐，涉及现有 ReAct 渲染链路收口，需审美与回归敏感）

## 背景与根因（证据链，不依赖对话记忆）

Machi/Near Desktop 的 IM 聊天在执行「多轮工具调用」任务时会满屏铺开
`思考了 1 秒 / 已调用 1 次工具 · 1 次 bash_exec` 交替的行（见用户截图：同一任务里
`bash_exec` 被调用了十几次）。

代码现状：
- 折叠组件 `desktop/src/components/messages/TurnToolGroupCard.tsx` 已存在，折叠后显示
  「已调用 N 次工具 · …」。
- 分组逻辑 `desktop/src/components/messages/group-tool-messages.ts` 的
  `groupConsecutiveToolMessages()` **只合并连续的 `role === "tool"` 消息**
  （见其 while 循环 `while (... canGroupToolMessage(...))`）。
- IM ReAct 渲染在 `desktop/src/components/ChatView.tsx` 的 `topLevelRowsIm.map(...)`
  分支（约 L2470-2498）：每个 ReAct block 的 `workMessages` 先经
  `groupConsecutiveToolMessages` 再逐行渲染。

根因：ReAct 每一轮的形状是 `assistant(推理「思考了1秒」) → tool(bash_exec)`。每次工具调用
前面都插了一条独立的 `ReasoningBlock` assistant 行，把「连续的 tool」切断，导致每个
`bash_exec` 单独成一个只有 1 条的 tool_group（显示「已调用 1 次工具」），中间夹着一行行
「思考了 1 秒」。折叠卡因此从未真正生效。

## 目标（用户已确认的设计决策）

1. **折叠范围（whole_work）**：把「一整段思考 + 工具执行过程」折成一张卡（类 Cursor
   「Worked for … / 执行了 N 步」过程卡）。点开才看到里面的每轮思考行与工具组卡。
2. **触发条件（threshold_done）**：当该段过程的工具调用轮数 **≥ 3** 且该回合**已执行完**
   （非流式）时默认折叠；**正在执行时保持展开**让用户看到进度。
3. **阈值 = 3**（硬编码常量，后续如需可再做设置项，本次不做）。
4. 最终自然语言回答**不进折叠卡**：过程卡折叠后，回答仍在过程卡下方正常可见。

## In scope
- 仅改 IM chatStyle 的 ReAct 渲染路径（`ChatView.tsx` 的 `topLevelRowsIm` 分支）。
- 新增一个纯展示折叠容器组件。

## Out of scope（no-scope-creep 边界）
- 不改 `groupConsecutiveToolMessages` / `TurnToolGroupCard` 的既有分组语义与视觉。
- 不改 clean/terminal 等其它 chatStyle 的渲染（那些不走 `topLevelRowsIm`）。
- 不改后端、不改消息持久化、不加设置项、不动 ReasoningBlock 内部。
- 不动 `groupedVisibleMessages`（非 IM 回退分支）。

## 实施细节

### FR-1 新增组件 `desktop/src/components/messages/ReactWorkCollapse.tsx`

纯展示折叠容器。Props：
```ts
type Props = {
  /** 该过程段内工具调用总数（用于阈值判定与标题文案） */
  toolCount: number;
  /** 该 block 是否正处于流式执行中（true 时强制展开、不折叠） */
  active: boolean;
  /** 折叠阈值，默认 3 */
  threshold?: number;
  children: React.ReactNode;
};
```

行为：
- `if (toolCount < (threshold ?? 3)) return <>{children}</>;`
  —— 轮数不足阈值时**不套任何折叠外壳**，保持现状逐行展示。
- 内部 `const [collapsed, setCollapsed] = useState(false);`
- `useEffect(() => { if (active) { setCollapsed(false); return; } setCollapsed(true); }, [active]);`
  —— 流式中强制展开；流式结束（active 由 true→false）自动折叠；用户之后可手动切换。
- 折叠头（始终显示，对齐 ReAct rail）：
  - 图标列用 `ASSISTANT_ICON_RAIL_CLASS`（来自 `./im-layout`），放一个
    `lucide-react` 的 `Sparkles`（或 `Wrench`）图标，色用 `REACT_RAIL_ICON_CLASS`。
  - 标题：`已思考并调用 {toolCount} 次工具`，样式 `REACT_RAIL_TITLE_CLASS`。
  - 右侧 `ChevronRight`（折叠）/`ChevronDown`（展开），`h-3.5 w-3.5 text-text-muted`。
  - 整行是 `<button onClick={() => setCollapsed(v => !v)}>`，结构对齐
    `ReasoningBlock.tsx` 的头部 button（`flex w-full items-center gap-2 px-0 py-1 text-left`）。
- `{!collapsed && <div className="mt-1.5 flex min-w-0 flex-col gap-3">{children}</div>}`

视觉一致性：复用 `im-layout.ts` 的 `ASSISTANT_ICON_RAIL_CLASS` /
`REACT_RAIL_TITLE_CLASS` / `REACT_RAIL_ICON_CLASS`，与「思考了 X 秒」「已调用 N 次工具」
两类 rail 行保持同一图标列与字号，不引入新配色/边框。

### FR-2 在 `ChatView.tsx` 集成（`topLevelRowsIm` 分支，约 L2475-2497）

在 `const { workMessages, finalAssistant } = seg.block;` 之后、
计算出 `lastToolGroupIdxInWork` 之后，新增：
```ts
const processRows = lastToolGroupIdxInWork >= 0
  ? groupedWork.slice(0, lastToolGroupIdxInWork + 1)
  : [];
const tailRows = groupedWork.slice(lastToolGroupIdxInWork + 1);
const processToolCount = processRows.reduce(
  (n, r) => n + (r.kind === "tool_group" ? r.messages.length : 0),
  0,
);
const isLastBlock = segIdx === topLevelRowsIm.length - 1;
```
说明：`processRows` = 到「最后一个 tool_group」为止的所有行（思考行 + 工具组），
`tailRows` = 其后的行（最终回答等），**tail 永远不折叠**。当没有 tool_group
（`lastToolGroupIdxInWork === -1`）时 processRows 为空、tailRows 为全部 → 组件因
`toolCount < threshold` 直接透传，等价现状。

渲染改为（保持 `renderGroupedChatRow` 第三参 holdProgress 上下文逻辑不变，
索引仍用 groupedWork 的原始 index `i`）：
```tsx
<div className="flex min-w-0 flex-1 flex-col gap-3">
  <ReactWorkCollapse toolCount={processToolCount} active={streaming && isLastBlock}>
    <div className="flex min-w-0 flex-col gap-3">
      {processRows.map((r, i) =>
        renderGroupedChatRow(
          r,
          true,
          r.kind === "tool_group" && i === lastToolGroupIdxInWork ? workMessages : undefined,
        ),
      )}
    </div>
  </ReactWorkCollapse>
  {tailRows.map((r, i) =>
    renderGroupedChatRow(r, true, undefined),
  )}
</div>
```
注意：`processRows` 与 `groupedWork` 的前缀索引一致，故 `i === lastToolGroupIdxInWork`
判定仍正确（lastToolGroupIdx 恰是 processRows 的最后一个元素）。tailRows 里不会再有
tool_group，故第三参传 `undefined` 安全。

在文件顶部 import 区（`TurnToolGroupCard` import 附近，约 L43）新增：
```ts
import { ReactWorkCollapse } from "./messages/ReactWorkCollapse";
```

## AC 验收

- AC-1：跑 `cd desktop && npm run typecheck && npm run build` 全绿（无新增 TS/lint 报错）。
- AC-2：≥3 次工具调用且回合完成的历史/新会话，ReAct 过程收敛为一张
  「已思考并调用 N 次工具」卡；点击展开可见原有逐轮思考行 + 工具组卡；最终回答始终在卡下方可见。
- AC-3：正在执行（流式）时该卡保持展开、可见工具进度；执行结束后自动折叠。
- AC-4：工具调用 < 3 次的回合渲染与现状完全一致（不出现折叠外壳）。
- AC-5：clean/terminal chatStyle 及非 IM 回退分支渲染不受影响。
- 手动冒烟：`AGX_DEV_PORT=5713 npm run dev` 起 Desktop，用一个多轮 `bash_exec` 任务观感确认
  「满屏交替行」收敛为单卡。
```
