# Plan: Skill 受控变更与版本治理工作流

Plan-Id: 2026-06-15-skill-change-governance-workflow
Status: draft (待确认后执行)
Owner: Damon Li

---

## 0. 背景与目标

当前 `skill_manage` 已具备基础安全防护（路径约束、guard 扫描、可发现性校验、失败回滚），但在“用户口头要求修改 skill”场景下，仍存在三类痛点：误改、不可视化确认、版本可回滚能力不足。  
目标是在不破坏现有安全红线前提下，补齐一条**可预览、可确认、可回滚、可审计**的 Skill 变更工作流。

---

## 1. 范围与非目标

### In scope
- 新增 Skill 变更“预览（dry-run）→确认（apply）”双阶段流程。
- 增强 patch 精准性（上下文锚点 + 命中策略可解释）。
- 引入 Skill 快照版本与一键回滚。
- 提供面向用户的错误与风险解释（不是底层 pattern 术语堆砌）。

### Out of scope
- 不改动 `file_write/file_edit` 对 `~/.agenticx/skills` 的红线策略。
- 不重构 Guard 引擎整体架构（仅做策略分层与可观测增强）。
- 不做完整 IDE 文本编辑体验（无光标级协同、无自由编辑器替代）。

---

## 2. 需求定义（FR / NFR / AC）

### FR-1 双阶段变更
- FR-1.1 `skill_manage patch` 支持 `mode=preview`，返回结构化 diff（old/new/context）。
- FR-1.2 用户确认后用 `mode=apply` 执行实际写入。
- FR-1.3 preview 与 apply 使用同一 patch token，防止“预览和实际不一致”。

### FR-2 精准 patch 防误改
- FR-2.1 支持 `old_string + before_context + after_context` 组合定位。
- FR-2.2 若命中多处，默认拒绝 apply 并要求用户选择目标片段。
- FR-2.3 返回 `strategy`、`match_count`、`target_ranges` 供 UI 展示。

### FR-3 版本与回滚
- FR-3.1 每次 apply 前保存 `SKILL.md` 快照（含 hash、时间、操作者、会话 ID）。
- FR-3.2 新增 `skill_manage history` 与 `skill_manage rollback --to <version>`。
- FR-3.3 rollback 也走 guard + discoverable 校验，失败不落盘。

### FR-4 大 skill 与安全策略体验优化
- FR-4.1 对超大 skill 的 patch 增加“局部预扫描 + 全量异步审计”模式。
- FR-4.2 guard 拦截文案输出“风险类别 + 具体片段 + 可操作修复建议”。
- FR-4.3 将“权限问题”和“安全策略问题”在错误码上明确区分。

### NFR
- NFR-1 与现有 `skill_manage` create/patch/delete 接口保持向后兼容。
- NFR-2 默认策略继续优先安全，不允许绕过 guard 直接写入 skill 根目录。
- NFR-3 全链路可审计（谁、何时、改了什么、为何被拦截）。

### AC（验收）
- AC-1 用户可先看到 diff 再确认，且 apply 内容与 preview 一致。
- AC-2 多命中 patch 不再“猜测改哪段”，而是明确要求选择。
- AC-3 任意一次 skill 变更可在 1 步内回滚到指定版本。
- AC-4 guard 拦截时，用户能看懂“为什么拦 + 怎么改”。
- AC-5 对超大 skill，常见小改动可在可接受延迟内完成（不牺牲安全底线）。

---

## 3. 实施阶段（可分批提交）

### Phase 1 — Preview/Apply 协议层
1. 扩展 `skill_manage` 参数：`mode=preview|apply`、`patch_token`。
2. 实现 preview 输出统一结构（diff hunks、match 信息、风险摘要）。
3. apply 必须校验 token 与原文 hash 一致，否则拒绝执行。

产出：
- `skill_manage` 双阶段协议可用；现有调用不传 `mode` 时保持旧行为（默认 apply）。

### Phase 2 — Patch 定位增强
4. 在 fuzzy patch 前增加可选上下文锚点约束。
5. 多命中场景返回候选列表（含片段摘要与位置索引）。
6. 补充“单命中/多命中/零命中/上下文冲突”错误语义。

产出：
- patch 可解释、可预测，误改概率显著下降。

### Phase 3 — 版本快照与回滚
7. 新增 skill 快照存储（建议 `~/.agenticx/skills/.versions/<skill>/...`）。
8. 新增 `history` 查询与 `rollback` 动作。
9. 将现有 `.changelog` 与快照版本号关联，形成完整审计链。

产出：
- 可查询版本历史，可回滚且安全校验不退化。

### Phase 4 — Guard 体验优化
10. 增加拦截错误码分层（auth / policy / validation）。
11. 大 skill patch 新增“快速路径 + 异步全量审计”策略开关。
12. 输出用户可执行修复建议（删除哪段、替换成什么模式）。

产出：
- “能用且可理解”的拦截反馈，减少用户对工具“卡死”感知。

---

## 4. 文件影响建议

- Modify: `agenticx/cli/agent_tools.py`（skill_manage 协议与动作扩展）
- Modify: `agenticx/skills/fuzzy_patch.py`（上下文锚点与候选命中）
- Modify: `agenticx/skills/versioning.py`（快照元数据与历史查询）
- Modify: `agenticx/skills/guard.py`（拦截文案结构化）
- Add: `agenticx/skills/skill_versions.py`（快照读写与 rollback 支撑）
- Add: `tests/test_skill_manage_preview_apply.py`
- Add: `tests/test_skill_manage_rollback.py`
- Add: `tests/test_skill_manage_multi_match.py`
- Add: `docs/guides/skill-change-governance.md`

---

## 5. 测试计划

- 协议测试：preview 不落盘、apply 才落盘、token/hash 不一致拒绝。
- 正确性测试：单命中替换成功、多命中要求选择、零命中返回可读错误。
- 回滚测试：rollback 成功恢复、rollback 后仍 discoverable。
- 安全测试：恶意 payload 仍被 guard 拦截，不可借 rollback 绕过。
- 回归测试：现有 create/patch/delete 行为兼容。

---

## 6. 风险与缓解

- 风险-1：双阶段流程增加调用复杂度。  
  缓解：保持旧参数兼容，UI 默认走 preview→confirm，CLI 支持一次性 apply。

- 风险-2：版本快照占用空间。  
  缓解：引入保留策略（最近 N 版 + 按时间清理）。

- 风险-3：大 skill 快速路径带来漏报风险。  
  缓解：快速路径只用于交互延迟优化，最终以异步全量审计结论为准。

---

## 7. 产品边界（避免“变成 IDE”）

本方案借鉴 IDE 的“先 diff 再提交”理念，但定位仍是 Agent-native：

1. 用户不直接手工编辑 skill 文件，而是表达意图并确认变更提案。  
2. 变更必须经过 guard / discoverable / rollback 安全闭环。  
3. 目标是“降低误改与治理成本”，不是“提供自由文本编辑器能力”。  
4. Near 仍是执行主体，用户是决策与确认主体。

