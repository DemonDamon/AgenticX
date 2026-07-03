# 历史对话侧栏改造为锚定浮层（workbuddy 风格）

Planned-with: Claude Sonnet 5

## 背景 / 问题

Desktop 端当前「历史对话」入口（顶部工具栏 `History` 图标按钮，`toggleHistorySidePanel`）打开的是 `SessionHistoryPanel.tsx`（1570 行，含搜索/置顶分组/日期分组/微信绑定标记等完整功能），渲染方式有两种，均为**常驻占位**：

- 宽窗口（`!compactSidePanels`）：作为可拖拽宽度的常驻侧栏列，挤占聊天区域宽度（`ChatPane.tsx:10105-10118`）
- 窄窗口（`compactSidePanels`）：全高覆盖层 + 半透明遮罩，覆盖在聊天区右侧（`ChatPane.tsx:10232-10248`）

参考 workbuddy 的展示方式（见用户提供截图）：点击图标后在图标附近**弹出一个轻量浮层**，不挤占布局、不覆盖全高，点击浮层外部区域即自动收起。

用户要求：改造成 workbuddy 式的锚定浮层，**保留 `SessionHistoryPanel` 现有全部功能**（搜索、置顶、日期分组、微信绑定标记等），只改变其"容器定位方式"。

## 目标

将「历史对话」面板从"常驻侧栏列 / 全高覆盖层"改为"锚定在触发按钮附近的浮层（popover）"：

- 不挤占聊天区域宽度（不再作为 flex 子列参与布局）
- 不再有半透明背景遮罩覆盖聊天内容
- 固定宽度 + 限高 + 内部滚动（复用 `SessionHistoryPanel` 自身的列表滚动）
- 点击浮层外部区域自动关闭（沿用仓库内已有的 mousedown 监听关闭模式，如 `NewTopicSplitControl`、`PaneModelPicker`）
- 视口边界自适应（复用 `paneModelPickerPanelStyle` 的"上下自动翻转 + 左右不越界"定位算法思路）
- `SessionHistoryPanel.tsx` 组件本身内容**不做功能删减**，仅调整外层容器交由新定位逻辑接管

## 非目标（Out of Scope）

- 不改动 `SessionHistoryPanel.tsx` 内部的搜索/分组/置顶/微信绑定等业务逻辑与视觉细节
- 不改动记忆图谱面板（`MemoryGraphPanel`）、工作区面板、成员列表面板的现有布局方式（它们仍保持常驻列/覆盖层，本次只针对「历史对话」）
- 不改动窗格顶部工具栏其他按钮

## 技术方案

### 1. 新增锚定定位逻辑

复用/抽取 `paneModelPickerPanelStyle`（`ChatPane.tsx:750-788`）的定位算法思路，新写一个 `historyPanelPopoverStyle(anchor: DOMRect): CSSProperties`：
- 固定宽度（对齐当前 `historyWidth` 的常见默认值，如 360px，视口不足时收窄）
- 上下方向依据锚点按钮到视口顶/底的可用空间自动选择「向下展开」或「向上展开」，并据此计算 `maxHeight`
- 左右方向保证不超出视口，向左对齐或按钮右边缘对齐（历史按钮在窗格右上角，浮层应向左下展开，避免出屏）

### 2. 触发按钮改为记录锚点 + 打开浮层

`toggleHistorySidePanel`（`ChatPane.tsx:9023-9044`）改造：
- 不再区分 `compactSidePanels` 走不同的 store 更新分支（该函数目前的两个分支本质都只是切换 `pane.historyOpen` + 顺带清掉其它面板标志，改造后统一为：切换 `historyOpen`，并在打开时记录触发按钮的 `getBoundingClientRect()` 存入本地 state 供浮层定位）
- 按钮元素需要绑定 `ref`（当前第 9216-9222 行的 `<button>` 补充 `ref`）

### 3. 浮层渲染改造

用 `createPortal` 将 `SessionHistoryPanel` 渲染到 `document.body`，替换现有两处渲染分支（`ChatPane.tsx:10105-10118` 常驻列分支、`10232-10248` 覆盖层分支），合并为一处：

```tsx
{pane.historyOpen && historyAnchorRect
  ? createPortal(
      <>
        <div className="fixed inset-0 z-[9998]" onClick={closeHistoryPanelOnly} />
        <div
          className="fixed z-[9999] overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl backdrop-blur-xl"
          style={historyPanelPopoverStyle(historyAnchorRect)}
        >
          <SessionHistoryPanel pane={pane} onClose={closeHistoryPanelOnly} tintColor={paneTint} />
        </div>
      </>,
      document.body,
    )
  : null}
```

- 外层透明点击捕获层用于"点击外部关闭"（比逐一挂 `mousedown` 监听更简单，且与遮罩语义解耦——这里用**透明**全屏层，不做 `bg-black/35` 视觉遮罩，符合"不额外占用/不遮挡"的要求）
- 需要处理窗格滚动/resize/切换窗格时同步关闭或重新定位浮层（简单起见：窗格尺寸变化、`paneId` 变化、或窗口 resize 时直接关闭浮层，重新打开会拿到最新锚点）

### 4. 清理不再需要的状态与逻辑

- 从 `compactSidePanels` 互斥计数逻辑（`ChatPane.tsx:8886-8933` 的 `stacked` 计算）中移除 `historyOpen`，因为浮层不再占用布局空间，不需要与工作区/记忆图谱/成员列表/Spawns 互斥
- `dismissAuxiliaryOverlays`（`ChatPane.tsx:8935-8949`）中移除对 `historyOpen: false` 的重置（保留其它面板的重置）
- 其余面板（记忆图谱等）打开时，是否需要顺带关闭历史浮层：**保留关闭**（视觉整洁），即 `toggleMemoryGraphSidePanel` / `toggleMembersSidePanel` / `toggleSpawnsSideColumn` 等 opening 分支中继续将 `historyOpen: false`（这些逻辑已存在，不用改）
- 移除历史面板专属的拖拽宽度调整入口（`startResizeHistory` 目前与记忆图谱面板共用 `historyWidth` 状态，需确认移除历史面板的拖拽把手后，`startResizeHistory`/`historyWidth`/`agx-history-width-v1` 持久化对记忆图谱面板仍然可用不受影响）

### 5. 涉及文件

- `desktop/src/components/ChatPane.tsx`（核心改动：触发逻辑、渲染位置、互斥逻辑清理）
- `desktop/src/components/SessionHistoryPanel.tsx`（可能需要微调外层容器的 `h-full`/尺寸假设以适配浮层的 `maxHeight` 容器，具体是否需要改动待实现时验证；若组件已能在受限高度容器中正常滚动则无需改动）

## 验收标准（AC）

- AC-1：点击顶部工具栏「历史」图标，在按钮下方/上方弹出浮层展示会话历史列表（搜索、置顶分组、日期分组、微信绑定标记等功能与改造前一致）
- AC-2：浮层展开时不挤占聊天区域宽度，不出现全高背景遮罩
- AC-3：点击浮层外部任意区域，浮层自动关闭
- AC-4：窄窗口与宽窗口下表现一致（不再区分 compact/非 compact 两套渲染分支）
- AC-5：浮层在视口边缘（如窗口很矮或很窄）时自动上下/左右调整位置与最大高度，不超出视口
- AC-6：打开记忆图谱/工作区/成员列表等其他面板时，历史浮层自动关闭（沿用现有互斥关闭逻辑）
- AC-7：`npx tsc --noEmit` 无新增类型错误

## 风险 / 待确认

- `SessionHistoryPanel` 内部若存在依赖"父容器铺满可用高度（`h-full`）"的样式假设，改为浮层固定 `maxHeight` 容器后可能需要局部样式微调（在实现阶段读取该组件确认）
- 现有 `historyWidth`/`agx-history-width-v1` 持久化宽度是否需要为浮层单独设一个固定宽度常量（不复用可拖拽宽度状态），倾向于新增固定宽度常量，不与 `MemoryGraphPanel` 共享的 `historyWidth` 混用，避免相互影响
