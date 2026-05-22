---
name: project-state-harness
overview: External project-level state machine layered on agenticx/longrun and code_dev mode to combine Anthropic-style Initializer plus Coding loop with existing runtime resilience.
todos:
  - id: p0-project-store
    content: "P0: agenticx/project_state Store with feature_list.json progress.md status.json under projects root"
    status: completed
  - id: p0-project-tools
    content: "P0: STUDIO_TOOLS register project_init project_status feature_select feature_complete progress_append"
    status: completed
  - id: p0-prompt-blocks
    content: "P0: build_project_state_blocks injected into _build_agent_system_prompt"
    status: completed
  - id: p0-feature-loop-mode
    content: "P0: session_mode add feature_loop value with phase gates initialize implement verify commit"
    status: completed
  - id: p1-initializer-skill
    content: "P1: bundled skill project-initializer guiding spec to feature_list to init.sh to first commit"
    status: completed
  - id: p1-coding-skill
    content: "P1: bundled skill feature-loop guiding read list select feature implement run gate commit"
    status: completed
  - id: p1-verify-gate
    content: "P1: verify_gate runner reads .agx/project/verify.yaml and runs init.sh tests lints"
    status: completed
  - id: p1-longrun-bridge
    content: "P1: longrun TaskSource ProjectFeatureSource pulling next pending feature into orchestrator"
    status: completed
  - id: p2-studio-api
    content: "P2: GET POST api projects endpoints for Desktop Lite read only views"
    status: completed
  - id: p2-desktop-panel
    content: "P2: Desktop StickyTaskBar plus Project pane reading status.json progress.md"
    status: completed
  - id: p2-resume-recipe
    content: "P2: cold start recipe agx project resume rebuilds session context from disk only"
    status: completed
isProject: true
---

# Project State Harness

- Plan-Id: 2026-05-22-project-state-harness
- Plan-File: .cursor/plans/2026-05-22-project-state-harness.plan.md
- Owner: Damon Li
- Status: Draft
- Last-Updated: 2026-05-22
- 关联 plan：
  - `.cursor/plans/2026-05-07-symphony-longrun-internalization.plan.md`（已落地：`agenticx/longrun/` task workspace + stall + retry + LongRunOrchestrator）
  - `.cursor/plans/2026-05-19-machi-code-mode-harness.plan.md`（已落地：`code_dev` 三相位 + 四层上下文）
  - `.cursor/plans/2026-05-19-machi-task-stall-recovery.plan.md`（已落地：execution_state/三通道 stall/换模型续跑）
  - `.cursor/plans/2026-05-20-machi-unattended-continuation.plan.md`（已 Draft：无人值守续跑思路）

---

## 1. 背景与目标

### 1.1 问题陈述

参考 Anthropic《Effective harnesses for long-running agents》给出的双阶段方案：**Initializer Agent**（一次性奠基，产出 `feature_list.json` / `init.sh` / `progress.txt` + 初始 commit）+ **Coding Agent**（增量循环：读清单 → 看 git/进度 → 跑 `init.sh` → **一次只做一个 feature** → **E2E 必过** → 更新 passes + commit）。

代码侧已盘点（见对话上一轮）：
- AgenticX 在「单 session 上下文 + 断流续跑 + 任务隔离」三层已经覆盖（`agenticx/runtime/session_mode.py`、`agenticx/longrun/`、`agenticx/runtime/agent_runtime.py`、`agenticx/runtime/scratchpad.py`、`agenticx/runtime/todo_manager.py`、`agenticx/skills/bundled/code-dev-workflow/`）。
- **缺**「项目级、跨 session、外置到磁盘的状态机」与「Initializer/Coding 双阶段产品化编排」，导致：换 session、换机器、换模型、长程多天后，agent 没有可冷启动的「下一步在哪里」单一事实源。

### 1.2 设计立场（外置状态机 + 运行时韧性）

- **外置状态机**：项目级 deliverable 清单 / 当前进度 / 完成 commit 全部落盘到 **repo 内 `.agx/project/`** 或全局 `~/.agenticx/projects/<id>/`，**不依赖** `scratchpad` / `messages.json` / 模型记忆。
- **运行时韧性**：复用已有 `code_dev` 相位、`stall-recovery`、`longrun` workspace/retry/stall、`agent_runtime` SSE/`execution_state`，**零回归**。
- **双阶段**：用 **session_mode + skill** 实现 Initializer / Coding 的角色切换，不引入新进程、不复制 Anthropic 文件名（用 `.agx/project/` 命名空间，避免污染用户仓库根）。
- **可冷启动**：理论上「关掉 Machi、清空 SQLite、换台机器、`agx project resume <id>`」也能从磁盘重建当前任务上下文继续干。

### 1.3 不解决什么（防 scope creep）

- ❌ 不替换 `code_dev` 三相位（feature_loop 是上层编排，下层每个 feature 仍可走 explore/read/author）。
- ❌ 不替换 `todo_write` / `scratchpad`（继续用作**会话内**短期记忆，与项目级状态机正交）。
- ❌ 不引入新远程依赖、不绑定 Linear/GitHub Issue（`feature_list` 来源走可插拔 source，spec / issue / 手填三选一）。
- ❌ 不动 `agent_runtime.run_turn` 主循环；只在 system prompt 注入 + 工具注册 + Studio API 三处增量。
- ❌ 不改 Desktop 大盘 UI（P2 仅做只读面板复用 StickyTaskBar 风格）。
- ❌ 不强制每个用户都用（默认关，靠 `mode=feature_loop` 显式开启）。

---

## 2. 设计核心

### 2.1 项目级状态机（外置层）

新增模块：`agenticx/project_state/`（独立目录，零侵入既有模块）

```
agenticx/project_state/
├── __init__.py
├── store.py            # ProjectStore: 路径解析 + 原子读写 + 锁
├── schema.py           # FeatureListV1 / ProgressEntry / StatusV1 dataclass + JSON schema
├── feature_list.py     # 增删改查 + 状态机校验（pending → in_progress → verified → committed）
├── progress.py         # progress.md append-only 追加器（人类可读时间线）
├── verify.py           # 解析 .agx/project/verify.yaml，跑 init.sh / 测试 / lint 并返回结构化结果
├── init_script.py      # init.sh 模板生成 + 安全执行（白名单 + 超时 + 路径锚定）
├── tools.py            # 注册到 STUDIO_TOOLS 的 6 个项目级工具
├── prompts.py          # build_project_state_blocks / build_initializer_prompt / build_coding_prompt
└── sources.py          # 可选：FromSpecMD / FromGithubIssue / FromUserInput
```

**磁盘布局**（每个项目一个目录）：

```
<repo_or_workspace_root>/.agx/project/
├── feature_list.json     # 单一事实源：deliverable 清单（含状态/依赖/验收/优先级）
├── status.json           # 当前游标：active_feature_id / phase / last_commit_sha / verify_pass_count
├── progress.md           # 人类可读 append-only 时间线（每条 commit / verify / 失败摘要）
├── init.sh               # 可重复环境引导脚本（依赖安装/迁移/seed）
├── verify.yaml           # E2E gate 配置（运行哪些测试 / lint / 自定义脚本）
├── archive/              # 已 committed feature 的快照（feature_<id>.json + verify_log.txt）
└── .lock                 # fcntl/portalocker 进程级锁，防多 agent 并发改写
```

**为什么放在 repo 根 `.agx/project/`** 而不是 `~/.agenticx/projects/`：
- 跟 git 一起走：换机器/重建 sessions DB 后，`git clone` 就能恢复上下文。
- 默认 `.gitignore` 中**不**忽略 `.agx/project/`（用户可选忽略 archive/ 与 .lock）。
- 同时支持 fallback 到 `~/.agenticx/projects/<project_id>/`（远程 / 多 repo 工作区时）。

### 2.2 双阶段角色（编排层）

复用 `agenticx/runtime/session_mode.py`，新增 `feature_loop` 模式（`code_dev` 与 `daily_office` 不动）：

| Mode | 角色 | 系统提示注入 | 主推工具 |
|------|------|------|------|
| `daily_office` | 通用 Meta-Agent | 现状 | 现状 |
| `code_dev` | 单任务长程编码 | Explore/Read/Author 三相位 | code_outline / file_read 片段 / file_write |
| **`feature_loop`** | **项目级双阶段** | **Initializer 或 Coding（按 status.json）** | **+ project_init / feature_select / feature_complete / progress_append / verify_run** |

**Initializer phase**（`status.json.phase == "initialize"`）：系统提示要求产出 `feature_list.json`、`init.sh`、`verify.yaml`、初始 `progress.md`、首次 git commit；产出后切换 `phase = "implement"`，**之后此 session 不再作为 Initializer**。

**Coding phase**（`status.json.phase ∈ {"implement","verify","commit"}`）：每次新 session 启动时强制：
1. `project_status` 读取磁盘单一事实源（不依赖 messages.json）
2. `feature_select` 选下一个 `pending` 且依赖已满足的 feature，置 `in_progress`
3. 走 `code_dev` 三相位完成实现
4. `verify_run` 跑 `verify.yaml` 配置的 gate
5. gate 通过 → `feature_complete` 置 `verified` → 触发 git commit hook → 置 `committed` 并写 archive
6. gate 失败 → 不前进；失败摘要写 `progress.md`，交还用户决策

### 2.3 与既有运行时韧性的接线

```
┌─────────────────────────────────────────────────────────────────┐
│ 项目级状态机（本 plan 新增）                                       │
│ .agx/project/{feature_list,status,progress,init.sh,verify.yaml} │
└─────────────────────────────────────────────────────────────────┘
                  │ 读/写（工具 + system prompt 注入）
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Mode = feature_loop（本 plan 新增 session_mode 值）               │
│ - Initializer 提示模板 / Coding 提示模板（按 status.json.phase） │
└─────────────────────────────────────────────────────────────────┘
                  │ 复用
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ code_dev 相位（已落地）：Explore → Read → Author                  │
│ stall-recovery（已落地）：execution_state / 三通道 stall / 续跑    │
│ longrun（已落地，可选）：TaskWorkspace + retry + 任务级 stall      │
└─────────────────────────────────────────────────────────────────┘
```

**LongRun 桥接（P1）**：新增 `ProjectFeatureSource(TaskSource)`，把 `feature_list.json` 中 pending feature 喂给 `LongRunOrchestrator`，每个 feature 一个 `task_id`，复用现成的 stall/retry/workspace。这样无人值守 mode 下，agent 卡住会触发 longrun 自动重排，不只是 SSE 续跑。

---

## 3. Functional Requirements

### FR-1：项目状态 Store（P0）

**文件**：`agenticx/project_state/store.py` + `schema.py`

- **FR-1.1** `ProjectStore.locate(workspace_root)` 解析 `.agx/project/`；不存在时回落 `~/.agenticx/projects/<project_id>/`，`project_id = slugify(repo_basename) + sha1(repo_root)[:8]`。
- **FR-1.2** 所有写入走「临时文件 + `os.replace`」原子替换；进程级 `portalocker` 排他锁，防多 agent 并发改 `feature_list.json` 出现脏写。
- **FR-1.3** `FeatureListV1` schema：`schema_version: 1`、`features: [{id, title, description, acceptance_criteria, depends_on:[], priority:int, status: pending|in_progress|verified|committed|skipped, evidence: {commit_sha, verify_log_ref}, created_at, updated_at}]`。
- **FR-1.4** `StatusV1` schema：`schema_version: 1`、`active_feature_id`、`phase: initialize|implement|verify|commit`、`last_commit_sha`、`verify_pass_count`、`verify_fail_count`、`updated_at`。
- **FR-1.5** 状态机校验：`pending → in_progress → verified → committed` 单向；非法转移抛 `ProjectStateError`，写到 `progress.md` 一条 `[ERROR]` 行。
- **FR-1.6** `archive/feature_<id>.json` 在 committed 时写入完整快照（不再可改）。

### FR-2：项目级工具（P0）

**文件**：`agenticx/project_state/tools.py`，注册到 `agenticx/cli/agent_tools.py` 的 `STUDIO_TOOLS`

| 工具 | 用途 |
|------|------|
| `project_init` | （Initializer）输入 spec markdown / GitHub issue / 用户描述，产出初始 `feature_list.json` + `init.sh` 模板 + `verify.yaml` 模板，写 `progress.md` 首条记录，**不**自动 git commit（让模型显式调 bash_exec 走 confirm gate） |
| `project_status` | 读 `status.json` + `feature_list.json` 摘要（已 verified 数 / 总数 / 当前 active feature 标题与验收）+ 最近 N 行 progress.md |
| `feature_select` | 接收 `feature_id?`（缺省自动选优先级最高且依赖满足的 pending），置 `in_progress` 并写 `status.json.active_feature_id`、`phase=implement` |
| `feature_complete` | 校验 `verify_run` 已通过；置 `verified`，要求传入 `commit_sha`（由模型在 bash_exec 后回填）后置 `committed` 并写 archive |
| `progress_append` | 追加一条 `progress.md` 时间线（含 phase / feature_id / 摘要 / 自动加时间戳） |
| `verify_run` | 读 `verify.yaml`，按 type 派发：`shell`（init.sh / 自定义命令） / `pytest`（用例路径 + 选择器） / `npm` / `lint` / `e2e`（用户脚本）；输出结构化 `{passed, failed, summary, log_path}`，日志落 `archive/verify_<feature_id>_<ts>.log` |

所有工具默认走现有 confirm gate，FR-2.3 例外：`project_status` 与 `progress_append` 标记为 `requires_confirm=False`。

### FR-3：System Prompt 注入（P0）

**文件**：`agenticx/project_state/prompts.py` + `agenticx/runtime/agent_runtime.py:_build_agent_system_prompt`

- **FR-3.1** `build_project_state_blocks(session)`：当 `session.session_mode == "feature_loop"` 时返回项目卡片块（≤ 1.5K token）：
  - 当前 phase / active feature 标题与验收 / 已 verified 数 / 待办 top 5 标题
  - 最近 5 条 progress.md
  - 强约束：「禁止跳过 verify_run 直接 feature_complete」「禁止同时 in_progress 多个 feature」
- **FR-3.2** Initializer 与 Coding 两套 phase 提示模板，按 `status.phase` 选择；Initializer 模板要求产出 ≥ 5 个 feature 才允许切 phase。
- **FR-3.3** 注入位置：紧贴现有 scratchpad/todo 块之后，code_dev 块之前；与 code_dev 共存（feature_loop 进入 implement 阶段会自动启用 code_dev 相位规则）。

### FR-4：Mode 与 Session 路由（P0）

**文件**：`agenticx/runtime/session_mode.py` + `agenticx/cli/studio.py`（StudioSession）

- **FR-4.1** `session_mode.py` 新增 `FEATURE_LOOP = "feature_loop"`，`VALID_MODES = {CODE_DEV, DAILY_OFFICE, FEATURE_LOOP}`。
- **FR-4.2** `StudioSession.session_mode` 字段已存在，仅扩展校验。
- **FR-4.3** `feature_loop` 模式下首条 user message 触发自动 `project_status` 调用（runtime 侧侧车，不强写 user 消息），结果写 system prompt 块。
- **FR-4.4** 新建 session 创建时若 `mode=feature_loop` 但 `.agx/project/` 不存在 → 自动设 `phase=initialize`；存在但 `status.json` 损坏 → 报 `ProjectStateError` 并提示用户走 `/project repair`。

### FR-5：Initializer / Coding Skill（P1）

**文件**：`agenticx/skills/bundled/project-initializer/SKILL.md` + `agenticx/skills/bundled/feature-loop/SKILL.md`

- **FR-5.1** `project-initializer`：约束 Initializer Agent 步骤——读 spec → 拆 ≥ 5 个 deliverable → 调 `project_init` → 调 `bash_exec` 写 `init.sh` 与 `verify.yaml` → 调 `bash_exec` 跑首轮 `verify_run` 体检 → 调 `bash_exec git add .agx/project init.sh verify.yaml && git commit` → 调 `progress_append`。
- **FR-5.2** `feature-loop`：约束 Coding Agent 步骤——`project_status` → `feature_select` → `code_dev` Explore/Read/Author 完成实现 → `verify_run` → `bash_exec git add -A && git commit -m "feat(feature_id): ..."` → `feature_complete(commit_sha)` → `progress_append` → 选下一个或停。
- **FR-5.3** 两个 skill 默认随 bundle 安装，可在分身配置中关闭。

### FR-6：Verify Gate（P1）

**文件**：`agenticx/project_state/verify.py` + `verify.yaml`

- **FR-6.1** `verify.yaml` 支持的最小 schema：
  ```yaml
  schema_version: 1
  steps:
    - name: install
      type: shell
      cmd: bash .agx/project/init.sh
      timeout_sec: 600
    - name: pytest
      type: pytest
      args: ["-q", "tests/test_smoke_*.py"]
    - name: lint
      type: shell
      cmd: ruff check agenticx/project_state
  ```
- **FR-6.2** 任一 step 非 0 退出 → 整体失败；失败 step 名 + tail 100 行写入 `archive/verify_<feature>_<ts>.log` 并由 `progress_append` 引用。
- **FR-6.3** 单 step 超时 → 标记 timeout 状态，**不重试**（重试责任在 longrun 层，避免双重重试）。
- **FR-6.4** 走 confirm gate 与 bash_exec 同款白名单/超时策略，杜绝逃逸到 `..` 路径。

### FR-7：LongRun 桥接（P1）

**文件**：`agenticx/longrun/sources/project_feature_source.py` + `agenticx/longrun/__init__.py`

- **FR-7.1** `ProjectFeatureSource(TaskSource)` 实现 `fetch_pending_tasks()`，返回前 N 个 pending 且依赖满足的 feature，`task_id = f"feature::{project_id}::{feature_id}"`。
- **FR-7.2** `submit_fn` 内创建一个 `feature_loop` mode 的 worker session，注入 `feature_id`，跑完后视 `feature_complete` 是否成功决定 `wants_continuation`。
- **FR-7.3** 默认关；通过 `~/.agenticx/config.yaml` 的 `longrun.enabled=true` + `longrun.project_source.enabled=true` 双开关启用，避免误启动接管聊天。

### FR-8：Studio API & 冷启动 CLI（P2）

**文件**：`agenticx/studio/server.py` + `agenticx/cli/main.py`

- **FR-8.1** `GET /api/projects` 列出当前 workspace 下检测到的项目（多 repo / 多 workspace）。
- **FR-8.2** `GET /api/projects/<id>/status` 返回 `status.json` + `feature_list.json` 摘要。
- **FR-8.3** `GET /api/projects/<id>/progress?tail=100` 返回 `progress.md` 末尾 N 行。
- **FR-8.4** **只读**接口；任何写动作仍走 agent 工具链（避免 UI 旁路绕过 confirm gate）。
- **FR-8.5** CLI：`agx project resume <project_id>` —— 关掉 Machi、重启甚至换机器后，能基于 `.agx/project/` 重建一个新的 `feature_loop` session。

### FR-9：Desktop 只读面板（P2）

**文件**：`desktop/src/components/ProjectStatePanel.tsx`（新增）

- **FR-9.1** 复用现有 StickyTaskBar 区域：`mode == feature_loop` 时显示项目级状态条（active feature 标题 + 进度 X/Y + verify pass/fail 计数）。
- **FR-9.2** 新增 Project pane（在工作区 / Spawns / 历史之外的可选 tab），只读渲染 `feature_list.json` 与 `progress.md`；点击 feature 可跳转聊天区让 agent `feature_select` 它。
- **FR-9.3** 不做编辑 UI（避免 UI/CLI 双写口径分裂）。

### FR-10：配置与默认值（P0）

**文件**：`~/.agenticx/config.yaml`

```yaml
project_state:
  enabled: true              # 是否注册工具与 prompt 块（关掉则等同未实现，对现有用户零影响）
  default_root: ".agx/project"
  fallback_global_root: "~/.agenticx/projects"
  verify_gate:
    auto_run_after_implement: false   # 模型必须显式调 verify_run
    fail_writes_progress: true
  feature_loop_mode:
    enabled: true            # 是否允许 session_mode=feature_loop
    initializer_min_features: 5
```

**关键默认**：所有开关默认关，存量用户不受影响；项目仓库内出现 `.agx/project/` 时自动激活相关提示。

---

## 4. Non-Functional Requirements

- **NFR-1 零回归**：`daily_office` / `code_dev` 两种模式在 `project_state.enabled=false` 时行为完全不变；`agent_runtime` 主循环、`compactor`、`stall-recovery`、`longrun` 既有路径不动。
- **NFR-2 默认零开销**：`feature_loop` 不被任何会话默认选中；`build_project_state_blocks` 在非 feature_loop 模式直接返回空串；`agenticx/project_state/` 不在 `agent_runtime` 主路径 import（lazy import）。
- **NFR-3 模块边界**：所有新代码集中在 `agenticx/project_state/`，仅在以下 6 处留最小补丁：
  - `agenticx/cli/agent_tools.py`：注册 6 个工具
  - `agenticx/runtime/agent_runtime.py:_build_agent_system_prompt`：注入 prompt 块（一行）
  - `agenticx/runtime/session_mode.py`：新增 `FEATURE_LOOP` 常量
  - `agenticx/cli/studio.py`：StudioSession.session_mode 校验扩展
  - `agenticx/longrun/sources/__init__.py`：导出 `ProjectFeatureSource`
  - `agenticx/studio/server.py`：3 个只读 API（P2）
- **NFR-4 测试覆盖**：`agenticx/project_state/` 行覆盖 ≥ 85%；含 schema 校验、状态机非法转移、原子写入、verify timeout、longrun 桥接的端到端冒烟。
- **NFR-5 文档**：用户向指南 `docs/guides/project-state-harness.md`（含两阶段工作流截图位 + 故障排除）。
- **NFR-6 单进程假设**：进程级锁；多进程并发由调用方自律（`longrun` 已是单 orchestrator）；分布式编排不在范围。
- **NFR-7 安全**：`verify_run` 与 `init.sh` 路径必须 `relative_to(project_root)`；禁止 `~`、绝对路径、symlink 逃逸；命令走现有 bash_exec 白名单 + confirm gate。
- **NFR-8 可逆**：删除 `.agx/project/` 目录即可彻底退出该模式，不在用户仓库留下隐形修改。

---

## 5. Acceptance Criteria

- **AC-1**：`pytest tests/test_smoke_project_state.py -v` 全绿，覆盖：
  - `feature_list.json` 原子写 + 锁竞争
  - 状态机非法转移抛 `ProjectStateError`
  - committed 后写 archive 不可逆
  - `progress.md` append-only 顺序保持
  - `verify_run` 超时 / 失败 / 通过三路径
- **AC-2**：`pytest tests/test_smoke_project_state_e2e.py -v` 全绿（dummy LLM）：
  - 模拟 Initializer：spec.md → `project_init` → ≥ 5 个 feature → `bash_exec` 模拟 → 首次 commit
  - 模拟 Coding 单轮：`feature_select` → `code_dev` 写文件 → `verify_run` → `feature_complete` → archive 落盘
  - 冷启动：删除 SQLite 后 `agx project resume` 能重建 session
- **AC-3**：`AGX_PROJECT_STATE_DISABLED=1` 时所有现有冒烟（`tests/test_smoke_*.py`）保持绿；`pytest --collect-only` 无明显增时（≤ 5%）。
- **AC-4**：`mode=daily_office` / `mode=code_dev` 下不出现 `feature_loop` 相关提示注入（用 prompt 快照断言）。
- **AC-5**：`GET /api/projects/<id>/status` 在 P2 完成后返回 `status.json` 的 JSON 序列化结果且与磁盘字节级一致（除时间戳格式化）。
- **AC-6**：手工演练脚本 `scripts/demo_project_state.sh` 在干净 repo 上跑通 Initializer + 1 个 feature 完整闭环，落到 `docs/demos/project-state-2026-05-XX.md`。

---

## 6. 任务清单（按 Phase 拆分）

> 每个 commit 必须带 `Plan-Id: 2026-05-22-project-state-harness` 与 `Plan-File:` trailer + `Made-with: Damon Li`，使用 `/commit --spec=.cursor/plans/2026-05-22-project-state-harness.plan.md` 自动注入。

### Phase 1（P0，独立可用，不依赖 longrun）

- [ ] **P1-T1** 实现 `agenticx/project_state/{__init__,schema,store,feature_list,progress}.py`，含 portalocker 锁与原子写入。
- [ ] **P1-T2** 实现 `agenticx/project_state/verify.py` + `init_script.py`（不含 longrun 桥）。
- [ ] **P1-T3** 实现 `agenticx/project_state/tools.py`，注册到 `STUDIO_TOOLS`。
- [ ] **P1-T4** 实现 `agenticx/project_state/prompts.py`，在 `_build_agent_system_prompt` 增加一行 lazy 注入。
- [ ] **P1-T5** `session_mode.py` 增加 `FEATURE_LOOP`，扩展校验。
- [ ] **P1-T6** `~/.agenticx/config.yaml` schema 加 `project_state` 节，`config_manager.py` 解析。
- [ ] **P1-T7** 编写 `tests/test_smoke_project_state.py` 覆盖 AC-1。
- [ ] **P1-T8** 跑 `pytest tests/test_smoke_*.py` 全量抽样，确认 AC-3。
- [ ] **P1-T9** commit + `/update-conclusion --plan=...`。

**Phase 1 验收**：AC-1 + AC-3 + AC-4 通过。

### Phase 2（P1，双阶段产品化 + longrun 桥）

- [ ] **P2-T1** 落 `agenticx/skills/bundled/project-initializer/SKILL.md` + `feature-loop/SKILL.md`，注册到 bundle。
- [ ] **P2-T2** Initializer / Coding 提示模板分支按 `status.phase` 切换。
- [ ] **P2-T3** `agenticx/longrun/sources/project_feature_source.py` + 单测。
- [ ] **P2-T4** 端到端冒烟 `tests/test_smoke_project_state_e2e.py` 用 dummy LLM 驱动 1 轮 Initializer + 1 个 feature。
- [ ] **P2-T5** 文档 `docs/guides/project-state-harness.md` 与 demo 脚本。
- [ ] **P2-T6** commit + conclusion。

**Phase 2 验收**：AC-2 通过；longrun 桥与现有 stall/retry 在 dummy 任务下行为正确。

### Phase 3（P2，Studio API + Desktop 只读 + CLI）

- [ ] **P3-T1** Studio 3 个只读 API + 路由 token 校验。
- [ ] **P3-T2** Desktop `ProjectStatePanel.tsx` + StickyTaskBar 扩展（只读）。
- [ ] **P3-T3** `agx project resume <id>` CLI（基于现有 `agx serve` 启动逻辑）。
- [ ] **P3-T4** 手工演练脚本 + demo 文档。
- [ ] **P3-T5** commit + conclusion。

**Phase 3 验收**：AC-5 + AC-6 通过；Desktop 只读不阻断 agent 工具写路径。

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Initializer 一次拆错清单 → 后续全错轨道 | 长程稳定但方向偏 | `project_init` 输出后强制人 review；`feature_list` 可在 phase=initialize 阶段反复改写，进入 implement 后改写需走显式工具 + progress.md 留痕 |
| 用户已有自家进度文件命名冲突 | 误改用户文件 | 命名空间锁死 `.agx/project/`；fallback 全局根；不写仓库根任何文件 |
| `verify_run` 误执行危险脚本 | 安全 | 复用现有 bash_exec 白名单 + confirm gate + `relative_to` 约束 |
| longrun 桥与人工聊天串台 | UX 混乱 | 双开关默认关；worker session id 用 `__project_worker__` 前缀，UI 历史隔离 |
| `.agx/project/` 与 git 冲突 | 多人协作 merge 不顺 | `feature_list.json` 写入用稳定 key 顺序 + 末尾 newline，便于 3-way merge；archive 用 commit sha 做不可变快照 |
| 新增 system prompt token 占用 | context 压力 | 块上限 1.5K；`feature_loop` 非默认模式；`code_dev` 块在 implement 阶段共用 |
| 冷启动 resume 找不到 project | 体验差 | CLI 与 API 强校验路径；缺失时给出清晰修复指引（重跑 `project_init` 或 `--fallback-global`）|

---

## 8. 与既有 plan 的关系

- **`2026-05-07-symphony-longrun-internalization`**：本 plan **复用**其 `LongRunOrchestrator/TaskWorkspace/Stall/Retry/TokenAccountant`，只新增一个 `TaskSource` 实现，不动其内核。
- **`2026-05-19-machi-code-mode-harness`**：本 plan 在 `feature_loop` 模式下**复用** code_dev 三相位作为 implement 阶段的内层执行规则。
- **`2026-05-19-machi-task-stall-recovery`**：本 plan 不替换其 SSE/`execution_state` 机制，仅在 longrun 桥下额外提供「任务级」stall 兜底。
- **`2026-05-20-machi-unattended-continuation`**：本 plan 是其「无人值守」目标的**项目级状态外置**层，前者偏会话内续跑，本 plan 偏跨 session 单一事实源。

---

## 9. 输出物清单

代码：

- `agenticx/project_state/{__init__,schema,store,feature_list,progress,verify,init_script,tools,prompts,sources}.py`
- `agenticx/longrun/sources/project_feature_source.py`
- `agenticx/skills/bundled/project-initializer/SKILL.md`
- `agenticx/skills/bundled/feature-loop/SKILL.md`
- `tests/test_smoke_project_state.py`
- `tests/test_smoke_project_state_e2e.py`
- `desktop/src/components/ProjectStatePanel.tsx`（P2）

文档：

- `docs/guides/project-state-harness.md`
- `docs/demos/project-state-2026-05-XX.md`

配置：

- `~/.agenticx/config.yaml` 的 `project_state` 节（schema + 默认值）
