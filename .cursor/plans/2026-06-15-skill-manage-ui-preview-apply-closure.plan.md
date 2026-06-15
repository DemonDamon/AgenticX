# Plan: Skill Manage UI Preview/Apply 闭环接入

Plan-Id: 2026-06-15-skill-manage-ui-preview-apply-closure
Status: draft (待确认后执行)
Owner: Damon Li

---

## 0. 背景与目标

后端 `skill_manage` 已支持 `mode=preview|apply`、`patch_token`、`target_ranges`、`history/rollback` 与错误码分层（`VALIDATION/POLICY`）。当前缺口在 Desktop/Studio 侧：用户仍无法以可视化方式完成“预览 -> 选目标 -> 确认应用”的闭环。

本计划目标是在不改动后端协议语义的前提下，补齐 UI 交互与状态管理，让用户能安全、清晰地完成 skill patch 决策。

---

## 1. 范围与非目标

### In scope
- 在聊天消息流中渲染 `skill_manage patch preview` 卡片。
- 支持多命中 `target_ranges` 的可视化选择与二次 apply。
- 提供 apply 确认按钮，透传 `patch_token` 与 `target_index`。
- 将 `ERROR[VALIDATION]`/`ERROR[POLICY]` 映射为可读 UI 提示。

### Out of scope
- 不变更 `skill_manage` 后端协议字段定义。
- 不新增通用代码编辑器能力（不做全文自由编辑）。
- 不改动非 skill_manage 工具卡片的既有交互。

---

## 2. 需求定义（FR / NFR / AC）

### FR-1 Preview 卡片渲染
- FR-1.1 当工具返回 `action=patch` 且 `mode=preview` 时，渲染专用卡片。
- FR-1.2 卡片展示：`strategy`、`match_count`、`risk`、`diff`（可折叠）。
- FR-1.3 若 `requires_target_selection=true`，卡片显示候选目标列表。

### FR-2 Target 选择与 Apply 确认
- FR-2.1 支持选择一个 `target_index` 后触发 apply。
- FR-2.2 apply 请求自动携带 preview 返回的 `patch_token`。
- FR-2.3 提供二次确认按钮（“确认应用”），避免误触直接落盘。

### FR-3 错误可读化
- FR-3.1 `ERROR[VALIDATION]` 显示为参数/状态冲突类提示。
- FR-3.2 `ERROR[POLICY]` 显示为安全策略拦截类提示。
- FR-3.3 错误提示靠近卡片，不依赖顶部全局 toast。

### NFR
- NFR-1 保持旧会话兼容：无 preview 字段时回退到原工具卡片。
- NFR-2 不影响其他 tool cards 的渲染性能与样式一致性。
- NFR-3 遵循现有主题 token 与消息区交互规范。

### AC（验收）
- AC-1 用户可在 UI 中看到 preview 详情并决定是否 apply。
- AC-2 多命中场景可选目标并成功应用仅一处变更。
- AC-3 apply 失败时能区分 validation 与 policy 两类原因。
- AC-4 全链路无需手填 `patch_token`，UI 自动透传。

---

## 3. 实施阶段（可分批提交）

### Phase 1 — 数据识别与状态建模
1. 在工具结果解析层识别 `skill_manage patch preview` 结构化 payload。
2. 为 `patch_token`、`target_ranges`、`requires_target_selection` 建立前端类型。
3. 在消息 state 中保存 preview 临时上下文（与消息 id 绑定）。

产出：
- 前端可稳定识别 preview 响应并持有 apply 所需参数。

### Phase 2 — Preview 卡片 UI
4. 新增 Skill Patch Preview Card 组件（或扩展现有 ToolCallCard 分支）。
5. 渲染 `strategy/match_count/risk` 与可折叠 diff 区域。
6. 多命中时渲染目标列表与选中态。

产出：
- 用户可视化阅读与选择 patch 目标。

### Phase 3 — Apply 动作与确认
7. 卡片内增加“确认应用”按钮（可含一步确认弹层）。
8. 调用工具时自动拼装 apply 参数：`mode=apply` + `patch_token` + `target_index`。
9. 成功后在卡片显示“已应用”状态并附关键结果摘要。

产出：
- 从 preview 到 apply 的完整可交互闭环。

### Phase 4 — 错误映射与回归
10. 解析 `ERROR[VALIDATION]`、`ERROR[POLICY]` 并映射为友好文案。
11. 错误就近展示在卡片区域，避免用户漏看。
12. 补充前端测试与手工回归脚本。

产出：
- 错误反馈可读、定位明确、交互收敛。

---

## 4. 文件影响建议

- Modify: `desktop/src/components/chat/ToolCallCard.tsx`（或对应工具卡片分发组件）
- Modify: `desktop/src/components/chat/ChatPane.tsx`（apply 触发与消息状态衔接）
- Modify: `desktop/src/store.ts`（preview 临时状态类型与持久策略）
- Modify: `desktop/src/types/...`（skill_manage preview payload 类型）
- Add: `desktop/src/components/chat/SkillPatchPreviewCard.tsx`（若选择独立组件）
- Add/Modify: `desktop/src/components/chat/__tests__/...`（卡片交互测试）

---

## 5. 测试计划

- 组件测试：preview 卡片渲染（含单命中/多命中）。
- 交互测试：选择 `target_index` 后点击确认触发 apply 参数正确。
- 错误测试：`VALIDATION/POLICY` 两类错误展示文案正确。
- 回归测试：无 preview payload 的旧工具消息仍正常显示。

---

## 6. 风险与缓解

- 风险-1：工具结果结构在不同会话存在差异。  
  缓解：采用字段存在性检测 + 类型守卫，缺失时优雅降级。

- 风险-2：卡片交互过于复杂导致认知负担。  
  缓解：默认折叠 diff，重点突出“风险 + 目标选择 + 确认应用”。

- 风险-3：前端状态丢失导致 apply 参数不完整。  
  缓解：将 `patch_token` 与必要字段绑定到消息级状态，按钮点击时实时校验。

---

## 7. 执行前确认项

1. Preview 卡片采用独立组件还是并入现有 ToolCallCard 分支？
2. Apply 确认交互采用二次弹窗还是按钮二段态（首次点击进入确认态）？
3. Diff 默认展开还是默认折叠（建议折叠）？
4. 错误文案是否需要中英双语，还是仅中文？
