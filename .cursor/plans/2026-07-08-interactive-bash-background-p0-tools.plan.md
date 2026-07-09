# P0 — 后台 bash 任务工具族（bash_bg_start/poll/input/stop）

Planned-with: claude-opus-4.8
Suggested-Impl-Model: gpt-5.3-codex

> 父规划：`.cursor/plans/2026-07-08-interactive-bash-background-main.plan.md`
> 本子规划纯后端，改动集中在 `agenticx/cli/agent_tools.py`、`agenticx/runtime/prompts/meta_agent.py`，新增 `tests/` 冒烟测试。**独立可交付**：完成后即端到端解决"交互式命令超时 + 二维码不可见"。

---

## 根因回顾（不依赖对话记忆）

`agenticx/cli/agent_tools.py` 的 `_tool_bash_exec`（`2696` 起）一次性 `asyncio.wait_for(..., timeout=timeout_sec)`，超时即 `proc.kill()` 并丢弃已捕获 stdout（见父规划 2902-2917 引用）。默认 30s。因此 `lark-cli config init --new` 这类"打印二维码后阻塞等扫码"的命令必然被误杀，二维码从不回传。前端不消费 `tool_output` 流（`desktop/src` grep 无命中），交互内容只能靠工具返回值文本回传。

---

## 改动点总览（精确落点）

| # | 文件 | 位置/锚点 | 改动 |
|---|---|---|---|
| 1 | `agenticx/cli/agent_tools.py` | 从 `_tool_bash_exec`（`2696`）内 `command` 解析(`2703`)→`argv` 构造(`2862`)之间的校验逻辑 | 抽取为 `_bash_exec_prepare(...)`，同步路径改为调用它；行为逐行等价 |
| 2 | `agenticx/cli/agent_tools.py` | 新增模块级注册表与数据类（建议紧邻 `_tool_bash_exec` 之前，约 `2696` 上方） | `_BashBgJob` dataclass + `_BASH_BG_JOBS: Dict[str, _BashBgJob]` + 辅助函数 |
| 3 | `agenticx/cli/agent_tools.py` | 新增 4 个工具函数（建议置于 `_tool_bash_exec` 之后） | `_tool_bash_bg_start / _tool_bash_bg_poll / _tool_bash_bg_input / _tool_bash_bg_stop` |
| 4 | `agenticx/cli/agent_tools.py` | `STUDIO_TOOLS` 列表（`302`起，`bash_exec` schema 在 `375-396`） | 追加 4 个工具的 schema（`bash_exec` 后紧邻插入） |
| 5 | `agenticx/cli/agent_tools.py` | `dispatch_tool_async`（`6583`），`bash_exec` 分支在 `6651-6652` | 追加 4 个 `if name == ...` 分支 |
| 6 | `agenticx/cli/agent_tools.py` | `_CONCURRENCY_SAFE_STUDIO_TOOLS`（`123-150`） | 仅追加只读的 `"bash_bg_poll"` |
| 7 | `agenticx/runtime/prompts/meta_agent.py` | cc_bridge 规则块 / 执行纪律段（`~854-868`） | 追加"交互式/长驻命令强约束"规则 |
| 8 | `tests/` | 新增 `tests/test_smoke_bash_bg.py` | 冒烟测试（见 AC） |

> **纪律**：以上均为「新增分支/新增行」为主；唯一的既有代码重构是 #1 抽取，须保证 `_tool_bash_exec` 行为不变（既有 bash 冒烟测试跑绿即证明）。触碰 import 区/列表/分支只精确增删目标行，禁止整段替换。

---

## FR-1：抽取 `_bash_exec_prepare` 共享校验（重构，行为等价）

**现状**：`_tool_bash_exec`（`2696-2862`）依次做：命令长度检查、`tool_denied_by_session_permissions`、`timeout_sec` 解析、`cwd` 解析、`shlex.split`、`cd` 前缀剥离、MCP 工具名拦截、standalone `cd`、`SAFE_COMMANDS` 二次确认、`_command_touches_protected_config` 阻断、`PATH_GUARDED_READ_COMMANDS` 路径校验、`python` 脚本路径校验、风险原因收集与高危二次确认、`use_shell` 判定、（Windows）`shutil.which`、`argv` 构造。之后（`2864`起）才 spawn + wait。

**改动**：把「`cwd` 解析之后 ~ `argv` 构造完成」这段**与 timeout 无关**的校验+构造抽成一个可复用异步函数。`timeout_sec` 解析保留在 `_tool_bash_exec` 内（后台路径不用 timeout）。

**新增函数签名（伪代码意图）**：

```python
@dataclass
class _BashPrepared:
    argv: List[str]
    cwd: Optional[Path]
    use_shell: bool
    command: str          # 可能被 cd-peel 改写后的命令
    command_name: str

async def _bash_exec_prepare(
    command: str,
    arguments: Dict[str, Any],
    session: Optional[StudioSession],
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any],
) -> Union[_BashPrepared, str]:
    """Shared validation + argv construction for bash_exec and bash_bg_*.

    Returns _BashPrepared on success, or a str message (ERROR:/CANCELLED:/OK: cd ...)
    that the caller must return verbatim to the model.
    """
    # 复制现有 2703(长度)/2709(perm)/2724(cwd)/2733(shlex)/2740(cd-peel)/
    # 2750(MCP name)/2770(standalone cd)/2784(SAFE_COMMANDS confirm)/
    # 2796(protected config)/2802(path guard)/2808(python)/2816(risk+高危confirm)/
    # 2849(use_shell)/2858(win which)/2862(argv) 的逻辑，原样保留。
```

**`_tool_bash_exec` 改造后骨架**：

```python
async def _tool_bash_exec(arguments, session=None, *, confirm_gate, emit_event=None):
    command = str(arguments.get("command", "")).strip()
    if not command: return "ERROR: missing command"
    if len(command) > MAX_BASH_EXEC_COMMAND_CHARS: return "ERROR: ..."
    # timeout 解析（保留原 2713-2723 逻辑）
    timeout_sec = ...
    prepared = await _bash_exec_prepare(command, arguments, session,
                                        confirm_gate=confirm_gate, emit_event=emit_event)
    if isinstance(prepared, str):
        return prepared            # ERROR / CANCELLED / "OK: cd ..." 原样返回
    # 用 prepared.argv / prepared.cwd 走原有 spawn + wait_for(timeout) + 结果拼装（2864-末尾）不变
```

**AC-1**：
- `pytest tests/test_smoke_bash_exec_redirect.py tests/test_smoke_bash_exec_output_hint.py tests/test_agent_tools.py -q` 全绿（证明抽取无行为回归）。
- 非白名单命令（如 `foobar`）经 `bash_exec` 仍触发 `_confirm`；`cat ~/.agenticx/config.yaml` 仍返回 protected config 阻断串；`rm -rf x` 仍进高危确认路径。

---

## FR-2：后台任务注册表与数据结构

**新增模块级对象**（紧邻 `_tool_bash_exec` 前）：

```python
_BASH_BG_LOG_DIR = Path.home() / ".agenticx" / "logs" / "bash_bg"
_BASH_BG_MAX_JOBS_DEFAULT = 8
_AUTH_URL_RE = re.compile(r"https?://[^\s'\"<>）)]+")

@dataclass
class _BashBgJob:
    job_id: str
    session_id: str            # 归属校验用
    command: str
    cwd: Optional[str]
    proc: asyncio.subprocess.Process
    lines: List[str]           # 累积输出（stdout+stderr 合并，按到达顺序）
    read_cursor: int           # bash_bg_poll 已返回到的行下标
    started_at: float
    log_path: Path
    drain_task: Optional[asyncio.Task]  # 持有引用防 GC
    exit_code: Optional[int]   # None=running

_BASH_BG_JOBS: Dict[str, _BashBgJob] = {}
```

**辅助函数**：
- `def _bash_bg_first_wait_sec() -> float`：读 `tools_options.bash_bg.first_wait_sec`（默认 4.0，clamp 1.0–15.0），实现同 `_bash_exec_default_timeout_sec` 的 `ConfigManager.get_value` + try/except 范式。
- `def _bash_bg_max_jobs() -> int`：读 `tools_options.bash_bg.max_jobs`（默认 8，clamp 1–32）。
- `def _extract_auth_urls(text: str) -> List[str]`：`_AUTH_URL_RE.findall` 去重保序，最多返回前 5 条。
- `def _bash_bg_owned_job(job_id, session) -> Union[_BashBgJob, str]`：查表 + 归属校验（`job.session_id == getattr(session,"session_id",...)`），失败返回 `"ERROR: unknown or not-owned job_id: <id>"`。

**drain 协程**（后台持续把 stdout/stderr 合并写入 `job.lines` + 追加写日志文件，进程结束时回填 `exit_code`）：

```python
async def _bash_bg_drain(job: _BashBgJob) -> None:
    async def _pump(stream, prefix):
        async for raw in stream:
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            job.lines.append(line)
            try:
                with job.log_path.open("a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
            except Exception:
                pass
    await asyncio.gather(_pump(job.proc.stdout, "out"), _pump(job.proc.stderr, "err"))
    await job.proc.wait()
    job.exit_code = job.proc.returncode
```

> 说明：`agx serve` 是常驻 uvicorn 事件循环，`asyncio.create_task(_bash_bg_drain(job))` 会在工具返回后继续运行；`job.drain_task` 持有引用防止被 GC。stdout/stderr 均用 `PIPE`；stdin 用 `PIPE`（供 `bash_bg_input`）。

**AC-2**：注册表创建/查表/归属校验正确；`~/.agenticx/logs/bash_bg/` 不存在时首次 start 自动 `mkdir(parents=True, exist_ok=True)`。

---

## FR-3：`bash_bg_start` 工具

**行为**：
1. 参数：`command`（必填）、`cwd`（可选）、`first_wait_sec`（可选，覆盖默认）。
2. 若 `len(_BASH_BG_JOBS 中该 session 未结束的 job) >= _bash_bg_max_jobs()` → 返回 `ERROR: too many running background jobs (max N). Stop one with bash_bg_stop first.`
3. 调 `_bash_exec_prepare(...)` 复用全部安全闸门；若返回 str（ERROR/CANCELLED/OK cd）→ 原样返回（不启动进程）。
4. `mkdir` 日志目录；`job_id = uuid4().hex[:12]`；`create_subprocess_exec(*prepared.argv, stdin=PIPE, stdout=PIPE, stderr=PIPE, cwd=prepared.cwd)`（`use_shell` 时 argv 已是 `["/bin/bash","-c",cmd]`，与同步路径一致）。
5. 构造 `_BashBgJob`，`drain_task = asyncio.create_task(_bash_bg_drain(job))`，登记入表。
6. **有界等待首屏**：在 `first_wait_sec` 内轮询 `job.exit_code` 与 `len(job.lines)`（如每 0.2s，直到超时或进程已退出）。
7. 组装返回文本：

```
job_id=<id>
status=<running|exited>
exit_code=<n|null>
cwd=<abs or (session workspace)>
command=<command>
captured_output:
<迄今 job.lines 拼接，(empty) 若无>
auth_urls:
- https://...            # 若有；否则该段写 (none)
NOTE: 进程已在后台运行，未被超时杀死。
- 若 auth_urls 非空：请把链接原样转述给用户，请其扫码/授权；在用户确认完成前，最多每 15-30s 调用一次 bash_bg_poll，禁止高频轮询，禁止此时 bash_bg_stop。
- 若命令需要键入应答(y/n/选项)：用 bash_bg_input(job_id, text) 写入。
- 用户确认完成后再调用 bash_bg_poll 读取最终 exit_code 与输出，据此汇报结果。
```

8. 起始时将 `job.read_cursor = len(job.lines)`（首屏已在返回值里给出，poll 只返回新增）。

**schema**（插入 `STUDIO_TOOLS` 中 `bash_exec` schema 之后）：

```json
{"type":"function","function":{"name":"bash_bg_start","description":"Start an INTERACTIVE or long-running shell command in the background (does NOT time out). Use this instead of bash_exec for commands that print a QR code / auth URL and wait for the user to scan/authorize (e.g. `lark-cli config init --new`, `gh auth login`, `docker login`), or that block waiting for input. Returns a job_id, the first-screen output, and any detected auth URLs. Reuses all bash_exec safety gates.","parameters":{"type":"object","properties":{"command":{"type":"string","description":"Command to run in background."},"cwd":{"type":"string","description":"Working directory (preferred over leading cd)."},"first_wait_sec":{"type":"integer","description":"Seconds to collect first-screen output before returning (default 4, max 15)."}},"required":["command"],"additionalProperties":false}}}
```

**AC-3**：
- `bash_bg_start` 跑 `echo hello`：返回 `status=exited`、`exit_code=0`、`captured_output` 含 `hello`。
- 跑一个"打印一行 URL 后 `sleep 30`"的脚本：`first_wait_sec` 内返回 `status=running`、`auth_urls` 含该 URL、进程未被杀（`job.exit_code is None`）。
- 非白名单命令仍触发确认（复用 `_bash_exec_prepare`）。
- 超过 max_jobs 返回明确 ERROR。

---

## FR-4：`bash_bg_poll` 工具（只读）

**行为**：参数 `job_id`（必填）。`_bash_bg_owned_job` 校验；返回 `job.lines[job.read_cursor:]` 增量 + `status`/`exit_code`，并把 `read_cursor` 推进到末尾。返回文本：

```
job_id=<id>
status=<running|exited>
exit_code=<n|null>
new_output:
<自上次 poll 以来的新增行，(none) 若无>
auth_urls:            # 对新增输出再抽一次，方便二维码是后打印的场景
- ...
```

- 若 `status=running` 且 `new_output=(none)`：追加提示 `HINT: 仍在运行且无新输出，可能在等待用户扫码/授权或输入；请勿高频轮询。`

**schema**：`required:["job_id"]`，`properties: {job_id:{type:string}}`。加入 `_CONCURRENCY_SAFE_STUDIO_TOOLS`。

**AC-4**：连续两次 poll，第二次只返回两次之间的新增行；进程结束后 poll 返回 `status=exited` 与正确 `exit_code`；未知/非本会话 job_id 返回 ERROR。

---

## FR-5：`bash_bg_input` 工具（写 stdin）

**行为**：参数 `job_id`、`text`（必填）。校验归属；若 `job.exit_code is not None` → `ERROR: job already exited`。写入：`job.proc.stdin.write((text + "\n").encode()); await job.proc.stdin.drain()`；返回 `OK: wrote N bytes to stdin of <job_id>`。异常（BrokenPipe 等）→ `ERROR: failed to write stdin: <e>`。

**schema**：`required:["job_id","text"]`。**不**加入并发安全白名单。

**AC-5**：对一个 `read X; echo "got $X"` 脚本，`bash_bg_input(job_id,"hi")` 后 poll 能读到 `got hi`。

---

## FR-6：`bash_bg_stop` 工具

**行为**：参数 `job_id`（必填），可选 `force`（默认 false→`terminate()`，true→`kill()`）。校验归属；若已退出返回 `OK: job already exited (exit_code=...)`；否则 `proc.terminate()`（force 时 `kill()`），`await wait_for(proc.wait(), 5)`，回填 exit_code，从表中保留（标记结束，供最后一次 poll 读尾部）。返回 `OK: stopped <job_id> (exit_code=...)`。

**schema**：`required:["job_id"]`，可选 `force:boolean`。

**AC-6**：stop 一个 running job 后 `status=exited`，进程确实终止（`proc.returncode is not None`）。

---

## FR-7：dispatch 接线

在 `dispatch_tool_async`（`agent_tools.py:6651` 的 `bash_exec` 分支旁）追加：

```python
if name == "bash_bg_start":
    return await _tool_bash_bg_start(arguments, session, confirm_gate=gate, emit_event=event_callback)
if name == "bash_bg_poll":
    return await _tool_bash_bg_poll(arguments, session)
if name == "bash_bg_input":
    return await _tool_bash_bg_input(arguments, session)
if name == "bash_bg_stop":
    return await _tool_bash_bg_stop(arguments, session)
```

**AC-7**：四个工具名经 `dispatch_tool_async` 可路由；`_TOOL_REQUIRED_PARAMS` 自动含 `bash_bg_start:["command"]` 等（由 STUDIO_TOOLS schema 派生，无需手写）。

---

## FR-8：meta_agent prompt 规则

在 `agenticx/runtime/prompts/meta_agent.py` 执行纪律/cc_bridge 规则块（`~854-868`）后追加一段（中文，与既有风格一致）：

```
- **交互式/长驻命令强约束**：当命令会打印二维码/授权链接并等待用户扫码（如 `*-cli config init`、`gh auth login`、`docker login`、`vercel login`、`wrangler login` 等 `* login`），或会阻塞等待键入，或用户明说"需要扫码/交互"时，**必须用 `bash_bg_start` 而非 `bash_exec`**，避免被固定超时误杀。
- `bash_bg_start` 返回的 `auth_urls` 必须**原样转述给用户**并请其完成扫码/授权；在用户确认完成前，最多每 15-30s 调用一次 `bash_bg_poll`，**禁止高频轮询、禁止此时 `bash_bg_stop`**（同 cc_bridge 反刷屏纪律）。
- 需要键入应答（y/n、选项）时用 `bash_bg_input(job_id, text)`。
- 用户确认完成后再 `bash_bg_poll` 读取最终 `exit_code` 与输出，据此汇报结果；`exit_code` 非 0 时报告失败原因，不谎报成功。
```

**AC-8**：prompt 构建函数返回的字符串包含上述关键词（`bash_bg_start`/`auth_urls`/`禁止高频轮询`）；单测断言子串存在。

---

## FR-9：config 节（可选项，缺省即用默认）

`~/.agenticx/config.yaml` 新增（读侧带默认，无需强制存在）：

```yaml
tools_options:
  bash_bg:
    first_wait_sec: 4      # 1-15
    max_jobs: 8            # 1-32
```

**AC-9**：不写该节时用默认；写非法值（如字符串/负数）时 clamp 到合法区间，不崩溃（同 `_bash_exec_default_timeout_sec` 的容错范式）。

---

## 冒烟测试（`tests/test_smoke_bash_bg.py`）

用 `pytest.mark.asyncio`（参照现有 `tests/test_agent_tools.py` / `test_smoke_bash_exec_*` 的 session mock 与调用方式）覆盖：
- `test_bg_short_command_exits`：`bash_bg_start("echo hi")` → 首屏含 `hi`、`exited`、`exit_code=0`。
- `test_bg_long_command_stays_running_and_extracts_url`：脚本 `printf 'https://open.feishu.cn/x\n'; sleep 5` → `running` + auth_urls 含该 URL + 进程未死。
- `test_bg_poll_incremental`：start 一个逐秒打印的脚本，两次 poll 返回不重叠增量。
- `test_bg_input_stdin`：`read X; echo got $X` + `bash_bg_input` → poll 读到 `got ...`。
- `test_bg_stop`：stop running job → exited。
- `test_bg_ownership`：另一 session 的 session_id 查同一 job_id → ERROR。
- `test_bg_reuses_safety_gate`：非白名单命令经 `bash_bg_start` 走确认 gate（mock gate 拒绝 → 返回 CANCELLED，不启动进程）。
- `test_prompt_contains_interactive_rule`：断言 meta_agent 系统提示含新规则关键词。

**运行门槛**：
- `pytest tests/test_smoke_bash_bg.py -q` 全绿。
- `pytest tests/test_smoke_bash_exec_redirect.py tests/test_smoke_bash_exec_output_hint.py tests/test_agent_tools.py -q` 仍全绿（无回归）。
- `agx serve --host 127.0.0.1 --port <临时端口>` 冷启动不崩溃，`/api/session`、`/api/avatars`、`/api/sessions` 返回 200。

---

## In scope / Out of scope（本子规划）

**In scope**：FR-1~FR-9 + 冒烟测试。
**Out of scope**：
- 不改同步 `bash_exec` 返回格式/超时默认/成功语义（仅等价抽取）。
- 不做后台任务跨 `agx serve` 重启的持久化恢复。
- 不做前端渲染（P1）。
- 不 shell out 到系统终端。
- 不动 import 区无关行、不整段替换既有工具分支。

## Traceability
- Plan-Id: `2026-07-08-interactive-bash-background-p0-tools`
- Plan-File: `.cursor/plans/2026-07-08-interactive-bash-background-p0-tools.plan.md`
- 提交须含 `Plan-Model`/`Impl-Model`（用户提供）+ `Made-with: Damon Li`。
