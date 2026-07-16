# 子规划 C · 项目群聊视图 + 群聊模板（ProjectsView）

Planned-with: claude-opus-4.8
Suggested-Impl-Model: claude-opus-4-8-thinking-medium

> 主规划：`.cursor/plans/2026-07-16-near-nav-redesign.plan.md`
> 依赖：子规划 A（`mainView`、`usePaneNavigation`、`ProjectsView` 空壳、`MainViewShell`）。
> 目标：把 A 的 `ProjectsView` 空壳实现成参考图 3 的**项目群聊页**（我的群聊网格 + 群聊模板网格 + 新建），并抽出可复用的 `GroupEditorInline`。参考图 4（新建项目弹窗）与图 5（模板区）交互，但保留 Near 品位，不像素级复刻。

---

## In scope
1. 抽取 `GroupEditorInline` 到独立文件 `desktop/src/components/groups/GroupEditorInline.tsx`（从 `AvatarSidebar.tsx` L1246–1463 等价搬移并导出），支持 `initialName` 预填以配合模板。
2. 新增 `desktop/src/components/groups/group-templates.ts`：Near 自研群聊模板静态清单。
3. 实现 `desktop/src/components/groups/ProjectsView.tsx`：标题区 + 「+ 新建群聊」+「我的群聊」网格 +「群聊模板」网格。
4. 点群聊卡片 → `usePaneNavigation().openGroupPane(group)`；点「新建群聊」/模板 → 打开 `GroupEditorInline`（模板预填名称 + 自动预选匹配分身）。

## Out of scope
- 不改群聊后端 API（沿用 `createGroup/updateGroup/deleteGroup`）。
- 不改群聊路由策略（继续写死 `routing: "intelligent"`，符合「默认智能路由」偏好）。
- 模板不落库、不引入后端；纯前端静态清单 + 预填编辑器（诚实，不做假数据）。
- 不做群聊搜索/筛选（未来增强）。

---

## FR / 精确落点

### FR-C1 · 抽取 `GroupEditorInline`
- 新文件 `desktop/src/components/groups/GroupEditorInline.tsx`：把 `AvatarSidebar.tsx` 的 `function GroupEditorInline({...})`（L1246–1463）**整体搬移**并 `export`，连同它用到的工具 import（`sanitizeGroupAvatarIds` / `extractUnknownAvatarIdFromError` / `getGroupSaveErrorMessage` 来自 `../../utils/group-editor-utils`）。行为保持等价（弹层遮罩、成员校验、保存/删除、`saveNotice` 提示均不变）。
- **扩展 props**：新增可选 `initialName?: string`（模板预填群名），用于新建场景。`useState(initialGroup?.name ?? initialName ?? "")`。其余 props 不变：`avatars / initialGroup? / onDelete? / onClose / onSaved`。
- 遵守用户偏好：弹层不过度透明（保留现有 `bg-surface-panel`），取消键紧靠保存左侧（现状 L1442–1458 已是「取消 + 保存」同排，保持）。
- `AvatarSidebar.tsx`：删除内联的 `GroupEditorInline` 定义，改为 `import { GroupEditorInline } from "./groups/GroupEditorInline";`（若侧栏改造后不再挂载群聊编辑器——按 A 移除群聊列表后，侧栏的 `groupCreateOpen`/`groupEditTarget` 挂载点也一并移除；群聊新建/编辑改由 `ProjectsView` 承载）。
- **AC-C1**：`GroupEditorInline` 从独立文件导入，新建/编辑群聊行为与改造前一致（能建群、能改名改成员、能删群、失败有可读错误）。

### FR-C2 · 群聊模板清单
- 新文件 `desktop/src/components/groups/group-templates.ts`：
  ```ts
  export interface GroupTemplate {
    id: string;
    name: string;          // 预填群名
    description: string;   // 卡片副标题
    icon: string;          // lucide 图标名
    memberRoleHints: string[]; // 用于在现有分身里模糊匹配自动预选成员（匹配 avatar.name / avatar.role）
  }
  export const GROUP_TEMPLATES: GroupTemplate[] = [ ... ];
  ```
- 初始模板（Near 自研、贴合本产品语境，参考图 5 但不照抄文案）：
  - `product-flow` 产品需求全流程 — 「从需求澄清、PRD 撰写到研发测试验收」— icon `ClipboardList` — hints: [产品, PRD, 需求, 研发, 测试]
  - `market-research` 市场调研与竞品分析 — 「深度调研、竞品拆解、结论评审」— icon `LineChart` — hints: [调研, 研究, 分析, 行业]
  - `team-kb` 团队知识库 — 「持续沉淀 SOP、经验与 FAQ」— icon `BookOpen` — hints: [知识, 文档, 写作]
  - `delivery` 项目交付 — 「需求、计划、风险与周报统筹」— icon `PackageCheck` — hints: [交付, 项目, 管理]
  - `bug-track` 缺陷跟踪与验收 — 「统一测试用例与验收结论」— icon `Bug` — hints: [测试, bug, 质量, 验收]
  - `fullstack-squad` 全栈研发小队 — 「架构、前后端与代码评审协同」— icon `Boxes` — hints: [开发, 工程, 架构, 前端, 后端]
- 图标经 `ICON_MAP`（参照 `TemplateGrid.tsx` L16–26 的 lucide 映射模式）解析。

### FR-C3 · ProjectsView UI（参考图 3）
- 外层 A 的 `MainViewShell`（可滚动 `px-6 py-5`）。
- **标题区**（呼应图 3「项目 / 多人协同，打造超级团队」，Near 化）：
  ```
  项目群聊
  把多个数字分身编成一个团队，协同完成复杂任务。
  [+ 新建群聊]
  ```
- **「我的群聊」区**：`useAppStore((s) => s.groups)` 渲染卡片网格（`grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`）。每张卡片：
  - 群图标色块（复用 `groupColorByIndex(index)` 的 `iconBg`，`desktop/src/utils/avatar-color.ts` L51–54）+ 群名 `text-[15px] font-semibold`。
  - 成员摘要：`group.avatarIds.length` 个成员 + 成员名拼接（参照 AvatarSidebar L987–992）。
  - 已开窗格绿点（`panes.some(p => p.avatarId === "group:"+group.id)`）。
  - `onClick` → `openGroupPane(group)`；右上「查看/编辑」小按钮（可选）→ 打开 `GroupEditorInline` 编辑态（`initialGroup=group`）。
  - 空态：`groups.length===0` 时展示引导「还没有项目群聊，从下方模板或点『新建群聊』开始」。
- **「群聊模板」区**（参考图 5，Near 品位）：标题「从模板组建团队」+ `GROUP_TEMPLATES.map` 卡片网格（复用 `TemplateGrid` 的卡片视觉风格：图标块 + 名称 + 两行描述，参照 `automation/TemplateGrid.tsx` L38–60，但用群聊模板数据与本视图组件，不直接复用那个组件因数据结构不同）。点模板卡片 → 打开 `GroupEditorInline`（新建态）：
  - `initialName = tpl.name`
  - 预选成员：对每个 `avatars`，若其 `name`/`role` 命中 `tpl.memberRoleHints` 任一关键词（大小写不敏感、`includes` 模糊匹配），加入初始 `selectedIds`。
  - **实现方式**：给 `GroupEditorInline` 传 `initialGroup` 需 `GroupChat` 结构；为复用简洁，可改为传一个「新建预设」——**决策**：`ProjectsView` 内计算 `presetAvatarIds`，通过给 `GroupEditorInline` 传可选 `initialAvatarIds?: string[]` prop（新增，仅新建态用；`useState(new Set(initialGroup?.avatarIds ?? initialAvatarIds ?? []))`）。即 FR-C1 的 props 再加 `initialAvatarIds?: string[]`。
  - 若无任何匹配分身，编辑器照常打开（名称预填、成员空），由用户手选——诚实不塞假成员。

### FR-C4 · 打开/新建/编辑接线
- `const { openGroupPane } = usePaneNavigation();`
- 状态：`const [editorState, setEditorState] = useState<{mode:"create"|"edit"; group?:GroupChat; name?:string; avatarIds?:string[]}|null>(null);`
- 「+ 新建群聊」→ `setEditorState({mode:"create"})`
- 模板卡片 → `setEditorState({mode:"create", name: tpl.name, avatarIds: matchIds})`
- 群卡编辑 → `setEditorState({mode:"edit", group})`
- 挂载：
  ```tsx
  {editorState && (
    <GroupEditorInline
      avatars={avatars}
      initialGroup={editorState.mode==="edit" ? editorState.group : undefined}
      initialName={editorState.name}
      initialAvatarIds={editorState.avatarIds}
      onDelete={editorState.mode==="edit" ? async (id)=>{ await deleteGroupWithRefresh(id); setEditorState(null);} : undefined}
      onClose={() => setEditorState(null)}
      onSaved={() => { refreshGroups(); if(editorState.mode==="create") setEditorState(null); }}
    />
  )}
  ```
- 刷新群列表：派发 `window.dispatchEvent(new CustomEvent("agenticx:groups:changed"))` 或直接 `window.agenticxDesktop.listGroups()` → `setGroups`。**注意**：确认现有是否有 `agenticx:groups:changed` 监听；若无，直接在 ProjectsView 内 `listGroups()`→`setGroups` 刷新（App.tsx 已有群聊兜底 fetch，参照其映射逻辑 `mapGroupsFromApi`）。删群沿用 `window.agenticxDesktop.deleteGroup({id})`（参照 AvatarSidebar `handleGroupDelete`）。

---

## 验收
- **AC-C1** 点侧栏「项目群聊」→ 主区内联显示项目群聊页（非弹窗）：标题区 + 我的群聊网格 + 群聊模板网格 + 新建入口。
- **AC-C2** 点群聊卡片 → 打开/聚焦群聊窗格并切回聊天。
- **AC-C3** 点「+ 新建群聊」→ `GroupEditorInline` 打开，选成员后成功建群（真实 `createGroup`），页面即时出现新群卡片。
- **AC-C4** 点某模板 → 编辑器打开且群名预填为模板名、命中关键词的现有分身被自动勾选；无匹配时成员为空可手选；保存成功建群。
- **AC-C5** 群卡编辑可改名/改成员/删群，失败有可读错误（保留 `GroupEditorInline` 原有 `saveNotice`）。
- **AC-C-BUILD** `cd desktop && npm run build` 通过；`ReadLints` 无新增错误。
- **AC-C-SMOKE** `AGX_DEV_PORT=5713 npm run dev`：项目页浏览、建群、模板建群、编辑、删除、点卡片进聊天全链路无控制台报错。

## 参考视觉
图 3（项目页）、图 4（新建项目弹窗）、图 5（模板区）为交互参照；Near 采用自身暗色 token + 群聊色系（`groupColorByIndex`），不复刻其插画与配色。
