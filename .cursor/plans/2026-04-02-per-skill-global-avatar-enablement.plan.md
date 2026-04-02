# Per-Skill 全局禁用与分身级启用覆盖

## What & Why

- 在 `~/.agenticx/config.yaml` 的 `skills.disabled` 中维护**全局**按技能名的禁用列表；扫描与运行时注入前统一过滤。
- 分身 `avatar.yaml` 的 `skills_enabled` 提供**第二层**覆盖：仅当某技能名为 `false` 时，该分身不使用该技能（与全局禁用叠加）。
- Studio API、CLI 与 Desktop（设置 → 技能、分身设置、创建分身）暴露一致的读写与开关 UX。

## Requirements

- **FR-1**：`skill_bundle` 读写 `skills.disabled`；`GET/PUT /api/skills/settings` 返回并持久化 `disabled_skills`；技能列表项标注 `globally_disabled`。
- **FR-2**：`AvatarConfig` 含 `skills_enabled`；创建/更新分身 API 接受并回写；会话绑定分身时运行时 `skill_use` / 摘要列表按全局+分身双层过滤。
- **FR-3**：Desktop：设置 Skills Tab 每行全局开关；分身设置「技能」Tab 与手动创建分身折叠区配置 per-avatar 禁用；IPC `putSkillSettings` 支持 `disabledSkills`。
- **NFR-1**：未在 PUT 中携带 `disabled_skills` 时保留现有全局禁用列表（`persist_skill_scan_settings(disabled_skills=None)` 语义）。
- **AC-1**：`tests/test_smoke_skill_conflict_resolution.py` 与 skill settings mock 兼容四元组扫描设置。
- **AC-2**：分身侧仅持久化「对该分身禁用」的条目（`false`），清空映射等价于恢复默认全开。

## Conclusion

- 合并后在 Machi 验证：全局禁用后列表与运行时一致；分身关闭某技能后仅该分身不可用。
