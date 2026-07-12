# Skills 自定义扫描路径：手填 + 行内确认/取消 + 启停开关

Planned-with: Cursor Grok 4.5
Suggested-Impl-Model: composer-2.5-fast

## Goal

Settings → Skills → 扫描路径的「添加自定义路径」改为：插入本地草稿输入行，支持手填隐藏目录；行内「确认/取消」；空草稿不落盘。已确认行右侧增加与预设一致的启停开关。

## In scope

- `desktop/src/components/SettingsPanel.tsx` 内 `SkillsTab` 自定义路径 UI 与相关 handlers
- `agenticx/tools/skill_bundle.py`：`skills.custom_paths` 存 `{path, enabled}`（兼容旧字符串）
- Desktop IPC / `global.d.ts` 类型
- `tests/test_smoke_skill_custom_path_enabled.py`

## Out of scope

- Hooks 扫描路径
- 预设路径开关行为本身

## Behavior

1. 点「添加自定义路径」→ `skillScanDraftPath = ""`（仅前端），不调 `chooseDirectory`，不写配置
2. 草稿行：`[input] [浏览] [确认] [取消]`；Enter=确认，Esc=取消
3. 确认：trim 非空且未重复 → 追加 `{path, enabled: true}` 并 persist；清空草稿
4. 取消 / 刷新技能列表：丢弃草稿
5. 已确认行：`[input] [浏览] [删除] [开关]`；blur / 浏览 / 开关变更后落盘；`enabled: false` 不参与扫描

## AC

- AC-1: 添加后不点确认就关设置/刷新，配置中无空 `custom_paths` 项
- AC-2: 手填路径点确认后出现「已保存扫描路径」且列表保留该行（默认开关开）
- AC-3: 草稿点浏览可选目录回填，仍须点确认才保存
- AC-4: 同时仅允许一行草稿；再点添加提示先确认或取消
- AC-5: 关闭自定义路径开关后刷新技能，该路径下技能不再出现；再打开后恢复
- AC-6: 旧配置纯字符串 `custom_paths` 读入视为 enabled=true
