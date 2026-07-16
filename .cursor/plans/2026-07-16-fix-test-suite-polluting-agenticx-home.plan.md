# Fix: pytest 测试套件污染真实 `~/.agenticx` 导致 Near 历史对话出现虚假会话

Planned-with: claude-sonnet-4.5-thinking
Suggested-Impl-Model: claude-sonnet-4.5-thinking

## 问题描述（用户报告）

Near 桌面端"历史对话"面板中出现大量用户从未提问过的会话，例如：
- "看看附件"、"总结简历"、"看看这些文件"
- "hello"、"first"、"retry me"
- "执行一次并发任务"、"创建一个子智能体"、"请并行完成任务"
- "Redis与MySQL常用命令速查"（用户截图 2）

用户判定为严重生产级 bug，要求彻底排查并解决。

## 根因（Root Cause，已用证据链确认）

1. `agenticx/studio/session_manager.py:455-456`：`SessionManager.__init__` 将会话落盘路径硬编码为：
   ```python
   self._sessions_root = os.path.join(os.path.expanduser("~"), ".agenticx", "sessions")
   ```
   没有任何环境变量/参数可覆盖，且在 `__init__` 时机计算（非模块加载期缓存）。

2. `tests/test_studio_server.py` 等 17 个测试文件里，共 55+ 处直接调用 `agenticx/studio/server.py::create_studio_app()`（内部 `manager = SessionManager()`），**全程没有对 `HOME`/`AGENTICX_HOME` 做任何隔离**。仓库此前也不存在任何 `tests/conftest.py` 做全局隔离。

3. 结果：每次本地跑 `pytest tests/test_studio_server.py`（或其他直接调用 `create_studio_app()` 的测试文件），测试里固定的 `user_input` 文案（如 `"hello"`、`"总结简历"`、`"看看附件"`、`"创建一个子智能体"`）连同 mock LLM 的固定回复（如 `"done"`、`"主智能体汇总完成"`、`"sub done"`）会被真实写入开发者本机 `~/.agenticx/sessions/<uuid>/messages.json`，与真实 Near 会话完全混在一起。Near Desktop 的历史面板按目录枚举展示会话标题，于是这些测试夹具被当作真实历史对话展示出来。

4. 证据链：
   - `tests/test_context_file_attachment_*` 系列测试用 `tmp_path` 生成的附件路径形如
     `/private/var/.../T/pytest-of-damon/pytest-37/test_context_file_attachment_s0/gone.pdf`，
     该路径原样出现在被污染会话的 `attachments[].source_path` / `context_files_refs.json` 中——与用户截图 1 中"看看附件"等会话完全对应。
   - `tests/test_studio_server.py:657/689/720/774` 精确对应 `"请并行完成任务"`/`"执行一次并发任务"`/`"创建一个子智能体"` 三条被污染会话，assistant 消息里的固定标记（`"准备启动子智能体"`、`agent_id: "sa-*"`、`name: "执行者"`、`"sub done"`、`"主智能体汇总完成"`）与 `_MetaSpawnLLM`/`_SubTextLLM` mock 实现逐字对应。
   - 用户截图 2 的"Redis与MySQL常用命令速查"会话（`session_id=339362d9...`）**未命中**上述任一测试指纹，且其 `context_stats.jsonl` 显示真实 22K token 的完整 meta-agent 上下文注入，`checkpoints`/`evaluations` 目录也有对应真实 hook 记录——判定为**真实历史对话**，非测试污染，已保留不做任何清理，需用户自行确认是否为本人操作。

## 修复（已实施）

### 代码修复
- 新增 `tests/conftest.py`：全局 `autouse` fixture，在每个测试运行前把 `$HOME`（及 Windows 下 `%USERPROFILE%`）monkeypatch 到 pytest 提供的隔离 `tmp_path` 子目录。
  - 只改这一个文件，不触碰 `agenticx/` 下任何生产代码，不触碰任何测试文件本身的断言逻辑——严格遵守 no-scope-creep。
  - 因为 `Path.home()`/`os.path.expanduser("~")` 在 POSIX 上读取 `$HOME` 环境变量，这一改动对全仓库任何在测试运行期动态计算 home 路径的代码（`SessionManager.__init__` 等）自动生效，无需逐一改造 60+ 个引用 `Path.home()` 的模块。
  - **已知残留风险（本次不处理，超出报告的具体 bug 范围）**：少数模块在**模块导入期**就计算了 `Path.home()`（如 `agenticx/workspace/loader.py:21`、`agenticx/brain/registry.py:29`、`agenticx/extensions/installer.py:35` 的模块级常量），若这些模块在 conftest fixture 生效前已被首次 import 并缓存进 `sys.modules`，其常量不会随每个测试重新计算。这类模块级路径常量不是本次会话历史污染 bug 的成因（`SessionManager` 是在 `__init__` 时机现算路径，不受此限制），因此未纳入本次修复范围。

### 数据清理（已执行，可回退）
- 用双重高置信度信号扫描 `~/.agenticx/sessions/`：
  1. 附件/上下文引用路径包含 `pytest-of-`；
  2. 会话内**全部** user 消息文案与**全部** assistant 消息文案分别精确匹配 `test_studio_server.py` 中的固定测试文案 / mock LLM 固定回复集合；
  3. 会话命中 `_MetaSpawnLLM` 子智能体固定标记（`"准备启动子智能体"`、`"主智能体汇总完成"`、`agent_id` 前缀 `"sa-"`）且首条 user 消息为已知测试文案。
- 命中 44 个会话目录，**移动（非删除）**到 `~/.agenticx/_quarantine_pytest_pollution_20260716/`，保留可回退能力。
- 同步清理 `~/.agenticx/memory/sessions.sqlite` 的 `session_messages` FTS 索引中对应 44 个 `session_id` 的 219 条索引行，避免"跨会话搜索"功能仍能检索到这些已隔离的测试夹具内容。
- 未触碰 `checkpoints/`、`evaluations/`、`taskspaces/` 等目录——这些是运行时 hook（`session_checkpoint`/`session_evaluator`）产生的历史积累数据，不在用户报告的"历史对话列表污染"范围内，且其规模（4406/1899 个文件）横跨数月，逐一甄别需要独立评估，超出本次范围。

## 验证（Acceptance Criteria）

- AC-1：`source .venv/bin/activate && python -m pytest tests/test_studio_server.py -q -c /dev/null`
  - 修复前后 pass/fail 数一致（27 passed / 3 failed，3 个失败为修复前已存在的与本次改动无关的既有失败，未引入新失败）。
  - 修复前 `~/.agenticx/sessions` 目录条目数在跑一次该测试文件后会增加（污染发生）；修复后同一次跑（`608 → 608`）不再新增任何目录——已实测验证。
- AC-2：`grep -rl "pytest-of-" ~/.agenticx/sessions` 返回空（清理前 3 个残留文件，清理后 0）。
- AC-3：`~/.agenticx/_quarantine_pytest_pollution_20260716/` 下可核对全部 44 个被隔离会话目录，用户如有异议可随时从该目录移回 `~/.agenticx/sessions/` 还原。

## Out of Scope（明确不做）

- 不重构 60+ 个直接使用 `Path.home()`/`os.path.expanduser("~")` 的生产模块为统一的 `AGENTICX_HOME` 配置抽象——这是更大的系统性重构，需要独立评估与规划，非本次报告 bug 的必要修复范围。
- 不清理 `checkpoints/`、`evaluations/`、`taskspaces/`、`usage.sqlite` 中可能同样存在的历史测试污染——这些不出现在 Near 历史对话面板，不在用户报告症状范围内。
- 不处理"Redis与MySQL常用命令速查"会话——判定为真实对话，交由用户自行确认。
