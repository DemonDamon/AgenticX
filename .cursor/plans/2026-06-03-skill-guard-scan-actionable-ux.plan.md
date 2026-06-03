# 技能安全扫描可操作化重构

Plan-Id: 2026-06-03-skill-guard-scan-actionable-ux
Plan-File: .cursor/plans/2026-06-03-skill-guard-scan-actionable-ux.plan.md

## 背景与问题

当前「设置 → 技能高级设置 → 技能安全扫描」要求用户**手动填写技能目录路径**才能扫描，且：

- 用户不知道该填什么路径，容易误填整个 `~/.agenticx/skills/` 根目录，导致全库命中叠加（如「77 files / 命中 141 条 / T-HEAVY」），无法定位是哪个技能。
- 扫出问题后只展示报告，**没有任何后续操作**（修复 / 禁用 / 忽略），用户不知道怎么处置。

## 目标

把交互从「填路径 → 出报告」改为「一键扫全部 → 按技能给处置选项」：

1. 去掉路径输入框与相关描述，改为一个「扫描已安装技能」按钮。
2. 逐个技能目录扫描（按 `base_dir`），只列出有问题（dangerous/caution）的技能。
3. 每个技能按来源区分能力：
   - `~/.agenticx/skills` 下（市场安装 + 自建）→ 可 **AI 修复 / 禁用 / 忽略**
   - Cursor / Claude / agents 等外部来源 → 显示「外部」徽标，**不提供 AI 修复**，仅 **禁用 / 忽略**
4. 「忽略」按技能整体生效，写入 `skills.guard.ignored`，之后扫描默认跳过（可撤销）。
5. 「禁用」复用现有 `skills.disabled` 机制。
6. 「AI 修复」委派元智能体新会话修改 → 展示 diff → 用户确认后才写入。

## 需求

### FR（功能需求）
- FR-1: 新增 `POST /api/skills/guard-scan-all`，内部遍历已安装技能逐目录深扫，返回每技能的 verdict/score/grade/findings/source/base_dir/can_fix，并过滤 ignored 名单。
- FR-2: `can_fix` 判定：技能 `base_dir` 位于 `~/.agenticx/skills` 之下为 true，否则 false（外部来源）。
- FR-3: `skills.guard.ignored`（list[str]，技能名）持久化在 `~/.agenticx/config.yaml`；扫描结果默认排除其中技能。
- FR-4: 扩展 `GET/PUT /api/skills/guard-settings` 读写 `ignored`（支持整表覆盖或增删单项）。
- FR-5: 前端去掉路径输入框与描述，提供「扫描已安装技能」按钮；结果按技能分组卡片展示。
- FR-6: 卡片操作：外部来源显示「外部」徽标且无 AI 修复；agx 来源提供 AI 修复 / 禁用 / 忽略。
- FR-7: 禁用复用 `disabledSkillNames` / `skills.disabled`；忽略写 `skills.guard.ignored`。
- FR-8 (P1): AI 修复委派元智能体新会话，产出修改后内容并展示 diff，确认后写入 SKILL.md。

### NFR（非功能需求）
- NFR-1: 批量扫描应有进度/忙碌态，避免长时间无反馈。
- NFR-2: 卡片样式与现有 SettingsToggleCard / 列表行一致（rounded-xl / bg-surface-card）。
- NFR-3: 不破坏现有手动 `guard-scan`、安装前自动扫描链路。

### AC（验收标准）
- AC-1: 点「扫描已安装技能」无需填路径即可列出有问题技能，按技能分组、不再整库叠加。
- AC-2: 外部来源技能显示「外部」且无「AI 修复」按钮。
- AC-3: 点「忽略」后该技能从结果消失，重启后仍不再报；可在已忽略列表撤销。
- AC-4: 点「禁用」后技能列表对应开关关闭，`skills.disabled` 落库。
- AC-5 (P1): 点「AI 修复」弹出 diff，确认后 SKILL.md 被更新且复扫风险下降。

## 阶段拆分

### P0（本期）
1. 后端 `guard_config`：`ignored` 字段 + load + persist。
2. 后端 `guard-scan-all` 接口（含 can_fix、过滤 ignored）。
3. 后端 `guard-settings` 扩展 ignored 读写。
4. Electron IPC + preload + global.d。
5. 前端 UI 重构（扫描按钮、分组卡片、外部标识、禁用、忽略、撤销）。

### P1（后续）
6. AI 修复委派 + diff 确认。

## 涉及文件
- `agenticx/skills/guard_config.py`
- `agenticx/studio/server.py`
- `desktop/electron/main.ts` / `preload.ts`
- `desktop/src/global.d.ts`
- `desktop/src/components/SettingsPanel.tsx`
