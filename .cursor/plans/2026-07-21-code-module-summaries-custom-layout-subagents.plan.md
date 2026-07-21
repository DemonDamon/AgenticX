# code-module-summaries: custom 布局 + 批量 subagent 编排

Planned-with: claude-opus-4.8
Suggested-Impl-Model: gpt-5.x（跨 Python 脚本契约 + 测试 + 文档一致性收口，序列/校验敏感）

## What & Why

`/code-module-summaries` skill 当前只支持两种 summary 落盘布局：

- `centralized`：强制 `<control-dir>/modules/<module-id>.md`
- `colocated`：强制 `<primary-root>/<summary_name>`（`summary_name` 必须是纯文件名，不能含子目录）

用户既有的「结论」约定是把**多个 md 按维度分层**落在一个 `conclusions/` 目录里，例如：

```
enterprise/conclusions/
  README.md                         # 总览索引（人/agent 维护）
  apps/gateway_conclusion.md
  features/iam_conclusion.md
  packages/db-schema_conclusion.md
  plugins/plugins_overview_conclusion.md
```

这种「集中目录 + 自由子目录分层 + 每模块一份 md」两种现有布局都做不出来：它既不在 `modules/` 下，也不在模块根（如 `apps/gateway/`）下。

本次为 skill 增补两项能力：

1. **能力 1 — 新增 `custom` 布局**：每个模块在 `registry.json` 显式声明任意 `summary_path`（仅做安全校验，不再强制目录形状），并支持一个可选的、被「托管」（managed，从源码相关性与 unassigned 检查中排除）的 `index_path` 总览文件（例如 `enterprise/conclusions/README.md`）。`centralized` / `colocated` 行为**完全不变**。
2. **能力 2 — 批量 subagent 编排工作流**：不改脚本（脚本保持确定性、可测试），只在 `SKILL.md` 增补一节标准工作流：parent 先 `plan` 拿每模块 `checkpoint_token` → 用 `dispatching-parallel-agents` 每模块开一个自包含 prompt 的 subagent 并行生成各自 md → parent 逐个 `checkpoint`。

## 根因/背景（写进正文，不依赖对话记忆）

`.cursor/skills/code-module-summaries/scripts/scan_changes.py`：

- `load_context()`（约 95–295 行）在第 116–118 行只接受 `centralized`/`colocated`；第 119–125 行强制 `summary_name` 为纯 Markdown 文件名（`PurePosixPath(summary_name).name != summary_name` 即报错，堵死子目录）；第 235–266 行按布局强制 `summary_path` 的精确形状。
- `managed_path()`（约 324–327 行）判断一个路径是否属于「受控文件」（控制目录内 或 等于某模块 `summary_path`）；受控文件会被 `path_relevant()`（343–352 行）排除，从而不进入 `module_changes()` / `source_fingerprint()`，也被 `unassigned_tracked_paths()`（361–383 行）排除。
- 脚本**从不生成或读取 INDEX.md / README**；索引一直由 agent 在 init / mapping-refresh 时手工维护（见 `REFERENCE.md` §8）。因此「能力 2」纯属 SKILL.md 工作流文档，不需要脚本改动；「README 总览」只需让脚本把 `index_path` 当作受控文件即可，内容仍由 agent/subagent 编写。

`plan_module()` / `command_checkpoint()` 全程只依赖 `module.summary_path`，与布局形状无关，故新增 `custom` 布局无需触碰 plan/checkpoint 主逻辑。

## In scope

- `scan_changes.py`：接受 `layout == "custom"`；`custom` 下跳过路径形状强制，仅保留通用校验并新增「summary_path 必须以 `.md` 结尾」；解析可选 `index_path` 并纳入 `managed_path`。
- `tests/test_scan_changes.py`：新增 custom 布局与 index_path 相关测试；保留全部既有测试（centralized/colocated 回归不破）。
- `SKILL.md`：`--layout custom` 说明、custom 布局小节、`index_path`、批量 subagent 编排工作流。
- `REFERENCE.md`：registry schema 增补 `custom` 与 `index_path`；§9 Layout rules 增 Custom 小节；Ownership 规则第 6 条补充 custom 例外。

## Out of scope / no-scope-creep 边界

- 不改 `centralized` / `colocated` 的任何既有行为与校验。
- 不在 Python 脚本内实现 subagent 调度或 README 内容生成（脚本只做确定性 plan/checkpoint + 校验）。
- 不改 `/update-conclusion` 命令、不改 `code-summaries/` 现有 registry、不迁移任何现有结论文件。
- 不新增第三方依赖。

---

## 精确改动点

### 改动 A — `scan_changes.py`：Context 增字段

落点：`@dataclass(frozen=True) class Context`（约 42–52 行）。

在 `modules: tuple[Module, ...]` 之外新增：

```python
index_path: str | None
```

### 改动 B — `load_context`：接受 custom 布局

落点：第 116–118 行。

before:
```python
layout = raw_registry.get("layout")
if layout not in {"centralized", "colocated"}:
    raise ScanError("registry layout must be centralized or colocated")
```
after:
```python
layout = raw_registry.get("layout")
if layout not in {"centralized", "colocated", "custom"}:
    raise ScanError(
        "registry layout must be centralized, colocated, or custom"
    )
```

### 改动 C — `load_context`：解析可选 `index_path`

落点：`exclude_paths` 解析之后（约第 131 行之后、`tracked_ref` 解析之前）。新增：

```python
raw_index_path = raw_registry.get("index_path")
if raw_index_path is None:
    index_path: str | None = None
else:
    index_path = normalize_repo_path(raw_index_path, "index_path")
    if not index_path.endswith(".md"):
        raise ScanError("index_path must be a Markdown file")
    path_inside((repo / index_path).resolve(), repo, "index_path")
```

### 改动 D — `load_context`：布局分支支持 custom

落点：第 235–266 行的 `if layout == "centralized": ... else: (colocated)` 块。

把 `else:` 改成 `elif layout == "colocated":`（其内部逻辑一字不改），并在末尾新增 custom 分支：

```python
elif layout == "colocated":
    # ...（原 colocated 逻辑保持不变：primary_root 默认/校验 + summary_path 形状）...
else:  # custom
    if not summary_path.endswith(".md"):
        raise ScanError(
            f"custom summary for {module_id} must be a Markdown file"
        )
```

说明：custom 下 `summary_path` 已在第 210–225 行经 `normalize_repo_path`（禁 `..`/绝对路径）、`seen_summaries` 去重、`path_inside` 仓库内校验；`primary_root` 若提供也已归一化，custom 下不强制其属于 roots（仅作元数据，不使用）。

### 改动 E — `load_context`：返回 Context 带 index_path

落点：第 285–295 行 `return Context(...)`。新增 `index_path=index_path,`。

### 改动 F — `managed_path`：把 index_path 视为受控

落点：约 324–327 行。

before:
```python
def managed_path(context: Context, path: str) -> bool:
    if path_matches_prefix(path, context.control_rel):
        return True
    return any(path == module.summary_path for module in context.modules)
```
after:
```python
def managed_path(context: Context, path: str) -> bool:
    if path_matches_prefix(path, context.control_rel):
        return True
    if context.index_path is not None and path == context.index_path:
        return True
    return any(path == module.summary_path for module in context.modules)
```

> 效果：`index_path` 指向的总览文件即使被 Git 跟踪，也不会触发 `UNASSIGNED_TRACKED_PATHS`，也不会被算作任何模块的源码变更（编辑 README 不会把模块标 `changed`）。

---

## 测试（`tests/test_scan_changes.py`）

沿用现有夹具（`make_repo` / `cli` / `plan` / `checkpoint` / `write` / `commit`）。新增：

### FR-1 custom 布局可用任意嵌套路径落盘并走完增量闭环
- AC-1：`test_custom_layout_allows_arbitrary_nested_summary_path`
  - 把 registry 改为 `layout:"custom"`，`alpha.summary_path = "docs-conclusions/apps/alpha_conclusion.md"`（既不在 control-dir 下、也不在模块根 `packages/alpha` 下）。
  - 写并提交 `packages/alpha/core.py`；`checkpoint(alpha, first)` 成功（summary 写到该自定义路径）。
  - 再次 `plan(alpha)` 状态为 `unchanged`。
  - 改 `packages/alpha/core.py` 并提交后 `plan(alpha)` 状态为 `changed`。
  - 断言 summary 文件确实落在 `docs-conclusions/apps/alpha_conclusion.md`。

### FR-2 custom 布局强制 summary_path 为 .md
- AC-2：`test_custom_layout_requires_markdown_summary_path`
  - `layout:"custom"`，`alpha.summary_path = "docs-conclusions/apps/alpha_conclusion.txt"`。
  - `plan(alpha, check=False)` 返回码 2，stderr 含 `must be a Markdown file`。

### FR-3 index_path 被托管，不算 unassigned、不算模块变更
- AC-3：`test_custom_index_path_is_managed`
  - `layout:"custom"`，两模块 alpha/beta 均用自定义 summary_path；registry 增 `index_path:"docs-conclusions/README.md"`。
  - 提交 `packages/alpha/core.py`、`packages/beta/core.py` 与 `docs-conclusions/README.md`（该 README 被 Git 跟踪）。
  - `checkpoint` 两模块后，跑**全量** `plan`（不带 `--module`）：返回码 0，`global_blockers` 不含 `UNASSIGNED_TRACKED_PATHS`，`unassigned_paths == []`。
  - 修改并提交 `docs-conclusions/README.md` 后，`plan(alpha)` 与 `plan(beta)` 状态均为 `unchanged`。

### 回归
- AC-4：既有 32 条测试（含 `test_colocated_layout_requires_primary_root_and_exact_summary_name`、`test_full_plan_blocks_unassigned_tracked_paths`）保持通过。

验证命令：
```bash
python -m pytest .cursor/skills/code-module-summaries/tests/test_scan_changes.py -q --no-cov
```

---

## 文档改动

### SKILL.md
- Invocation 契约块：`--layout centralized|colocated|custom`；新增一行 `[--index-path <path.md>]`（说明它是 registry 字段，非 CLI 参数——实际由 registry 承载；此处仅提示存在该能力）。
- Workflow / Layout：说明 custom 布局适用「集中 conclusions 目录 + 自由分层」，示例给出 `enterprise/conclusions/apps/gateway_conclusion.md` 形态。
- 新增「批量 subagent 编排」小节（见下）。

### REFERENCE.md
- §2 Registry schema：`layout` 允许 `custom`；新增可选顶层字段 `index_path`（受控总览文件）；custom 模块 `summary_path` 为任意仓库内 `.md`。
- §2 Ownership rules 第 6 条：补 custom 例外——「custom 布局的 summary 路径为任意仓库内 `.md`，仅受通用安全校验」。
- §9 Layout rules：新增 **Custom** 小节，说明形状自由、`index_path` 托管语义、以及总览文件由 agent 维护（不由 helper 生成）。

### 批量 subagent 编排工作流（写入 SKILL.md 新小节，正文要点）
1. parent 先 `plan`（全量或选定模块），确认无 blocker，记录每模块 `checkpoint_token` 与 `summary_sha256_at_plan`、冻结 `target_commit`。
2. 对每个 `new`/`changed` 模块，用 `dispatching-parallel-agents` 派一个 subagent，prompt 必须**自包含**：模块 `roots`、冻结 `target_commit`（要求 subagent 用 `git show <TARGET>:path` 读精确版本）、输出 `summary_path`、summary 模板（REFERENCE §7）、仓库既有结论文件的风格约定、以及「只准写自己那一份 md，禁止改别的文件/registry/state」的边界。
3. 所有 subagent 回来后，parent 逐个跑 `checkpoint`（用各自 token/hash）。失败模块不推进其 state。
4. `unchanged` 模块不派 subagent，仅 parent 直接 `checkpoint --summary-unchanged`（若适用）或跳过。
5. 并发上限与隔离遵循 `dispatching-parallel-agents` 约定；subagent 之间无共享状态（各写各的 summary_path）。

---

## Requirements 汇总

- FR-1 custom 布局任意嵌套路径 + 增量闭环（AC-1）
- FR-2 custom 强制 `.md`（AC-2）
- FR-3 `index_path` 托管语义（AC-3）
- FR-4 centralized/colocated 零回归（AC-4）
- FR-5 SKILL/REFERENCE 文档补齐 custom 布局 + subagent 编排 + index_path
