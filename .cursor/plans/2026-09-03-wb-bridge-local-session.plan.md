# wb-bridge：把本机 CodeBuddy CLI 会话接入 AgenticX 运行时

Planned-with: claude-opus-5-thinking
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast（纯后端接线 + 子进程/流式协议；本 plan 已把落点、argv、夹具写全，无需实施侧再做架构判断，高性价比档足够）

## 1. 背景与目标

AgenticX（下称 AGX）要与 WorkBuddy（下称 WB）「联通」。经公开文档与本机实测核定，WB 的可编程面分四层，本 plan **只做 L1 正向**：把本机 WorkBuddy 客户端自带的 CodeBuddy CLI 会话，作为一等公民接进 AGX 运行时（起会话、流式输出、发追问、拿结果、停会话）。

目标产物：新包 `agenticx/wb_bridge/` + CLI 子命令 `agx wb-bridge serve` + 5 个 Studio 工具（`wb_bridge_start/send/list/stop/describe`）。

实现范式**完全对照现有 `agenticx/cc_bridge/`**（Claude Code 桥），因为实测证明两者 NDJSON 协议同形。

## 2. 根因与证据链（实施者据此判断改动是否对症，勿依赖对话记忆）

### E-1 本机 CLI 位置与身份

- 可执行文件：`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`，实测 `--version` = `2.137.1`。
- **不在 PATH**：`which codebuddy` 返回 not found，必须解析绝对路径。
- **`wb` 不是 WorkBuddy**：本机 `which wb` = `/opt/miniconda3/bin/wb`，是 Weights & Biases。任何实现禁止用 `wb` 作为可执行名。
- 同目录另有 `cbc-prewarm`；CLI 别名为 `codebuddy|cbc`。

### E-2 headless stream-json 实测跑通，事件与 Claude Code 同形（**本 plan 的核心依据**）

实测命令（cwd=/tmp）：

```bash
printf '%s\n' '{"type":"user","session_id":"","message":{"role":"user","content":"reply with the single word OK"},"parent_tool_use_id":null}' \
  | /Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy \
    --print --input-format stream-json --output-format stream-json
```

实测输出（节选，字段名原样）：

- `{"type":"system","subtype":"init","session_id":"8818e073-...","apiKeySource":"copilot.tencent.com","model":"auto","permissionMode":"default","tools":[...],"mcp_servers":[]}`
- `{"type":"assistant","message":{"content":[{"type":"text","text":"OK"}],"model":"glm-5.3",...}}`
- `{"type":"result","subtype":"success","is_error":false,"result":"OK","duration_ms":9804,"num_turns":2,"permission_denials":[]}`

三条推论，实施时必须依赖：

1. 送入的 stdin 行格式与 `agenticx/cc_bridge/ndjson.py:15 build_user_message_line()` 产出的**完全一致**，CLI 正常接受 → 该函数可直接复用，无需修改。
2. 结束信号是 `type=result` + `subtype=success`，与 `agenticx/cc_bridge/ndjson.py:90 line_looks_like_result_success()` 的判定**完全一致** → 该函数可直接复用。
3. 本机已登录（`apiKeySource: copilot.tencent.com`），实施与自测无需额外配置凭证。

因此 `cc_bridge/ndjson.py` 的四个纯函数**原样 import 使用，禁止修改该文件**。

### E-3 关键差异：不支持 `--permission-prompt-tool`

实测 `codebuddy --permission-prompt-tool stdio --print "hi"` 输出 `error: unknown option '--permission-prompt-tool'`。

而 `agenticx/cc_bridge/session_manager.py:291-301` 的 headless 参数数组里含 `"--permission-prompt-tool", "stdio"`（L299-300），这是 Claude Code 独有的。

**后果**：headless codebuddy 不会吐 `control_request` / `can_use_tool` 行，所以：

- `cc_bridge` 的 `_on_control_request`（`session_manager.py:221`）、`respond_permission`（L447）、`build_control_response_allow/deny` 这条**逐工具交互确认链路在 wb_bridge P0 不成立**。
- 替代方案：codebuddy 提供 `--permission-mode <mode>`，实测 choices 为 `acceptEdits | bypassPermissions | default | plan | dontAsk | auto`，是**会话级**预设，非逐次询问。
- 因此 P0 只提供会话级 `permission_mode` 参数；逐工具确认留待 P1（见 §7）。

### E-4 ACP 存在但未验证通过，P0 不采用

CLI 有 `--acp`（`--acp-transport stdio|streamable-http`）与 `--serve`（HTTP REST + ACP over SSE，`--auth password|none`，`--port`）。

实测 `codebuddy --acp --acp-transport stdio` 送入一条 `initialize` JSON-RPC 后**96 秒无任何输出**，被判为挂起并 kill。原因未查明（可能需要先建连握手序列或非管道 stdio）。

**结论**：ACP 是后续统一本机 + WB 云端任务（云端 ACP 见 WB Open API 文档）的正确方向，但 P0 不赌它。P0 走已实证的 headless NDJSON。

### E-5 现成参照物的精确落点（照此新建对应文件）

| 参照文件 | 关键符号与行号 | wb_bridge 对应做法 |
|---|---|---|
| `agenticx/cc_bridge/ndjson.py` | `build_user_message_line` L15；`parse_control_request` L26；`build_control_response_allow` L47；`build_control_response_deny` L70；`line_looks_like_result_success` L90 | **直接 import，不新建、不修改** |
| `agenticx/cc_bridge/session_manager.py` | `BridgeSession` L36；`_reader_thread` L79；`_stderr_thread` L101；`BridgeSessionManager` L181；`_session_to_dict` L203；`_write_stdin` L238；`_start_session_headless` L278（args 数组 L291-301，exe 取自 `CC_BRIDGE_EXECUTABLE` L284）；`_log_path_for_sid` L270；`_wait_proc` L418；`send_user_message` L430；`stop_session` L469；`wait_for_success_result` L540 | 新建 `wb_bridge/session_manager.py`，结构对照，删掉 PTY/visible_tui 与 permission 分支 |
| `agenticx/cc_bridge/http_app.py` | `verify_token` L27；`app = FastAPI(...)` L39；`_parse_session_id` L42；`SessionCreateBody` L49；`create_session` L111 | 新建 `wb_bridge/http_app.py`，去掉 PTY 相关路由与 body |
| `agenticx/cc_bridge/settings.py` | `_DEFAULT_URL = "http://127.0.0.1:9742"` L16；`cc_bridge_base_url` L53；`ensure_cc_bridge_token_persisted` L63；`cc_bridge_token` L83；`validate_bridge_url_for_studio` L97 | 新建 `wb_bridge/settings.py`，默认端口改 **9743**（避让 9742） |
| `agenticx/cli/cc_bridge_commands.py` | `@cc_bridge_app.command("serve")` L20 | 新建 `agenticx/cli/wb_bridge_commands.py` |
| `agenticx/cli/main.py` | `_get_cc_bridge_app()` L119-123；`app.add_typer(cc_bridge_app)` L447-448 | 在 L448 之后**新增**懒加载注册，不改动既有两行 |
| `agenticx/cli/agent_tools.py` | 工具 schema `cc_bridge_start` L1053、`cc_bridge_send` L1088、`cc_bridge_list` L1113、`cc_bridge_stop` L1126、`cc_bridge_permission` L1145；handler `_tool_cc_bridge_start` L5705 / `_send` L5840 / `_list` L5931 / `_stop` L5936；dispatch 分支 L8894-8903 | 在这些块**之后追加** wb 版本；禁止改写 cc 版本 |

`~/.codebuddy/` 布局实测：当前有 `bin/ diagnostics/ local_storage/ logs/ skills/`，**没有** `plugins/` 与 `teams/`（`plugin list` 返回 “No plugins installed”，`mcp list` 返回 “No MCP servers configured”）。故本 plan 不依赖这两个目录存在。

## 3. In scope / Out of scope（no-scope-creep 边界）

### In scope

- 新建 `agenticx/wb_bridge/`（`__init__.py`、`settings.py`、`session_manager.py`、`http_app.py`）。
- 新建 `agenticx/cli/wb_bridge_commands.py`，提供 `agx wb-bridge serve`。
- 在 `agenticx/cli/main.py` 追加 wb-bridge typer 懒加载注册（仅新增行）。
- 在 `agenticx/cli/agent_tools.py` 追加 5 个工具 schema、5 个 handler、5 个 dispatch 分支（仅新增）。
- 新建冒烟测试 `tests/test_smoke_wb_bridge.py`。

### Out of scope（明确不做，做了算违规）

- **不修改** `agenticx/cc_bridge/` 下任何文件（含 `ndjson.py`）。它是 Claude Code 在跑的生产链路。
- 不做 ACP / `--serve` 接入（P1）。
- 不做逐工具权限确认与 `wb_bridge_permission`（P1，E-3 阻塞）。
- 不做 visible_tui / PTY（codebuddy TUI 交互留待评估）。
- 不做 Desktop 前端 UI（P1 单独 plan）。
- 不做 WB 开放平台上架、exporter、私有 marketplace（L3/L4，另开 plan）。
- 不动 `agenticx/studio/server.py`。该文件 import 区极敏感（见 AGENTS.md），本 plan 无需触碰。

## 4. 功能需求（FR）

### FR-1 可执行文件解析

`agenticx/wb_bridge/settings.py` 新增 `resolve_codebuddy_executable() -> str`，优先级：

1. 环境变量 `AGX_WB_BRIDGE_EXECUTABLE`（非空即用）。
2. `~/.agenticx/config.yaml` 的 `wb_bridge.executable`（经 `ConfigManager.get_value("wb_bridge.executable")`，参照 `cc_bridge/settings.py:57`）。
3. 固定候选路径，按序取第一个 `os.access(p, os.X_OK)`：
   - `/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`
   - `~/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`（展开 `~`）
4. `shutil.which("codebuddy")`、`shutil.which("cbc")`。

全部落空时 `raise RuntimeError`，消息须含「未找到 codebuddy 可执行文件，请安装 WorkBuddy 客户端或设置 AGX_WB_BRIDGE_EXECUTABLE」。

**禁止**回退到 `wb`（E-1）。

### FR-2 端口与 token 隔离

`settings.py` 中 `_DEFAULT_URL = "http://127.0.0.1:9743"`；配置键前缀统一 `wb_bridge.*`；环境变量 `AGX_WB_BRIDGE_URL` / `AGX_WB_BRIDGE_TOKEN` / `AGX_WB_BRIDGE_ALLOW_NONLOCAL`；HTTP 服务端读 `WB_BRIDGE_TOKEN`。`validate_bridge_url_for_studio()` 的 loopback 校验逻辑照抄 `cc_bridge/settings.py:97-111`（含 `127.0.0.1/localhost/::1` 白名单与非 loopback 需显式放开）。

### FR-3 headless 会话

`wb_bridge/session_manager.py` 的 `WbBridgeSessionManager._start_session_headless(cwd, *, permission_mode)`：

子进程 args（对照 `cc_bridge/session_manager.py:291-301`，**去掉** `--permission-prompt-tool`，**加上** `--permission-mode`）：

```python
args = [
    exe,
    "--print",
    "--verbose",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--permission-mode", permission_mode,
]
```

`permission_mode` 白名单 `{"default","acceptEdits","bypassPermissions","dontAsk","plan","auto"}`（E-3 实测），非法值回落 `"default"`。

`Popen` 参数照抄 L306-315（`text=True, bufsize=1`，stdin/stdout/stderr 全 PIPE）。env 里设 `env.setdefault("CODEBUDDY_ENVIRONMENT_KIND", "agx_wb_bridge")`（对照 L304 的同类做法；键名不同是因为宿主不同，不确定时此 env 无副作用）。

启两个线程：reader（`_reader_thread` 等价物，但**不解析 control_request**，只 append）与 stderr（照抄 L101-113）。日志目录 `WB_BRIDGE_LOG_DIR`，默认 `~/.agenticx/logs/wb-bridge`（对照 L271）。

`BridgeSession` 等价 dataclass 只保留：`session_id/cwd/proc/lines/lock/done/exit_code/log_path/log_lock`，**删除**所有 `pty_*` 与 `_tui_*` 字段及 `auto_allow`。行数上限 2000 与 `recent_text(max_lines=80)` 照抄 L57-66。

### FR-4 发送与等待

`send_user_message(session_id, text)`：用 `from agenticx.cc_bridge.ndjson import build_user_message_line` 生成行，写 stdin。

`wait_for_success_result(session_id, timeout_sec, poll_interval=0.2)`：照抄 `cc_bridge/session_manager.py:540-568`，判定函数用 `from agenticx.cc_bridge.ndjson import line_looks_like_result_success`。

补充：实测单轮耗时约 9.8s（E-2），故工具层默认 `wait_seconds` 取 **180**（比 cc 的 120 宽松，因 codebuddy 冷启动 + 模型路由更慢）。

### FR-5 HTTP 控制面

`wb_bridge/http_app.py`，`app = FastAPI(title="AgenticX WB Bridge", version="0.1.0")`，路由：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/sessions` | body `{cwd, permission_mode?}` → `{session_id, cwd, pid}` |
| GET | `/v1/sessions` | 列表 |
| GET | `/v1/sessions/{sid}` | 单会话（`_session_to_dict` 等价，字段 `session_id/cwd/pid/poll/log_path/state`） |
| POST | `/v1/sessions/{sid}/message` | body `{text, wait_seconds}` → `{ok, tail, result_text}` |
| DELETE | `/v1/sessions/{sid}` | 停会话 |

鉴权照抄 `verify_token`（`http_app.py:27-36`），仅把 `CC_BRIDGE_TOKEN` 换为 `WB_BRIDGE_TOKEN`，保留 `secrets.compare_digest` 与「未设 token → 503」语义。`session_id` 用 `uuid.UUID` 校验（对照 L42-46）。

**不实现** `/permission`、`/pty/*`、`/resize` 路由。

### FR-6 CLI 子命令

`agenticx/cli/wb_bridge_commands.py`：`wb_bridge_app = typer.Typer(name="wb-bridge", ...)`，`@wb_bridge_app.command("serve")`，参数 `--host`（默认 `127.0.0.1`）、`--port`（默认 `9743`）、`--token`。token 解析顺序照抄 `cc_bridge_commands.py:26-49`（`--token` > `WB_BRIDGE_TOKEN` > `AGX_WB_BRIDGE_TOKEN` > config > 自动生成并持久化），启动前 print 一行提示 token 来源但**不打印 token 明文**。

`agenticx/cli/main.py`：在 L448 `app.add_typer(cc_bridge_app)` **之后**新增

```python
    wb_bridge_app = _get_wb_bridge_app()
    app.add_typer(wb_bridge_app)
```

并在 L123 之后新增 `_get_wb_bridge_app()`，结构照抄 `_get_cc_bridge_app()`（L119-123，含 try/except ImportError 返回 None 的同款容错）。**只新增，不改既有行。**

### FR-7 Studio 工具

在 `agenticx/cli/agent_tools.py` 追加 5 个工具，schema 追加位置在 `cc_bridge_permission` 块（L1145 起）**之后**：

| 工具 | 参数 | 语义 |
|---|---|---|
| `wb_bridge_start` | `cwd?`、`permission_mode?` | 起会话；`cwd` 缺省用 session workspace_dir（照抄 `_tool_cc_bridge_start` L5705 取 cwd 的逻辑） |
| `wb_bridge_send` | `session_id`、`text`、`wait_seconds?`（默认 180） | 发一轮并等 result |
| `wb_bridge_list` | 无 | 列会话 |
| `wb_bridge_describe` | `session_id` | 单会话状态 |
| `wb_bridge_stop` | `session_id` | 停会话 |

工具描述文案必须写明：需先在另一终端跑 `agx wb-bridge serve`；token 来自 `AGX_WB_BRIDGE_TOKEN` 或 `~/.agenticx/config.yaml` 的 `wb_bridge.token`；默认地址 `127.0.0.1:9743`。（对照 L1055-1058 的写法。）

handler 追加在 `_tool_cc_bridge_permission`（L5983 起）之后；dispatch 分支追加在 L8903 之后，形如：

```python
        if name == "wb_bridge_start":
            return await _tool_wb_bridge_start(arguments, session)
```

若 `agenticx/cli/agent_tools.py:192` 附近存在只读工具名单（含 `"cc_bridge_list"`），把 `"wb_bridge_list"` 与 `"wb_bridge_describe"` 一并加入该名单。

## 5. 验收标准（AC）

新建 `tests/test_smoke_wb_bridge.py`，全部用 mock/monkeypatch，**不真实拉起 codebuddy 子进程**（CI 无 WorkBuddy 客户端）。

- **AC-1（FR-1）**：`monkeypatch.setenv("AGX_WB_BRIDGE_EXECUTABLE", "/tmp/fake-cb")` 后 `resolve_codebuddy_executable()` 返回 `/tmp/fake-cb`；清空 env 与 config、并 monkeypatch `os.access` 全 False + `shutil.which` 返回 None 时抛 `RuntimeError`，消息含 `AGX_WB_BRIDGE_EXECUTABLE`。
- **AC-2（FR-1 反例）**：断言 `resolve_codebuddy_executable` 的候选列表与实现源码中**不含**独立单词 `"wb"` 作为可执行名（防止误用 Weights & Biases）。
- **AC-3（FR-3）**：monkeypatch `subprocess.Popen` 捕获 argv，断言 argv 含 `--input-format stream-json`、`--output-format stream-json`、`--permission-mode default`，且**不含** `--permission-prompt-tool`。
- **AC-4（FR-3）**：传 `permission_mode="nonsense"` 时 argv 中为 `default`；传 `"acceptEdits"` 时原样透传。
- **AC-5（FR-4）**：喂入 E-2 实测的三行真实 JSON（`system/init`、`assistant`、`result/success`），`wait_for_success_result` 返回 `(True, ...)`；只喂前两行则超时返回 `(False, ...)`。该用例须把 E-2 的 `result` 行原文作为夹具字符串。
- **AC-6（FR-2）**：`wb_bridge` 默认 URL 为 `http://127.0.0.1:9743`，且与 `agenticx.cc_bridge.settings._DEFAULT_URL`（9742）不相等。
- **AC-7（FR-5）**：用 `fastapi.testclient.TestClient`；未设 `WB_BRIDGE_TOKEN` → `POST /v1/sessions` 返回 503；设了 token 但无 Authorization → 401；错 token → 403；正确 token + mock manager → 200 且响应含 `session_id`。
- **AC-8（Out of scope 守卫）**：`git diff --name-only` 不含 `agenticx/cc_bridge/` 下任何路径。实施完成后人工执行确认。
- **AC-9（CLI 注册）**：`agx --help` 输出含 `wb-bridge`；`agx wb-bridge serve --help` 正常退出（0）。
- **AC-10（人工端到端，本机 macOS 且装了 WorkBuddy 时执行）**：终端 A 跑 `agx wb-bridge serve`；终端 B 用 curl 建会话并发 `reply with the single word OK`，返回 `ok=true` 且 `result_text` 含 `OK`。此项为本机验收，不进 CI。

## 6. 实施顺序

1. `agenticx/wb_bridge/settings.py`（FR-1、FR-2）→ 跑 AC-1/2/6。
2. `agenticx/wb_bridge/session_manager.py`（FR-3、FR-4）→ 跑 AC-3/4/5。
3. `agenticx/wb_bridge/http_app.py`（FR-5）→ 跑 AC-7。
4. `agenticx/cli/wb_bridge_commands.py` + `main.py` 注册（FR-6）→ 跑 AC-9。
5. `agenticx/cli/agent_tools.py` 追加工具（FR-7）。
6. 人工 AC-10 + 检查 AC-8。

## 7. 后续（不在本 plan 内，各自另开 plan）

- **P1-a 逐工具权限确认**：先查明 E-4 的 ACP 挂起原因；ACP 的 Server-to-Client Request（带 id）才能承载逐次授权与 `AskUserQuestion`。同一 ACP 客户端还可复用到 WB 云端任务（云端同为 SSE + JSON-RPC），是「一套客户端吃本机 + 云端」的关键。
- **P1-b Desktop UI**：wb-bridge 会话在 Machi 里的窗格、流式呈现、mode 提示，参照 `desktop/src/utils/cc-bridge-ui.ts` 既有范式。
- **P2 反向**：`codebuddy mcp add-json` 把 AGX 注册为 CodeBuddy 的 MCP server（实测 `mcp add-json <name> <json>` 存在），让 CodeBuddy 直接用 AGX 的分身/群聊/知识库。投入极小、价值高。
- **P3 私有 marketplace**：实测 `codebuddy plugin marketplace add <source>` 存在，AGX 可自建源做企业分发，绕开公开市场审核。
- **P4 exporter**：Avatar→专家、Group→专家团、Skill→`SKILL.md`、MCP→连接器包，出 ZIP 交人工上架。导出前须先修两个已知契约断点：Bundle 装 Avatar preset 不建实例；Group 创建 API 收 `team`、更新 API 拒 `team`。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 误改 `cc_bridge` 导致 Claude Code 链路回归 | AC-8 硬性守卫；`ndjson.py` 只 import |
| 端口撞 9742 | 默认 9743 + AC-6 |
| 误把 `wb` 当 WorkBuddy CLI | FR-1 禁止 + AC-2 |
| CLI 升级后 flag 变化 | 启动失败时错误信息带 argv，便于定位；`--permission-mode` 非法值不硬失败 |
| CI 无 WorkBuddy 客户端 | 全部单测 mock；真实链路走人工 AC-10 |

## 9. 提交约定

commit 只描述本产品能力变化（如 `feat(wb-bridge): add local CodeBuddy session bridge`），不写任何对标/对齐第三方产品的措辞。Trailer 顺序：

```
Plan-Id: 2026-09-03-wb-bridge-local-session
Plan-File: .cursor/plans/2026-09-03-wb-bridge-local-session.plan.md
Plan-Model: claude-opus-5-thinking
Impl-Model: cursor-grok-4.6-xhigh-fast
Made-with: Damon Li
```

实施前把本文件从 `.cursor/plans/pending/` 移回 `.cursor/plans/` 根目录。
