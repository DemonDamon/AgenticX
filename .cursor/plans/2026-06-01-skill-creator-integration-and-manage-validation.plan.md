# Skill Creator 集成与 skill_manage 可识别性校验

Plan-Id: 2026-06-01-skill-creator-integration-and-manage-validation
Plan-File: .cursor/plans/2026-06-01-skill-creator-integration-and-manage-validation.plan.md

## 背景 / 问题

用户在分身会话中指令「工具调用太多，构建 skill 落盘本地」后，分身回复「已落盘」，但 Desktop **设置 → Skills** 本地搜索搜不到。

根因链路：

1. **文件已写入** `~/.agenticx/skills/<name>/SKILL.md`（落盘成功）。
2. **扫描器未识别**：`SkillBundleLoader._parse_skill_md` 要求 frontmatter 含 `name:`，缺失则返回 `None` 并丢弃（`agenticx/tools/skill_bundle.py:840-842`）。
3. **常见模型错误**：写 `title:` / `version:` 不写 `name:`（本次 `a-stock-daily-report` 即如此）。
4. **`skill_manage` 无 post-write 校验**：create 只过 `guard`，不验证是否可被 loader 扫描；agent 可误报成功。
5. **分身 prompt 缺规范**：Meta 有 `skill_manage` 使用规范，`_build_avatar_direct_prompt` 没有；分身易用 `bash`/`file_write` 绕开工具。
6. **无内置「如何从对话沉淀 skill」方法论**：Anthropic [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) 在仓库 `examples/` 有旧拷贝，未进 `agenticx/skills/` 内置扫描路径。

## 目标

- **P0（本 plan 范围）**：`skill_manage` create/patch 后保证 skill **可被扫描识别**；内置 AgenticX 适配版 `skill-creator`；分身/Meta 统一沉淀规范。
- **不在范围**：eval-viewer / benchmark 全套（upstream P2）、Desktop 一键修复 UI、默认开启 `AGX_SKILL_MANAGE`。

## 架构

```
用户/分身: 「落盘 skill」
    → skill_use(skill-creator)   # 内置 bundled skill，Capture Intent + 写法
    → skill_manage(create)       # 唯一落盘入口
        → normalize_frontmatter  # 缺 name 时用 tool name 注入；补 description 占位
        → guard scan
        → discoverability check  # SkillBundleLoader 试扫
    → skill_list 自检
    → 回复用户 discoverable=true/false（禁止仅说「已落盘」）
```

新增小模块 `agenticx/skills/frontmatter.py` 承载 normalize + validate + discoverability，供 `skill_manage` 与测试复用；不引入 PyYAML 新依赖（与 `_parse_skill_md` 一致，用 regex 处理 frontmatter）。

## 需求

### FR-1 frontmatter 归一化（create / from_path / from_url）

在 `_tool_skill_manage` 写入磁盘**之前**，对 content 调用 `normalize_skill_md(content, canonical_name=tool_name)`：

- 若无 `---` frontmatter → 报错，不写入。
- 若缺 `name:` → 在 frontmatter 首行后注入 `name: {canonical_name}`（与 tool 参数一致）。
- 若已有 `name:` 但与 `canonical_name` 不一致 → **以 tool 参数为准**覆写 frontmatter `name`（并记入 `frontmatter_fixed`）。
- 若缺 `description:` → 注入 `description: TODO: describe when to use this skill`（允许后续 patch；但 `discoverable` 仍可为 true）。
- **保留** AgenticX 已有扩展字段（`version`/`title`/`metadata`/`requires_tools` 等），不照搬 Anthropic `quick_validate` 的「只允许 4 个 key」严格模式。

### FR-2 可识别性校验（create 与 patch 后）

写入并通过 guard 后：

- 调用 `verify_skill_discoverable(skill_dir)`：用 `SkillBundleLoader` 对该目录试扫，返回 `(discoverable: bool, skill_name: str | None, errors: list[str])`。
- create/patch 成功 JSON 响应扩展字段：
  - `discoverable` (bool)
  - `skill_name` (str | null)
  - `frontmatter_fixed` (list[str]，如 `["injected name"]`)
  - `validation_warnings` (list[str])
- 若 `discoverable=false`：返回 `ok: false` + ERROR 文案（含具体 errors），**patch 回滚 / create 删目录**（与 guard 失败同语义）。

### FR-3 内置 bundled skill-creator

- 新增 `agenticx/skills/bundled/skill-creator/SKILL.md`（Apache 2.0，附带 `LICENSE.txt` 自 upstream 拷贝）。
- 内容：**精简 AgenticX 适配版**（非 upstream 全文照搬）：
  - Capture Intent（从当前对话提取 workflow）
  - frontmatter 规范（`name` + `description` 必填；`name` 用 hyphen-case）
  - 落盘必须用 `skill_manage`，禁止 `bash`/`file_write` 直写 `~/.agenticx/skills/`
  - 落盘后必须 `skill_list` 确认 `discoverable`
  - 与 `agenticx-skill-manager` 分工一句（运维 vs 方法论）
  - **不含** eval-viewer / aggregate_benchmark / Claude 专属 subagent 评测流水线
- 可选：`scripts/init_skill.py` 精简版（生成带正确 frontmatter 的骨架）；若时间紧可仅文档内嵌模板，脚本放 P1 follow-up。

### FR-4 Prompt 对齐（Meta + 分身）

- 抽取 `_build_skill_manage_prompt_block()` 到 `agenticx/runtime/prompts/skill_authoring.py`（或 `meta_agent.py` 内私有函数），包含：
  - 用户说「落盘/封装/工具太多」→ 先 `skill_use(skill-creator)` 再 `skill_manage`
  - 禁止 bash 直写 skill 目录
  - 必须以工具返回 `discoverable=true` 才能对用户声称「已在设置页可见」
- Meta `build_meta_agent_system_prompt` 改为引用该 block（替换现有重复段落，行为不变）。
- 分身 `_build_avatar_direct_prompt` **追加同一 block**（当前缺失）。

### FR-5 测试

扩展 `tests/test_smoke_hermes_agent_skill_manage.py`（或新增 `tests/test_skill_frontmatter.py`）：

| 用例 | 预期 |
|------|------|
| create content 仅 `title`，无 `name` | 自动补 `name`，`discoverable=true` |
| create content 完全无 frontmatter | ERROR，目录不存在 |
| create 后 loader 能 `get_skill(name)` | pass |
| patch 破坏 frontmatter（删掉 name） | ERROR + 回滚 |
| frontmatter name 与 tool name 不一致 | 覆写为 tool name，`frontmatter_fixed` 非空 |

### NFR-1

- 不修改 `SkillBundleLoader._parse_skill_md` 的识别规则（仍要求 `name:`）；校验层在 write 前保证合规。
- 遵循 `no-scope-creep`：不改 Settings UI、不改 `AGX_SKILL_MANAGE` 默认值、不实现 eval-viewer。

## 验收标准

- **AC-1**：`skill_manage(create, name=a-stock-daily-report, content=仅含title的SKILL.md)` 成功后 JSON 含 `discoverable: true`，且 `SkillBundleLoader().scan()` 能发现该 skill。
- **AC-2**：同上 create 若 body 过短或 guard 命中仍按原逻辑拒绝；normalize 不削弱 guard。
- **AC-3**：内置 `skill-creator` 出现在 Skills 列表（source=builtin），可被 `skill_use` 激活。
- **AC-4**：分身系统 prompt 含 skill 沉淀规范；与 Meta 文案一致。
- **AC-5**：`pytest tests/test_smoke_hermes_agent_skill_manage.py`（及新增用例）全绿。

## 实施步骤（建议分两 commit）

### Commit 1 — `skill_manage` 校验与 frontmatter 模块

**Task 1.1** 新建 `agenticx/skills/frontmatter.py`

```python
# 核心 API（签名以实施为准）:
# normalize_skill_md(content: str, canonical_name: str) -> tuple[str, list[str]]
# validate_skill_frontmatter(content: str) -> list[str]  # warnings/errors
# verify_skill_discoverable(skill_dir: Path) -> tuple[bool, str | None, list[str]]
```

**Task 1.2** 修改 `agenticx/cli/agent_tools.py`

- `_tool_skill_manage` create 分支：guard 前 `normalize` → 写盘 → `verify_skill_discoverable` → 扩展 JSON 返回。
- patch 分支：写盘后同样 verify；失败则回滚 backup。
- 保持现有 guard / versioning / fuzzy_patch 行为不变。

**Task 1.3** 测试

- 在 `tests/test_smoke_hermes_agent_skill_manage.py` 增加 FR-5 用例。
- 运行：`pytest tests/test_smoke_hermes_agent_skill_manage.py -q`

### Commit 2 — bundled skill-creator + prompt

**Task 2.1** 新增文件

- `agenticx/skills/bundled/skill-creator/SKILL.md`
- `agenticx/skills/bundled/skill-creator/LICENSE.txt`（Apache 2.0，注明源自 anthropics/skills）

**Task 2.2** 新增 `agenticx/runtime/prompts/skill_authoring.py`

- `_build_skill_authoring_prompt_block() -> str`
- 从 `meta_agent.py` 迁出并替换 inline 段落。

**Task 2.3** 修改 `agenticx/studio/server.py`

- `_build_avatar_direct_prompt` 末尾 append `_build_skill_authoring_prompt_block()`。

**Task 2.4** 冒烟

- `python -c "from agenticx.tools.skill_bundle import SkillBundleLoader; print([s.name for s in SkillBundleLoader().scan() if s.name=='skill-creator'])"`
- 确认输出含 `skill-creator`。

## 文件清单

| 操作 | 路径 |
|------|------|
| Create | `agenticx/skills/frontmatter.py` |
| Create | `agenticx/skills/bundled/skill-creator/SKILL.md` |
| Create | `agenticx/skills/bundled/skill-creator/LICENSE.txt` |
| Create | `agenticx/runtime/prompts/skill_authoring.py` |
| Modify | `agenticx/cli/agent_tools.py`（`_tool_skill_manage`） |
| Modify | `agenticx/runtime/prompts/meta_agent.py`（引用 shared block） |
| Modify | `agenticx/studio/server.py`（avatar prompt） |
| Modify | `tests/test_smoke_hermes_agent_skill_manage.py` |

## 风险与决策

| 风险 | 决策 |
|------|------|
| 自动注入 `name` 掩盖模型错误 | 记入 `frontmatter_fixed`，agent 须在回复中说明「已自动补全 name」 |
| `description: TODO` 占位导致低质量 skill | 允许 discoverable；quality_gate / 用户 patch 后续处理；不在本 plan 阻塞 |
| upstream skill-creator 与内置版漂移 | 内置版为 **适配精简版**；`LICENSE.txt` 保留；不自动 sync upstream eval 部分 |
| patch 后 discoverable 失败回滚 | 与 guard 回滚一致，避免磁盘留不可识别文件 |

## 后续（P1，不在本 plan）

- `scripts/init_skill.py` 内置 + `skill_manage` 文档引用
- Desktop Skills 搜索空态：「目录存在但不可识别」提示
- 简化 eval：spawn_subagent with/without skill 对比（无 eval-viewer）

## Todos

- [ ] Task 1.1 — `frontmatter.py` normalize + verify
- [ ] Task 1.2 — wire into `_tool_skill_manage`
- [ ] Task 1.3 — pytest 扩展
- [ ] Task 2.1 — bundled `skill-creator` + LICENSE
- [ ] Task 2.2 — `skill_authoring.py` prompt block
- [ ] Task 2.3 — Meta + avatar prompt 引用
- [ ] Task 2.4 — scan 冒烟 + 全量相关测试绿
