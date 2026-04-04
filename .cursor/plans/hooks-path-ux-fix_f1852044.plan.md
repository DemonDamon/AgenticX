---
name: hooks-path-ux-fix
overview: 针对你提的 3 个问题，修正钩子 Tab 文案与路径、补齐 Claude 插件目录自动发现逻辑，并确保“已配置钩子”能正确读到默认/缓存插件中的 hooks。
todos:
  - id: ux-copy-zh
    content: 前端钩子 Tab 中文化（钩子/说明文案/已配置钩子）
    status: completed
  - id: remove-openharness-preset
    content: 移除 openharness 预设路径并更新前后端路径配置
    status: completed
  - id: claude-plugin-recursive-scan
    content: 实现 ~/.claude/plugins 递归发现 hooks.json 与 scripts/hooks/*.js
    status: completed
  - id: script-hook-adapter
    content: 将 scripts/hooks/*.js 适配为可展示/可执行的 command hook 并标注推断事件
    status: completed
  - id: hooks-api-metadata
    content: 扩展 /api/hooks 返回来源路径与发现方式字段
    status: completed
  - id: hooks-ui-explainability
    content: 钩子列表展示来源路径与空列表原因提示
    status: completed
  - id: smoke-tests-update
    content: 新增递归扫描与脚本适配测试并通过
    status: completed
isProject: false
---

# 钩子路径与展示优化计划

## 现状与根因

- `钩子` 页文案未完全中文化，存在“Hooks”英文标题与描述不一致问题，位置在 [desktop/src/components/SettingsPanel.tsx](/Users/damon/myWork/AgenticX/desktop/src/components/SettingsPanel.tsx)。
- 预设路径仍包含 `~/.openharness/hooks/`，与你当前产品定位不一致（你要求去掉）。
- “已配置 Hooks = 0”的根因：当前扫描逻辑只看 `~/.claude/hooks/` 这类单层路径和 `hooks.json`，未递归发现 `~/.claude/plugins/cache/**/hooks/hooks.json`、`~/.claude/plugins/**/scripts/hooks/*.js`，相关代码在 [agenticx/hooks/loader.py](/Users/damon/myWork/AgenticX/agenticx/hooks/loader.py) 与 [agenticx/hooks/declarative.py](/Users/damon/myWork/AgenticX/agenticx/hooks/declarative.py)。

## 优化目标（对应你的 3 点）

- `Hooks` Tab 改为中文 `钩子`。
- 描述改为：`钩子（Hooks）是智能体在执行的特定节点运行自定义脚本，可用于修改行为、执行策略或记录日志。`
- 移除 `~/.openharness/hooks/` 预设路径。
- 增强 Claude 生态自动导入：默认可读 `~/.claude/plugins/` 下插件 hooks（含 cache / marketplaces）。
- `已配置钩子` 数量与列表真实反映已发现的配置和脚本。

## 实施步骤

1. 前端文案与标签修正
- 修改 [desktop/src/components/SettingsPanel.tsx](/Users/damon/myWork/AgenticX/desktop/src/components/SettingsPanel.tsx)：
  - 左侧 Tab label `Hooks` -> `钩子`
  - 顶部说明文案替换为你指定文本
  - `已配置 Hooks` -> `已配置钩子`

2. 预设路径调整
- 修改 [desktop/src/components/SettingsPanel.tsx](/Users/damon/myWork/AgenticX/desktop/src/components/SettingsPanel.tsx) 与 [agenticx/hooks/loader.py](/Users/damon/myWork/AgenticX/agenticx/hooks/loader.py)：
  - 删除 `openharness` 预设项
  - 保留 `Cursor`、`Claude Code`
  - 新增/强调 `Claude 插件目录`（`~/.claude/plugins/`）作为默认扫描来源

3. 扫描逻辑增强（解决 0 条）
- 在 [agenticx/hooks/loader.py](/Users/damon/myWork/AgenticX/agenticx/hooks/loader.py) 增加多模式发现：
  - 递归发现 `**/hooks/hooks.json`
  - 递归发现 `**/scripts/hooks/*.js`
  - 继续兼容原生 `HOOK.yaml + handler.py`
- 在 [agenticx/hooks/declarative.py](/Users/damon/myWork/AgenticX/agenticx/hooks/declarative.py) 新增脚本型条目构造器：
  - 将 `scripts/hooks/*.js` 转成 command hook（如 `node <script_path>`）
  - event 映射规则：
    - `session-start.js` -> `session_start`
    - `session-end.js` -> `session_end`
    - `pre-compact.js` -> `preToolUse`（或内部 before_compact 映射到最接近事件）
    - `evaluate-session.js` / `suggest-compact.js` -> 默认 `postToolUse`（并在 UI 标注“推断事件”）

4. API 返回增强（便于前端解释“为什么读到/没读到”）
- 修改 [agenticx/studio/server.py](/Users/damon/myWork/AgenticX/agenticx/studio/server.py) `/api/hooks`：
  - 返回 `source_path`、`discovered_via`（hooks.json/script_scan/native_hook）
  - 返回 `event_inferred`（bool）用于 UI 提示

5. 前端列表可解释性优化
- 修改 [desktop/src/components/SettingsPanel.tsx](/Users/damon/myWork/AgenticX/desktop/src/components/SettingsPanel.tsx)：
  - 每条钩子显示来源路径（缩略）
  - 对“推断事件”显示轻提示
  - 当 0 条时显示“已扫描路径”和“未命中原因”摘要

6. 测试与验收
- 扩展 [tests/test_smoke_openharness_features.py](/Users/damon/myWork/AgenticX/tests/test_smoke_openharness_features.py)：
  - 覆盖 `~/.claude/plugins/**/hooks/hooks.json` 递归发现
  - 覆盖 `scripts/hooks/*.js` 转 command hook
  - 覆盖移除 openharness preset 后不再扫描该路径
- 验收标准：
  - 你的示例路径 `~/.claude/plugins/cache/everything-claude-code/.../scripts/hooks/evaluate-session.js` 可出现在“已配置钩子”中
  - 数量不再是 0（在存在插件 hooks 前提下）

## 影响范围

- 前端： [desktop/src/components/SettingsPanel.tsx](/Users/damon/myWork/AgenticX/desktop/src/components/SettingsPanel.tsx)
- 后端 Hook 发现： [agenticx/hooks/loader.py](/Users/damon/myWork/AgenticX/agenticx/hooks/loader.py)
- 声明式 Hook 解析： [agenticx/hooks/declarative.py](/Users/damon/myWork/AgenticX/agenticx/hooks/declarative.py)
- API： [agenticx/studio/server.py](/Users/damon/myWork/AgenticX/agenticx/studio/server.py)
- 测试： [tests/test_smoke_openharness_features.py](/Users/damon/myWork/AgenticX/tests/test_smoke_openharness_features.py)