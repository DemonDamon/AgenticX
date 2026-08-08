# AgenticX Project State 模块总结

> 结论生成时间：2026-05-29（首次创建，覆盖当前代码）

## 模块概述

AgenticX Project State 模块为长周期编码智能体提供一套**磁盘落盘的项目级状态机**，作为可跨会话重置、跨机器迁移、即使 SQLite 被清空也能存活的「单一事实来源」。它建立在 `agenticx/longrun` 与 code_dev harness 模式之上，核心是「特性列表（FeatureList）+ 状态游标（Status）+ 进度时间线（progress.md）+ 验证门（verify.yaml）+ 归档（archive）」，通过严格的特性状态机与 phase 阶段约束，让智能体在「初始化 → 实现 → 验证 → 提交」的循环中可靠推进。

对应参考 commit：`5a9e61ae`（disk-backed project state store and tools）。

## 目录结构

```
agenticx/project_state/
├── __init__.py        # 导出 schema 常量/模型 与 store 入口
├── schema.py          # FeatureListV1 / StatusV1 / Feature 模型 + 状态机转移规则
├── store.py           # ProjectStore：路径解析、文件锁、原子写、归档
├── feature_list.py    # 特性列表变更（upsert/transition/select_next/commit）
├── progress.py        # progress.md 时间线格式化
├── init_script.py     # init.sh / verify.yaml 模板生成
├── verify.py          # verify.yaml 验证步骤执行器
├── prompts.py         # 项目状态相关提示词构建
└── tools.py           # STUDIO_TOOLS 兼容的 project_state_tool_* 工具实现
```

## 核心组件分析

### 状态模型与状态机（schema.py）

- **Phase 阶段**：`initialize` / `implement` / `verify` / `commit`（`VALID_PHASES`）。
- **Feature 状态**：`pending` / `in_progress` / `verified` / `committed` / `skipped`，并以 `_ALLOWED_TRANSITIONS` 定义合法的前向转移（如 verified → committed，committed 为终态），`is_valid_transition` 拒绝非法跳转。
- **Feature**：dataclass，含 id、title、description、`acceptance_criteria`、`depends_on`、priority、status、evidence、时间戳；`from_dict` 做了非空 id/title、状态合法性、列表/字典类型等严格校验。
- **FeatureListV1 / StatusV1**：版本化（`schema_version=1`）payload；FeatureList 反序列化检查特性 id 唯一性；Status 记录 phase、`active_feature_id`、`last_commit_sha`、verify 计数、`initializer_min_features`、`project_id` 等游标。

### 存储层 ProjectStore（store.py）

负责「在哪里读写、如何安全读写」：

- **路径解析（locate_project_root）**：优先 `<workspace>/.agx/project/`，否则回退到全局 `~/.agenticx/projects/<project_id>/`；`project_id` 由仓库绝对路径 sha1 派生（`<slug>-<8位hash>`）保证稳定。
- **跨平台文件锁（_file_lock）**：POSIX 用 `fcntl.flock`，Windows 用 `O_CREAT|O_EXCL` 哨兵文件轮询，均带超时（默认 30s）。
- **原子写（_atomic_write_text/json）**：临时文件 + `fsync` + `os.replace`，避免写中断损坏；JSON 以 `sort_keys=True` 稳定输出。
- **读写 API**：`load/save_feature_list`、`load/save_status`、`append_progress` / `read_progress_tail`、`write_archive`（committed 特性的不可变快照，重复归档报错）、`archive_log`（verify 日志）、`safe_relative`（路径越界保护，强制落在 root 下）。

### 特性列表变更（feature_list.py）

带状态机校验的特性操作：

- **upsert_features**：批量新增/更新特性，默认保留已有 status（`allow_status_overwrite` 控制），保证 Initializer 阶段重写安全。
- **transition_feature**：依据 `is_valid_transition` 校验后迁移状态并合并 evidence，非法转移抛 `ProjectStateError`。
- **select_next_pending**：选出依赖全部 committed 的最高优先级 pending 特性（按 priority、创建时间、id 排序）。
- **has_active_in_progress / summarize**：查询当前 in_progress 特性、产出各状态计数摘要。
- **commit_active_feature**：要求特性先 verified、commit_sha 非空，迁移到 committed 并写入归档快照（含 committed_at）。

### 进度时间线（progress.py）

`format_progress_line` 给消息加 ISO-8601 时间戳标记（已是 `- [` 开头的预格式化行不重复打标），多行内容缩进续行；`ensure_progress_header` 写入「append-only、勿改历史行」的标准头部。

### 初始化模板（init_script.py）

`write_default_init_script` 生成幂等的 `init.sh`（含 set -euo pipefail、依赖安装/迁移/编译占位）并置可执行位；`write_default_verify_yaml` 生成 `verify.yaml` 模板（默认含 bootstrap 步骤与 pytest/lint 注释示例）。

### 验证执行器（verify.py）

`run_verify` 读取并校验 `verify.yaml`（schema_version=1，步骤类型限 `shell`/`pytest`/`npm`/`lint`），逐步以 `subprocess.run` 在 workspace 下执行（带 timeout，默认 600s），首个失败即停止；产出 `VerifyResult`（passed、各 StepResult、summary），并把完整日志写入 archive。`StepResult` 记录退出码、耗时、是否超时与日志末尾摘要。

### 工具层（tools.py）

`PROJECT_STATE_TOOL_NAMES` 暴露 6 个 STUDIO_TOOLS 兼容工具：`project_init`、`project_status`、`feature_select`、`feature_complete`、`progress_append`、`verify_run`；每个返回 `{"ok": ...}` 形态的 JSON 字符串（`_ok`/`_err` 包装），供 LLM 工具结果直接消费。

## 设计模式

1. **状态机模式**：Feature 状态与 phase 阶段均以显式转移表约束，所有非法跳转集中拒绝。
2. **仓储（Repository）模式**：`ProjectStore` 把路径解析、锁、原子写、归档封装为统一读写门面。
3. **版本化 Schema**：`FeatureListV1`/`StatusV1`/verify schema 均带 `schema_version`，反序列化强校验，为未来演进留兼容位。
4. **原子写 + 文件锁**：跨平台锁 + 临时文件替换，保障多会话/多进程并发下的数据完整性。
5. **模板方法**：init.sh / verify.yaml 以可编辑模板生成，约定优于配置。

## 技术亮点

1. **外部单一事实来源**：状态落盘到 `.agx/project/` 或全局回退目录，独立于 SQLite/会话，跨会话与跨机器存活。
2. **稳定 project_id**：由仓库绝对路径 sha1 派生，保证同一仓库在不同时刻解析到同一全局状态目录。
3. **严格状态机**：特性转移、commit 前置 verified、commit_sha 必填、归档不可覆盖，杜绝状态错乱。
4. **跨平台并发安全**：POSIX flock 与 Windows 哨兵文件双实现，叠加原子写，适配多端运行。
5. **路径越界保护**：`safe_relative` 强制所有写入落在项目 root 内，防止状态机被诱导写出目录。
6. **可审计的验证门**：verify.yaml 步骤化执行 + 完整日志归档，使每次「verified」可追溯。

## 应用场景

1. **长周期自动编码**：智能体按「初始化 → 实现 → 验证 → 提交」循环逐个交付特性，断点续跑不丢状态。
2. **跨会话/跨机器续作**：换机器或重置会话后从磁盘恢复特性列表与游标，继续未完成工作。
3. **特性级验收闭环**：每个特性带验收标准与 evidence，verify 通过并提交后归档快照，形成可审计记录。
4. **依赖编排**：按 `depends_on` 与优先级自动选取下一个可执行特性。

## 总结

Project State 模块以「磁盘落盘的项目级状态机」为长周期编码智能体提供可靠的进度与状态底座：schema 定义版本化模型与严格状态机，store 以文件锁 + 原子写 + 路径保护保障并发与完整性，feature_list/verify/progress/tools 则把「选特性 → 实现 → 验证 → 提交 → 归档」串成可审计的闭环。其核心价值在于「外部单一事实来源」——让智能体的工作进度独立于会话与 SQLite 而长期存活、可恢复、可追溯。
