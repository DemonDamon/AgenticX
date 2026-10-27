# AgenticX Skills 模块总结

> 结论更新时间：2026-10-25（覆盖基线 ca9d92bec056 至 22d051f5d18a 的变更；首次创建于 2026-05-29）

## 模块概述

AgenticX Skills 模块负责「技能」（SKILL.md 形式的可复用知识指南）的注册、分发与生命周期管理。它提供本地/远程技能注册表（发布/检索/安装/卸载）、技能内容安全扫描（防 exfiltration、注入、破坏性操作等）、面向 LLM 生成补丁的模糊匹配引擎、变更日志（changelog）追踪、GitHub 仓库批量导入，以及向智能体注入「Skill-First」协议的内置元技能。模块目录下同时内置了多个开箱即用的 SKILL.md（如 quickstart、agent-builder、tool-creator 等）。

## 目录结构

```
agenticx/skills/
├── __init__.py            # 导出注册表类与 BUILTIN_SKILLS_DIR
├── registry.py            # 技能注册表：JSON 存储 + FastAPI 服务端 + 客户端
├── guard.py               # 安全扫描器（scan_skill / should_allow / 信任分级）
├── fuzzy_patch.py         # 5 策略模糊查找替换（技能 patch）
├── versioning.py          # .changelog 变更日志追加/读取/计数
├── frontmatter.py         # SKILL.md frontmatter 规范化与可发现性检查
├── import_repo.py         # 从 GitHub 仓库批量/整目录导入技能（带 guard 校验）
├── meta_skill.py          # Skill-First 协议系统提示注入
├── pending_queue.py       # 待批准技能提案队列（list / approve / reject / 过期清理）
├── connector-assistant/   # 连接器助手（MCP/REST/DB，走 connector_manage）
├── bundled/               # 内置工作流与安全类技能（含 security-audit 等）
└── agenticx-*/            # 内置开箱即用 SKILL.md（quickstart、agent-builder、tool-creator 等）
```

## 核心组件分析

### 技能注册表 (registry.py)

**文件功能**：最小化的远程/本地技能注册表（客户端 + 服务端 + 存储）

**核心组件**：
- `RegistrySkillEntry`：可序列化技能条目（`name`/`version`/`description`/`skill_type`/`gate`/`author`/`checksum`/`skill_content`）
- `RegistryStorage`：JSON 文件存储（默认 `~/.agenticx/registry.json`），临时文件 + `os.replace` 原子写、`RLock` 并发保护，支持 `list_entries`/`get_latest`/`publish`/`delete`，按 name 多版本管理
- `SkillRegistryServer`：FastAPI 服务端，暴露 `POST/GET /skills`、`GET /skills/{name}`、`DELETE /skills/{name}/{version}`，写操作支持 `AGENTICX_SKILL_REGISTRY_TOKEN` 鉴权
- `SkillRegistryClient`：客户端，`publish` 从 SKILL.md frontmatter 提取元数据并计算 sha256 校验和，`search`/`get`/`install`/`uninstall` 对接服务端
- 安全要点：`_validate_skill_name` 限制名称字符集，`install`/`uninstall` 校验解析路径不越出安装根目录；`uninstall` 对已有技能目录使用 `shutil.rmtree` 整包删除（不再只删 `SKILL.md` 后尝试 `rmdir`），扁平单文件安装仍仅删 `SKILL.md`

### 安全扫描器 (guard.py)

**文件功能**：基于正则的技能内容静态安全分析（上游参考 hermes-agent `skills_guard.py`，MIT）

**核心组件**：
- `scan_skill(skill_dir, *, source)`：扫描目录/文件内所有可扫描文本（`SCANNABLE_EXTENSIONS`），返回 `ScanResult`（裁决 + findings）
- `_PATTERN_DEFS`：大量威胁模式，按类别覆盖 **exfiltration（curl/wget/fetch/httpx 泄密）、凭据暴露（SSH/AWS/.env/各类 token 与私钥）、提示注入（ignore previous、jailbreak、role hijack）、破坏性操作（rm -rf /、DROP TABLE、mkfs）、持久化（crontab、authorized_keys、改 AGENTS.md/.agenticx 配置）、网络（反弹 shell、隧道服务）、混淆（base64 解码管道、eval/exec）、供应链（curl | sh、未固定版本 pip/npm）、提权（sudo/NOPASSWD/SUID）**
- 不可见 unicode 检测（零宽字符、RTL override 等注入规避字符）
- `_check_structure`：结构性检查（文件数 ≤50、总大小 ≤1MB、单文件 ≤256KB、二进制文件、符号链接越界）
- 信任分级矩阵 `TRUST_POLICY`：`builtin` / `trusted` / `community` / `agent-created` 四级，对 (safe/caution/dangerous) 三种裁决分别给出 allow/block 策略
- `should_allow(result, source)`：依据信任级 + 裁决判定是否放行，返回原因字符串
- 用户可读拦截文案：`format_guard_rejection_message`（面向 skill_manage 等工具的中文拦截说明，含命中类别与改写建议）与 `format_guard_block_for_user`（面向 Desktop 批准弹层的中文文案，无内部工具术语，按 `_TRUST_LABELS` 翻译信任级）；类别中文标签 `_CATEGORY_LABELS` 覆盖 exfiltration/credential/injection/destructive/code_execution
- 威胁模式清单维护在 `guard_patterns.yaml`；其中 `shell_eval`（TH-CE-009）正则已收窄为 `eval\s+(?:["'`]|\$)`，避免误拦「eval set / 评测」类普通用语
- 序列化与合并辅助：`scan_result_to_payload`、`finding_to_dict`、`merge_verdicts`、`resolve_trust_level`

### 模糊补丁引擎 (fuzzy_patch.py)

**文件功能**：技能 patch 的容错查找替换（上游参考 hermes-agent `fuzzy_match.py`，MIT）

**核心组件 `fuzzy_find_and_replace(content, old_string, new_string, replace_all)`**，按序尝试 5 种策略：
1. `exact` — 精确匹配
2. `line_trimmed` — 逐行去首尾空白
3. `whitespace_normalized` — 多空格/制表符折叠为单空格
4. `indentation_flexible` — 忽略所有行首缩进
5. `escape_normalized` — 将 `\n`/`\t`/`\r` 字面量转为真实字符

返回 `(new_content, match_count, strategy_name, error_message)`；多处命中且未 `replace_all` 时报错要求补充上下文，并通过位置映射把归一化匹配安全地映射回原文替换。

### 变更日志 (versioning.py)

**文件功能**：在 `<skill_dir>/.changelog` 追加结构化变更记录，使 create/patch/edit/delete 可追溯

**核心组件**：`append_changelog`（按 UTC 时间戳追加 action/author/session/summary）、`read_changelog`、`changelog_entry_count`

### 仓库批量导入 (import_repo.py)

**文件功能**：从 GitHub 仓库批量导入技能到 `~/.agenticx/skills/`

**核心组件 `import_skills_from_repo`**：
- 通过 GitHub `git/trees?recursive=1` 列举树 → 按 `path_glob` 与 `exclude`（默认排除 `deprecated`/`in-progress`）过滤出 SKILL.md
- 单次导入数量上限（`max_per_call`，默认 50）保护
- 逐个拉取 raw SKILL.md（限制 1MB）→ **写入后 `scan_skill` + `should_allow("agent-created")` 校验**，未通过则回滚删除并记入 `rejected_by_guard`
- 成功项追加 changelog；支持 `dry_run` 与 `overwrite`
- 结果 `ImportRepoResult`（installed/skipped_existing/pending/rejected_by_guard/errors）

**整目录安装 `install_skill_full_from_repo`**（同模块）：
- 经 `codeload.github.com` 单次下载 tarball，按 `repo_subdir/<skill>/` 前缀解压到 staging（跳过 symlink/非常规成员，防路径穿越；文件数 ≤500、总 ≤50MB、单文件 ≤5MB）
- 目标为 `~/.agenticx/skills/registry/<skill>/`，须含 `SKILL.md`；guard 扫描 staging，拒绝时不动已安装版本
- `dangerous` 裁决且未传 `acknowledge_high_risk` 时写入 `high_risk_confirm_required` 与可选 `scan_summary`（对齐注册表安装的高风险确认 UX）；确认后可继续安装
- `result_to_json` 一并序列化上述新字段

### Skill-First 协议注入 (meta_skill.py)

**文件功能**：提供 `USING_AGENTICX_SKILL` 等系统提示片段，向智能体注入「1% 规则」「技能优先级」「红旗信号」等 Skill-First 行为协议。

**核心组件**：`MetaSkillInjector.inject(base_prompt, skill_summaries, *, include_catalog=True)`——默认在协议后追加「## Available Skills」目录块；`include_catalog=False` 时只注入协议本身（可用 `AGX_SKILL_PROTOCOL` 环境变量整体关闭注入）。

### 待批准提案队列 (pending_queue.py)

**文件功能**：管理「待批准技能提案」目录（`.proposals`），提供 `list_pending` / `approve` / `reject` / `cleanup_stale`（默认清理 30 天前仍未处理的提案）。

**核心要点**：`approve` 合并提案前依次做大小限制校验、frontmatter 规范化（`frontmatter.py` 的 `normalize_skill_md`；`_set_or_insert_frontmatter_field` 会保留首个同名字段并剔除重复行，避免双 `source:` 等脏 frontmatter）、路径越界校验，写入后强制 `scan_skill` + `should_allow("agent-created")` 安全门禁；被拦截时回滚已写入文件，并返回 `format_guard_block_for_user` 生成的 Desktop 端中文拦截说明（而非原始 reason 字符串）；通过后追加 changelog 并清理提案目录。

### 内置技能 (bundled/ 与 agenticx-*)

- `bundled/`：工作流类技能（`code-dev-workflow`、`feature-loop`、`project-initializer`）；新增 `security-audit`——默认仅作安全问答/聚焦审查的**指导模式**，仅在用户明确要求完整审计/渗透测试或报告产物时走六阶段**全量审计模式**（沙箱内只读源码 + 受控本地验证、写隔离与 findings 校验脚本，配套 reference 与 JSON schema，不在此展开清单）
- `agenticx-agent-obs`：Near/多框架可观测性接入与 trace 诊断（`config.yaml` enterprise、ingest 指南、`diagnose_traces.py`）
- `agenticx-custom-project`：定制项目初始化与「留本仓 vs 上游 Issue/PR」判定（`scripts/custom_project.py`：doctor/plan、depend/fork/vendor 等模式，默认不上传用户数据）
- `connector-assistant`：对话内新建/更新**连接器**（非分身），严格 `connector_manage` 流程（模板去重、结构化澄清、掩码收凭证、verify）
- 其余 `agenticx-*`（quickstart、agent-builder、tool-creator、workflow-designer、memory-architect、deployer、a2a-connector、skill-manager 等）：本区间仅 metadata `version` 0.6.0→0.6.5，行为契约未改
- `BUILTIN_SKILLS_DIR` 指向本包目录，供运行时发现内置技能

## 设计模式

### 1. 策略链模式
- `fuzzy_patch` 的 5 策略按容错度递增依次尝试，命中即返回

### 2. 信任分级安全策略
- `guard` 以 (信任级 × 裁决) 二维矩阵决定安装放行，把安全策略与扫描结果解耦

### 3. 原子写入 + 并发保护
- 注册表 JSON 全程临时文件 + `os.replace` + `RLock`，避免写竞态

### 4. 防御性导入与校验
- 仓库导入对每个技能强制安全扫描 + 路径越界校验 + 失败回滚

## 技术亮点

1. **多维度安全扫描**：覆盖泄密/注入/破坏/持久化/提权/供应链等十余类威胁模式，并检测不可见 unicode 注入与结构异常
2. **信任分级安装**：builtin/trusted/community/agent-created 四级对应不同放行策略，agent 自建技能严控 dangerous
3. **LLM 友好的模糊补丁**：5 策略链化解 LLM 生成补丁常见的空白/缩进/转义差异，并精确映射回原文位置
4. **全链路可追溯**：每次技能变更写入 `.changelog`，配合 sha256 校验和与多版本注册表
5. **安全的批量导入**：单文件树导入与 tarball 整目录安装均强制 guard + 路径/体量上限；高风险需显式确认，失败不覆盖已装版本

## 应用场景

1. **技能市场后端**：注册表服务端 + 客户端支撑技能发布、检索与安装
2. **Agent 自建技能治理**：对运行时自创建/修改的技能做安全门禁与补丁应用
3. **技能批量迁移**：从开源仓库一键导入技能集合到本地
4. **能力注入**：通过元技能向智能体注入 Skill-First 行为协议

## 总结

AgenticX Skills 模块围绕 SKILL.md 构建了「发布/检索/安装 → 安全扫描 → 模糊补丁 → 变更追踪 → 批量导入」的技能生命周期闭环。安全扫描器与信任分级策略是其核心防线，模糊补丁引擎与 changelog 则保证了技能演进的可操作性与可追溯性。结合内置开箱即用技能与 Skill-First 协议注入，该模块构成了 AgenticX 技能生态的注册与治理基座。
