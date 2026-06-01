# Skill 落盘自愈与可发现性保证

Plan-Id: 2026-06-01-skill-write-autoheal-discoverability

## 背景与根因

用户在对话/定时任务里让 Agent「构建 skill 落盘本地」，Agent 返回「✅ Skill 已落盘本地」，
但设置 → Skills 搜不到。

排查（含本机会话 `ff8eb51a-...`）确认的真实因果链：

1. Agent 首选正道 `skill_manage create` →
2. guard 误判 skill 正文（代理绕过 / `del os.environ` / API 示例）为 `dangerous`，拦截 →
3. Agent 回退用 `file_write` 直写 `~/.agenticx/skills/a-stock-daily-report/SKILL.md` →
4. `file_write` **不做** frontmatter 归一化、**不做** discoverability 校验，落盘内容只有
   `title` / `version` / `description`，**缺 `name:`** →
5. `file_write` 返回 `OK: wrote ...`，Agent 据此声称「已落盘」 →
6. `SkillBundleLoader._parse_skill_md` 因缺 `name` 直接丢弃 → 搜不到。

之前的修复（commit `3ae89ecd` / `f3ec8477`）只覆盖 `skill_manage` 路径，对 `file_write`
直写无效；且 guard 拦截把 Agent 推到了未受校验的 `file_write` 旁路。

## 目标

**「写入 `skills/**/SKILL.md` 成功」必须等价于「该 skill 可被 Skills 系统检索」。**
任何对话形式落盘 skill 的工具路径，一旦返回成功，用户立即能在设置 → Skills 搜到。

## 设计取舍

- `file_write` / `file_edit` 路径**不经过 guard**，因此让其落盘 SKILL.md 时自动补 `name`
  并校验可发现性，即可无条件保证诉求达成——无需改动安全敏感的 guard 正则。
- 采用「**自动修复优先**」而非「拒绝改用 skill_manage」：模型行为不可控，拒绝只会让它继续
  换 `bash_exec` 等旁路绕过；自动修复直接保证结果，且避免绕过循环。
- guard 误报收敛（让正道 `skill_manage` 不被合法 skill 内容误拦）属安全敏感改动，**本次不做**，
  记为后续单独评估；不影响本 plan 对用户诉求的达成。

## 范围（FR / AC）

- **FR-1**：新增 helper，对写入路径命中 `skills/**/SKILL.md`（文件名 `SKILL.md` 且路径含 `skills`
  段、父目录非 `skills` 本身）的写操作做落盘后自愈：
  - 读回内容 → `normalize_skill_md(content, canonical_name=父目录名)` 补全 `name` / `description`；
  - 若有修正则回写文件；
  - `verify_skill_discoverable(skill_dir)` 校验；
  - 不可发现 → 返回 `ERROR`，明确告知「文件已写入但不会被 Skills 收录」+ 原因；
  - 可发现 → 在成功信息后追加「skill '<name>' 已可在设置 → Skills 检索」（含自动补全项）。
- **FR-2**：`_tool_file_write` 写入成功后经该 helper 决定最终返回值。
- **FR-3**：`_tool_file_edit` 写入成功后经该 helper 决定最终返回值。
- **FR-4**：`_build_automation_runner_system_prompt` 注入 skill 落盘规范（SKILL.md 必含
  `name` frontmatter；优先 `skill_manage`；声称「已落盘且可检索」前须确认可发现）。
- **FR-5**：冒烟测试覆盖 title-only 自愈、无 frontmatter 报错、普通文件不受影响、幂等。

- **AC-1**：`file_write` 写只有 `title` 的 SKILL.md 后，返回里出现「已可在设置 → Skills 检索」，
  且文件 frontmatter 已含 `name: <目录名>`，`verify_skill_discoverable` 为真。
- **AC-2**：`file_write` 写无 frontmatter 的 SKILL.md 后，返回 `ERROR` 且说明不会被收录。
- **AC-3**：写普通（非 SKILL.md / 非 skills 路径）文件，返回值与行为不变。

## 不在范围

- 不改 guard 正则 / 阈值 / `should_allow`（安全敏感，另行评估）。
- 不改 `AGX_SKILL_MANAGE` 默认值。
- 不动 `bash_exec` 重定向写文件路径（shell 内写入无法在工具层拦截；由 FR-4 prompt 约束 + 用户可
  事后用 `skill_manage patch` 补；本 plan 覆盖最常见的 file_write/file_edit 路径）。
- 不改 Settings / Desktop UI。

## 实现位置

- `agenticx/cli/agent_tools.py`：新增 `_autoheal_skill_md_after_write()`；接入
  `_tool_file_write`、`_tool_file_edit`。
- `agenticx/studio/server.py`：`_build_automation_runner_system_prompt()` 注入规范。
- `tests/test_smoke_skill_write_autoheal.py`：新增冒烟测试。

## 遵循 no-scope-creep

每处改动可追溯到 FR；不重构既有正确逻辑；不动 guard 与 UI。
