# agenticx/ 模块结论纳入增量追踪体系

Planned-with: claude-opus-5-thinking-medium
Suggested-Impl-Model: composer-2.5-fast（步骤 1-3 为确定性配置与脚本执行）；步骤 4 首轮 adopt 收编若需批量改写，按 SKILL.md §6.1 另行询问模型档位

## 背景与根因

仓库里对「模块结论」有三套东西，职责重叠且只有一套是活的：

| 资产 | 位置 | 状态 |
|---|---|---|
| `模块总结.md` | `rules/模块总结.md`（未入库，`/rules/` 被 gitignore） | 一次性全量扫描规范，文件级粒度，无增量能力 |
| `update-conclusion` 命令 | `~/.cursor/commands/update-conclusion.md` | 增量更新，但基线只有「最新一次 commit」或 Plan-Id，无 per-module checkpoint |
| `code-module-summaries` skill | `.cursor/skills/code-module-summaries/` | 上述两者的合体且更严格：per-module commit OID 基线、plan/checkpoint 两阶段、单次有效 token、drift 保护、并行子代理策略 |

skill 已在 `desktop/conclusions/` 与 `enterprise/conclusions/` 实际运行（两处均有 `registry.json`，`layout: custom`）。

**根因**：根目录 `conclusions/` 从未接入该 skill。证据链：

1. `.gitignore` 第 38 行是 `conclusions/`（无前导斜杠，匹配任意层级）。
2. `git ls-files conclusions/` 返回空 —— 根 `conclusions/` 下 38 个文件全部未入库。
   （`desktop/conclusions/`、`enterprise/conclusions/` 能被跟踪，是因为它们在该规则生效前/后被 `git add -f` 强制加入，已跟踪文件不受 gitignore 影响。）
3. skill 的 checkpoint 机制要求 control dir 被 Git 跟踪（REFERENCE.md §1「The control directory is tracked in Git」），`state/*.json` 必须能提交，否则基线在任何一次 clone/切机器后即丢失。
4. 因此这 38 个文件是 2026-05-29 前后的一次性手工快照，无基线、无法增量，只会持续腐烂。

**覆盖缺口**：`agenticx/` 有 43 个已跟踪子包，现有 conclusion 只覆盖 32 个。未覆盖的包里 `integrations/`（112 个已跟踪文件，全仓最大）、`knowledge/`（35）、`hooks/`（26）都不是小模块。

**粒度问题**：`模块总结.md` §2.3.2 要求「每个文件摘要不少于 3-5 句 + 列出所有类/函数 + 统计代码行数」，这是 `core_module_conclusion.md` 达到 58KB、`collaboration_module_conclusion.md` 达到 29KB 的直接原因。文件级枚举既读不动，又最先失效（改一个函数签名就错）。skill 的 REFERENCE.md §7 模板取的是模块级粒度，与 `模块总结.md` 冲突，本 plan 以 skill 模板为准。

## In scope / Out of scope

**In scope**
- 修改 `.gitignore` 第 38 行，使根 `conclusions/` 可被跟踪，同时保持 `examples/` 下的 conclusions 仍被忽略。
- 新建 `conclusions/registry.json`（`layout: custom`，43 个模块）。
- 将现有 38 个 conclusion 文件按「原样收编」（`--adopt-existing-summary`）建立首轮基线，不重写内容。
- 为 10 个未覆盖子包 + 1 个包根 glue 模块新建 conclusion。
- 给 `rules/模块总结.md` 与 `~/.cursor/commands/update-conclusion.md` 加「已被 skill 取代」的弃用头，保留存档。

**Out of scope（no-scope-creep 边界）**
- 不修改 `desktop/conclusions/`、`enterprise/conclusions/` 的任何文件或其 `registry.json`。
- 不修改 `.cursor/skills/code-module-summaries/` 下任何文件（SKILL.md / REFERENCE.md / scripts / tests 均不动）。
- 不修改 `agenticx/` 下任何源码。
- 不删除任何现有 conclusion 文件（退役文件走归档，不删）。
- 不对现有 38 个 conclusion 做「瘦身/重写」；本轮只建基线，内容修正交给后续增量。

## FR / AC

### FR-1：解除 gitignore 对根 conclusions/ 的阻塞

**落点**：`/Users/damon/myWork/AgenticX/.gitignore` 第 38 行。

当前该行内容为 `conclusions/`（上下文：第 36 行 `markmap/`、第 37 行 `progress/`、第 39 行 `discussions/`）。

before：
```gitignore
progress/
conclusions/
discussions/
```

after：
```gitignore
progress/
examples/**/conclusions/
discussions/
```

理由：仓库内共 5 个 `conclusions` 目录 —— `./conclusions`、`./desktop/conclusions`、`./enterprise/conclusions` 应被跟踪；`./examples/agenticx-for-finance/FinnewsHunter/conclusions` 与 `./examples/agenticx-for-guiagent/AgenticX-GUIAgent/conclusions` 属第三方示例产物，应继续忽略。不能用 `conclusions/` + `!/conclusions/` 的否定写法：Git 不支持在被排除的**目录**内重新包含文件。

**AC-1**：
- `git check-ignore -v conclusions/README.md` 退出码非 0（未被忽略）。
- `git check-ignore -v examples/agenticx-for-finance/FinnewsHunter/conclusions/` 退出码为 0（仍被忽略）。
- `git status --porcelain conclusions/ | wc -l` ≥ 38。

### FR-2：创建 conclusions/registry.json

**落点**：新建 `/Users/damon/myWork/AgenticX/conclusions/registry.json`。

结构参照 `desktop/conclusions/registry.json`（`layout: custom` + `index_path`），schema 见 `.cursor/skills/code-module-summaries/REFERENCE.md` §2。

顶层字段：

```json
{
  "schema_version": 1,
  "layout": "custom",
  "tracked_ref": "HEAD",
  "index_path": "conclusions/README.md",
  "exclude_paths": [
    ".cursor", ".githooks", ".github", "assets", "deploy", "desktop",
    "docs", "enterprise", "examples", "packaging", "research", "scripts",
    "tests", "conclusions",
    ".gitignore", ".gitmodules", "AGENTS.md", "INSTALL.md", "install.sh",
    "LICENSE", "MANIFEST.in", "mkdocs.yml", "README.md", "README_ZN.md",
    "requirements.lock", "setup.py"
  ],
  "modules": [ /* 见下表 */ ],
  "retired_modules": []
}
```

`exclude_paths` 的取值依据：`git ls-files | awk -F/ '{if (NF==1) print "FILE:"$1; else print "DIR:"$1}' | sort -u` 的全部输出，减去 `agenticx`（由模块拥有），减去 `pyproject.toml` / `requirements.txt`（作为 `package_root` 的 `shared_paths`）。本 registry 的职责范围明确为 Python 框架包 `agenticx/`；`desktop/`、`enterprise/` 由各自 registry 管理，不重复纳管。新增的顶层目录会触发 `UNASSIGNED_TRACKED_PATHS`，这是预期的提醒信号，不是缺陷。

**模块表**（43 项。`roots` 一律为 `agenticx/<pkg>`，`summary_path` 一律为 `conclusions/<file>`，`mapping_revision` 一律为 `1`）：

| id | name | roots | summary_path | 来源 |
|---|---|---|---|---|
| agents | Agents | agenticx/agents | conclusions/agents_module_conclusion.md | adopt |
| avatar | Avatar | agenticx/avatar | conclusions/avatar_module_conclusion.md | adopt |
| brain | Brain | agenticx/brain | conclusions/brain_module_conclusion.md | adopt |
| cc-bridge | CC Bridge | agenticx/cc_bridge | conclusions/cc_bridge_module_conclusion.md | adopt |
| cli | CLI | agenticx/cli | conclusions/cli_conclusion.md | adopt |
| code-index | Code Index | agenticx/code_index | conclusions/code_index_module_conclusion.md | adopt |
| collaboration | Collaboration | agenticx/collaboration | conclusions/collaboration_module_conclusion.md | adopt |
| core | Core | agenticx/core | conclusions/core_module_conclusion.md | adopt |
| deploy | Deploy | agenticx/deploy | conclusions/deploy_module_conclusion.md | adopt |
| embeddings | Embeddings | agenticx/embeddings | conclusions/embeddings_module_conclusion.md | adopt |
| embodiment | Embodiment | agenticx/embodiment | conclusions/embodiment_conclusion.md | adopt |
| evaluation | Evaluation | agenticx/evaluation | conclusions/evaluation_module_conclusion.md | adopt |
| extensions | Extensions | agenticx/extensions | conclusions/extensions_module_conclusion.md | adopt |
| gateway | Gateway | agenticx/gateway | conclusions/gateway_module_conclusion.md | adopt |
| learning | Learning | agenticx/learning | conclusions/learning_module_conclusion.md | adopt |
| llms | LLMs | agenticx/llms | conclusions/llms_module_conclusion.md | adopt |
| longrun | Longrun | agenticx/longrun | conclusions/longrun_module_conclusion.md | adopt |
| memory | Memory | agenticx/memory | conclusions/memory_module_conclusion.md | adopt |
| observability | Observability | agenticx/observability | conclusions/observability_module_conclusion.md | adopt |
| planner | Planner | agenticx/planner | conclusions/planner_module_conclusion.md | adopt |
| project-state | Project State | agenticx/project_state | conclusions/project_state_module_conclusion.md | adopt |
| protocols | Protocols | agenticx/protocols | conclusions/protocols_module_conclusion.md | adopt |
| retrieval | Retrieval | agenticx/retrieval | conclusions/retrieval_module_conclusion.md | adopt |
| runtime | Runtime | agenticx/runtime | conclusions/runtime_module_conclusion.md | adopt |
| safety | Safety | agenticx/safety | conclusions/safety_module_conclusion.md | adopt |
| sandbox | Sandbox | agenticx/sandbox | conclusions/sandbox_module_conclusion.md | adopt |
| server | Server | agenticx/server | conclusions/server_module_conclusion.md | adopt（见 FR-3） |
| sessions | Sessions | agenticx/sessions | conclusions/sessions_module_conclusion.md | adopt |
| skills | Skills | agenticx/skills | conclusions/skills_module_conclusion.md | adopt |
| storage | Storage | agenticx/storage | conclusions/storage_module_conclusion.md | adopt |
| studio | Studio | agenticx/studio | conclusions/studio_module_conclusion.md | adopt |
| tools | Tools | agenticx/tools | conclusions/tools_module_summary.md | adopt（沿用现有 `_summary` 文件名，不改名） |
| configs | Configs | agenticx/configs | conclusions/configs_module_conclusion.md | new |
| data-sources | Data Sources | agenticx/data_sources | conclusions/data_sources_module_conclusion.md | new |
| delivery | Delivery | agenticx/delivery | conclusions/delivery_module_conclusion.md | new |
| flow | Flow | agenticx/flow | conclusions/flow_module_conclusion.md | new |
| hooks | Hooks | agenticx/hooks | conclusions/hooks_module_conclusion.md | new |
| integrations | Integrations | agenticx/integrations | conclusions/integrations_module_conclusion.md | new |
| knowledge | Knowledge | agenticx/knowledge | conclusions/knowledge_module_conclusion.md | new |
| trainer | Trainer | agenticx/trainer | conclusions/trainer_module_conclusion.md | new |
| utils | Utils | agenticx/utils | conclusions/utils_module_conclusion.md | new |
| workspace | Workspace | agenticx/workspace | conclusions/workspace_module_conclusion.md | new |
| package-root | Package Root | agenticx | conclusions/package_root_conclusion.md | new |

`package-root` 说明：`roots: ["agenticx"]`，靠 REFERENCE.md §2 ownership rule 2「nested roots are allowed; the deepest matching root owns the path」兜底，实际只拥有 `agenticx/*.py`（`__init__.py`、`_optional.py`、`_version.py`、`branding.py`、`presets.py`）以及未来新增的顶层子包。额外声明 `"shared_paths": ["pyproject.toml", "requirements.txt"]`，让依赖契约变更能触发该模块更新。

**AC-2**：
- `python -c "import json;d=json.load(open('conclusions/registry.json'));print(len(d['modules']))"` 输出 `43`。
- `python .cursor/skills/code-module-summaries/scripts/scan_changes.py plan --repo . --control-dir conclusions` 不报 `UNASSIGNED_TRACKED_PATHS`。
- 若报该 blocker 且列出的是 `conclusions/` 下的文件（如 3 个 `*_internalization_summary.md`），把这些路径补进 `exclude_paths` 后重跑至通过；不得改用 `.` 兜底模块绕过。

### FR-3：退役两个重复/越界的 conclusion 文件

两个文件与模块表冲突，需归档而非删除：

1. `conclusions/server_gateway_conclusion.md` —— 它描述的是 `agenticx/server/` 的生产级基础设施（Redis 共享状态、限流、SSE 等），与 `conclusions/server_module_conclusion.md` 指向同一个 root。一个 root 只能有一个 `summary_path`。
2. `conclusions/desktop_module_conclusion.md` —— `desktop/` 已由 `desktop/conclusions/registry.json` 纳管，根 registry 的 `exclude_paths` 已排除 `desktop`，此文件属越界副本。

**操作**：
- 新建目录 `conclusions/_archive/`。
- `git mv` 不适用（文件尚未入库），直接用文件系统移动：
  - `conclusions/server_gateway_conclusion.md` → `conclusions/_archive/server_gateway_conclusion.md`
  - `conclusions/desktop_module_conclusion.md` → `conclusions/_archive/desktop_module_conclusion.md`
- 在两个归档文件顶部各插入一行：
  `> 已归档（2026-08-08）：内容不再单独维护。server 相关请见 conclusions/server_module_conclusion.md；desktop 相关请见 desktop/conclusions/desktop_conclusion.md。`
- 把 `conclusions/_archive` 加入 registry 的 `exclude_paths`（若 `conclusions` 已整体在 exclude_paths 中则无需重复）。
- 同步修改 `conclusions/README.md`：第 109 行「部署与服务化」表格中 `server` 行的结论列，去掉 `/ [server_gateway_conclusion.md](server_gateway_conclusion.md)`；第 122 行 `desktop` 行的链接改指 `../desktop/conclusions/desktop_conclusion.md`。

**AC-3**：`conclusions/` 根下不再存在 `server_gateway_conclusion.md` 与 `desktop_module_conclusion.md`；`conclusions/_archive/` 下各存在一份且首行为归档说明；`README.md` 中无指向这两个文件的存活链接。

### FR-4：首轮基线 —— 32 个 adopt + 11 个 new

严格按 SKILL.md §2「First scan」与 §3「Incremental update」执行，**先 plan 后 checkpoint，逐模块 checkpoint**。

第一步，读取计划（只读，不写任何文件）：

```bash
python .cursor/skills/code-module-summaries/scripts/scan_changes.py plan \
  --repo . \
  --control-dir conclusions \
  --adopt-existing-summary
```

- 退出码 `2` 或 `has_blockers: true` → 一个字都不许写，先按 REFERENCE.md §10 的 blocker 表处理。
- 预期：32 个 adopt 模块报 `SUMMARY_WITHOUT_STATE`（由 `--adopt-existing-summary` 授权通过），11 个 new 模块报 `new`。
- 若源码有未提交改动导致 `DIRTY_WORKTREE`，先提交或明确加 `--head-only`，不得 stash/reset。
- 记录每个模块返回的 `checkpoint_token`、`summary_sha256_at_plan`、`summary_path`。

第二步，**32 个 adopt 模块不重写内容**（用户已确认「原样收编为基线，后续靠增量逐步修正」），直接 checkpoint：

```bash
python .cursor/skills/code-module-summaries/scripts/scan_changes.py checkpoint \
  --repo . --control-dir conclusions \
  --module <module-id> \
  --target <full-target-oid> \
  --target-ref HEAD \
  --plan-token <该模块的 token> \
  --summary-sha256-at-plan <该模块的 hash> \
  --adopt-existing-summary
```

第三步，11 个 new 模块需生成新 conclusion。按 REFERENCE.md §7 模板（职责与非职责 / 入口与公共接口 / 核心执行路径 / 重要类与函数 / 数据与配置契约 / 依赖 / 测试与运维边界 / 未验证项），**模块级粒度，禁止逐文件枚举、禁止统计代码行数**。写完后各自 checkpoint（不带 `--adopt-existing-summary`）。

`integrations`（112 文件）、`knowledge`（35）、`hooks`（26）是其中的大头，其余 8 个（configs 1、trainer 1、workspace 2、utils 3、flow 7、delivery 8、data_sources 12、package-root 5）体量很小。若决定并行生成，必须先完成 SKILL.md §6.1 —— 向用户询问子代理模型档位，禁止默认继承父会话模型。

**AC-4**：
- `ls conclusions/state/*.json | wc -l` 输出 `43`。
- 任取一个 state 文件，`baseline_commit` 为 40 位完整 OID，且 `git cat-file -t <oid>` 返回 `commit`。
- 重跑一次 `plan`（不带任何 flag）后，所有 43 个模块状态为 `unchanged`，`has_blockers: false`。
- 32 个 adopt 模块的 `.md` 文件内容与执行前**逐字节一致**：执行前先 `md5 conclusions/*.md > /tmp/before.md5`，执行后对这 32 个文件比对无差异。
- 11 个新 conclusion 均存在且非空，且不含「每个文件」式逐文件枚举或代码行数统计。

### FR-5：更新 conclusions/README.md 为受管索引

`registry.json` 的 `index_path` 指向它，按 REFERENCE.md §9，它由 agent 撰写、不参与模块 diff。

- 补齐 11 个新模块的行（现有 README 第 197 行标注「knowledge、flow、hooks、integrations、configs、trainer 尚无独立 conclusion」，该句需删除）。
- 新增一节「如何维护」，写明本目录由 `code-module-summaries` skill 管理，日常增量命令为：
  ```bash
  python .cursor/skills/code-module-summaries/scripts/scan_changes.py plan \
    --repo . --control-dir conclusions
  ```
- 保留现有分层结构与表格风格，不重排版式。

**AC-5**：README 中每个 registry 模块都有一行且链接可解析（相对 `conclusions/`）；无残留的「尚无独立 conclusion」表述。

### FR-6：弃用两份被取代的文档

1. `/Users/damon/myWork/AgenticX/rules/模块总结.md` —— 在第 1 行 `## 1. 任务目标` 之前插入：
   ```markdown
   > **已弃用（2026-08-08）**：本规范已被 `.cursor/skills/code-module-summaries/` skill 取代。
   > 该 skill 提供 per-module commit OID 基线与增量更新，本文的文件级全量扫描粒度不再采用
   > （它是 conclusion 文件膨胀的直接原因）。保留本文仅作历史存档。
   ```
2. `/Users/damon/.cursor/commands/update-conclusion.md` —— 在第 1 行 `# update-conclusion` 之后插入同类弃用说明，指明改用 skill，并保留原文供追溯 Plan-Id 联动的历史设计。

两份文档均**只加头、不删正文**。

**AC-6**：两文件首屏可见弃用声明；正文其余内容逐行未变（`git diff` 对 `rules/` 不适用，因其未入库，改用人工比对行数：修改后行数 = 原行数 + 插入行数）。

## 执行顺序

FR-1 → FR-2 → FR-3 → FR-4 → FR-5 → FR-6。FR-1 不完成，FR-4 的 checkpoint 无法持久化，后续全部无效。

## 提交约定

按 `.cursor/rules/plan-management.mdc`，实施前把本 plan 从 `.cursor/plans/pending/` 移回 `.cursor/plans/` 根目录，再用
`/commit --spec=.cursor/plans/2026-08-08-agenticx-conclusions-incremental-tracking.plan.md` 提交，
trailer 含 `Plan-Id` / `Plan-File` / `Plan-Model` / `Impl-Model` / `Made-with: Damon Li`。

建议拆两个 commit：
1. `chore(summaries): track agenticx conclusions under module summary registry`（FR-1 ~ FR-3 + registry）
2. `docs(conclusions): baseline agenticx module summaries and retire legacy specs`（FR-4 ~ FR-6）
