# 本地后端与命令沙箱安全加固（第一波）

Planned-with: Cursor Auto
Suggested-Impl-Model: 强推理档（触碰 `agenticx/studio/server.py` 与沙箱授权逻辑，高回归风险）；阶段 C 的 Electron/前端净化可用代码专精中档

## 1. 背景与证据链

2026-10-17 对仓库做了两路只读安全审计，结论按「提示注入或局域网/恶意网页能否零确认拿到执行权或密钥」排序。下表为已人工复核的严重项：

| 编号 | 问题 | 证据（已复核） |
|---|---|---|
| S1 | 手动 `agx serve` 默认监听全网卡且无 token 时不鉴权 | `agenticx/cli/main.py:596` `host ... "0.0.0.0"`；`agenticx/studio/server.py:1508-1510` `_check_token` 在 `desktop_token` 为空时直接 `return` |
| S2 | 即使有 token，大量路由不校验 | `agenticx/studio/kb/routes.py`、`agenticx/studio/typesafe_routes.py` 中无任何 token 检查；`server.py` 只有 CORS 中间件（约 1286 行），无全局鉴权。`GET /api/typesafe/settings` 返回明文 `api_key`（`agenticx/llms/typesafe_config.py:134`） |
| S3 | 浏览器跨站：CORS 允许 `"null"`、`"file://"`，且无 Host 校验 | `server.py:917-919`；全文无 `TrustedHostMiddleware` |
| S4 | `set_taskspace` 不经确认把任意路径加为**可写**根 | `agenticx/runtime/meta_tools.py:3157-3186` 追加的 taskspace 无 `mount_mode`；`agenticx/cli/agent_tools.py:369` 缺省 `"link"` → `:384` `_add(raw_path, writable=True)` |
| S5 | 工作区内 `.agx-mounts.json` 的 `link` 挂载被当作可信授权 | `agent_tools.py:407-415` `elif mode == "link": _add(source_path, writable=True)`；该文件不在 `_is_protected_path`（`agent_tools.py:5163-5189`）中 |
| S6 | `mcp_import` + `mcp_connect` 无确认，stdio 进程在沙箱外以完整权限运行 | `agent_tools.py:12723-12724`、`12771-12772` 调用时不传 `confirm_gate`；`_tool_mcp_import` 在 `agent_tools.py:8159`；Meta 侧 `meta_tools.py:3211` |
| S7 | 命令里任意位置出现 `git` 即授予 `~/.ssh` 读权限 | `agenticx/runtime/command_sandbox.py:891-892` 正则 `(?:^|&&|\|\||;|\|)\s*git(?:\s|$)`；`:281-292` 据此授权。`git status; cat ~/.ssh/id_ed25519` 会被判定为 git 调用 |
| S8 | 沙箱子进程继承 `AGX_DESKTOP_TOKEN` | `command_sandbox.py:211` `base_env = dict(os.environ ...)`；Desktop 在 `desktop/electron/main.ts:3152` 注入该变量。沙箱内脚本可携带 token 调用 `PUT /api/permissions` 放宽自身权限 |

重要约束（审计未覆盖，实施者必须遵守）：
- 打包版 Desktop 以 `file://` 加载渲染页，浏览器发出的 `Origin` 为 `null`。**不得从 CORS 列表删除 `"null"`**，否则 DMG/exe 全部请求失败。跨站防护改由「全路由强制 token + Host 白名单」承担：恶意页面拿不到 token（token 只经 Electron IPC `get-api-auth-token` 下发）。
- `agenticx/studio/server.py` 是本地后端唯一入口。只能精确增删目标行，不得整段替换 import 区；改完必须冷启动验证（见 AC-S）。

## 2. In scope / Out of scope

In scope：S1–S8 的修复与对应测试。

Out of scope（no-scope-creep，列入第二波另立 plan）：Electron IPC 来源校验、`ShareImagePreviewModal.tsx` 与 `WidgetBlock.tsx` 的 HTML/SVG 净化、`cc_bridge_start` 确认、连接器按文件名授权、`hook_manage` 默认开启、技能包 sha256 校验与 bundle 名路径校验、Windows `USERPROFILE` 整体可读、沙箱网络隔离、`/api/config/providers` 与 typesafe 的 api_key 脱敏返回、macOS exec 黑名单。不改任何与上述无关的现有逻辑。

## 3. 改动明细

### A. 本地后端（S1、S2、S3）

**A1 `agenticx/cli/main.py` `serve()`（约 593-640 行）**
- `host` 默认值 `"0.0.0.0"` → `"127.0.0.1"`。
- 在计算 `effective_token`（约 623 行）之后：若为空，`effective_token = secrets.token_urlsafe(32)` 并写回 `os.environ["AGX_DESKTOP_TOKEN"]`，打印 `token written to ~/.agenticx/serve.token`（不打印 token 本身），替换原先的 "API is unauthenticated" 警告。
- 启动前写入绑定地址供 Host 校验使用。实施时发现 `AGX_SERVE_HOST` 已是对外公布地址（绑定 `0.0.0.0` 时仍写成 `127.0.0.1`，给飞书等进程拨号用），因此绑定地址另记 `AGX_SERVE_BIND`，不改 `AGX_SERVE_HOST`。`AGX_SERVE_BIND` 未设置时（测试与库内嵌）跳过 Host 校验，避免 TestClient 的 `testserver` 把既有测试全部打成 421；`agx serve` 总会设置该变量。
- 写 `serve.token`（约 633 行）后立即 `os.chmod(path, 0o600)`；`serve.port` 同样处理。
- `import secrets` 放文件顶部 import 区。

**A2 `agenticx/studio/server.py` `create_studio_app()`**
- `_check_token`（1508 行）比较改为 `secrets.compare_digest(x_agx_desktop_token or "", desktop_token)`；`desktop_token` 为空时保持现状直接放行（测试与嵌入式用法依赖此行为；生产路径由 A1 保证一定有 token）。
- 在 `app.add_middleware(CORSMiddleware, ...)`（约 1286 行）**之前**注册一个 HTTP 中间件 `_desktop_auth_guard`（`@app.middleware("http")`），逻辑：
  ```python
  _AUTH_EXEMPT_PATHS = {"/api/health", "/api/ready"}
  _LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}

  @app.middleware("http")
  async def _desktop_auth_guard(request, call_next):
      host = (request.headers.get("host") or "").rsplit(":", 1)[0].lower()
      if host and host not in _LOOPBACK_HOSTS and not _bind_is_public():
          return JSONResponse({"detail": "invalid host"}, status_code=421)
      if not desktop_token or request.method == "OPTIONS":
          return await call_next(request)
      if request.url.path in _AUTH_EXEMPT_PATHS:
          return await call_next(request)
      supplied = request.headers.get("x-agx-desktop-token") or ""
      if not secrets.compare_digest(supplied, desktop_token):
          return JSONResponse({"detail": "invalid desktop token"}, status_code=401)
      return await call_next(request)
  ```
  `_bind_is_public()`：读环境变量 `AGX_SERVE_HOST`（由 A1 在启动时写入实际 host），值非回环时返回 True（用户显式对外监听时不做 Host 拦截，但仍强制 token）。
  注意：注册顺序上 CORS 中间件后加、位于外层，OPTIONS 预检由 CORS 先处理；上面对 OPTIONS 的放行是兜底。
- WebSocket 不经过 HTTP 中间件，现有 `/ws/voice/*` 已自行校验 token（`agenticx/studio/voice_endpoints.py:775` 附近），本波不改。
- 全局搜索 Desktop 渲染侧所有对后端的请求都已带 `x-agx-desktop-token`：`rg -n "x-agx-desktop-token" desktop/src desktop/electron`；凡调用 `/api/kb`、`/api/brains`、`/api/typesafe`、`/api/web-search`、`/api/code-index` 的前端函数若未带头，补上（只加 header，不改其他逻辑）。
- 需要的 import（`secrets`、`JSONResponse` 若尚未导入）**只新增一行**，不动相邻行。

**A3 CORS**：`_studio_cors_origins()`（`server.py:914-`）**不改**，理由见第 1 节约束。

### B. 命令沙箱与工具授权（S4–S8）

**B1 S4 `agenticx/runtime/meta_tools.py:3180-3186`**：追加的 taskspace 字典加 `"mount_mode": "reference"`，使模型通过 `set_taskspace` 声明的目录只读。用户需要写入时通过 Desktop 工作区面板添加（该路径会带正确的 `mount_mode`）。同时更新该工具 schema 描述（`meta_tools.py:475` 附近）说明「只读引用，写入需用户在工作区面板添加」。

**B2 S5 `agenticx/cli/agent_tools.py`**
- `_is_protected_path`（5163 行）：在 `protected` 判断之后、`return False` 之前加：`if resolved.name == ".agx-mounts.json": return True`。效果：`file_write`/`file_edit`/`file_read` 无法改写挂载表。
- `command_sandbox.py` 的 denied 路径（`_enumerate_denied_paths`，507 行）增加 `**/.agx-mounts.json` 的写拒绝，防 shell 改写。若该函数只支持读写同拒，则只加到写拒绝侧；读需保留（Desktop 自身不经沙箱读取）。
- `_session_workspace_root_sets` 中的 `_add`（338 行）：`writable=True` 时，若 `candidate` 等于 `Path.home().resolve()`、`/`、`/Users`、`/home`、`/private`、`/Volumes` 之一，降级为 `writable=False`（复用 `command_sandbox._over_broad_read_roots` 的同一集合，可从该模块 import）。

**B3 S6 MCP 确认**
- `agent_tools.py:12723` 改为 `return await _tool_mcp_connect_confirmed(arguments, session, confirm_gate=gate, emit_event=event_callback)`；新函数先从 `~/.agenticx/mcp.json`（与 `_tool_mcp_connect` 同一读取逻辑）取出目标 server 的 `command`/`args`/`url`，调用现有 `_confirm(...)`（`agent_tools.py:4344`），`context={"tool": "mcp_connect", "command": "<command> <args...>", "risk": "high", "risk_categories": [{"code": "host_full_access", "evidence": "mcp stdio runs outside command sandbox"}]}`；拒绝时返回 `_cancelled("未授权启动 MCP 服务", confirm_gate)`；同意后调用原 `_tool_mcp_connect`。
- 若该 server 已在 `mcp.auto_connect` 名单中（用户已信任），跳过确认，保持启动自动补连行为不变。
- `agent_tools.py:12771` 的 `mcp_import` 与 `meta_tools.py:3211` 的 `mcp_import`：同样在执行前 `_confirm`，问题文案列出将导入的 server 名称及其 command。Meta 侧若当前无 `confirm_gate` 可用，则直接返回错误 `"mcp_import requires user confirmation; ask the user to import via Settings"`。
- `host_full_access` 已在 `NEVER_AUTO_APPROVED_CATEGORIES`（`agenticx/runtime/command_safety.py:735-740`），因此「全部自动执行」模式也不会自动放行；这是预期行为。

**B4 S7 `command_sandbox.py:876-893` `_argv_is_git_invocation`**：shell 包装分支改为只接受「整段脚本就是一条 git 命令，可选前置一个 `cd <dir> &&`」：
```python
_GIT_ONLY_SCRIPT = re.compile(r"^\s*(?:cd\s+[^;&|`$()]+?\s*&&\s*)?git(?:\s+[^;&|`$()<>]*)?\s*$")
return bool(_GIT_ONLY_SCRIPT.match(script))
```

**B5 S8 `command_sandbox.py:211`**：`base_env` 构造后删除 `AGX_DESKTOP_TOKEN`、`AGX_CC_BRIDGE_TOKEN` 两个键（`base_env.pop(k, None)`），`DANGER_FULL_ACCESS` 分支同样剔除。不剔除其他 `*_API_KEY`（用户脚本可能依赖，留第二波评估）。

## 4. 验收标准

- AC-A1：`agx serve --port 8765`（不带 token）启动后 `lsof -iTCP:8765 -sTCP:LISTEN` 只显示 `127.0.0.1`；`~/.agenticx/serve.token` 权限为 `-rw-------`；`curl --noproxy '*' -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/api/kb/config` 返回 401；带 `-H "x-agx-desktop-token: $(cat ~/.agenticx/serve.token)"` 返回 200。
- AC-A2：`curl --noproxy '*' -H 'Host: evil.example' http://127.0.0.1:8765/api/health` 返回 421；`/api/health` 不带 token 返回 200。
- AC-A3：新增 `tests/test_studio_auth_guard.py`：用 `fastapi.testclient.TestClient(create_studio_app())`，在 `monkeypatch.setenv("AGX_DESKTOP_TOKEN", "t")` 下断言 `/api/kb/config`、`/api/typesafe/settings` 无头 401、带头非 401；`/api/health` 无头 200；`Host: evil.example` 返回 421。
- AC-B1：新增用例断言调用 `set_taskspace` 后 `_session_workspace_root_sets(session)` 的 write roots 不含该路径、read roots 含该路径。
- AC-B2：新增用例：`_is_protected_path(Path(tmp)/".agx-mounts.json")` 为 True；`.agx-mounts.json` 中 `link` 指向 `Path.home()` 时 write roots 不含 HOME。
- AC-B3：新增用例：`mcp_connect` 在 confirm_gate 拒绝时返回取消、且未调用底层连接（mock `_tool_mcp_connect` 断言未被调用）；server 在 `mcp.auto_connect` 名单时不触发确认。
- AC-B4：`tests/test_command_sandbox.py` 增加：`_argv_is_git_invocation(["/bin/sh","-c","git status; cat ~/.ssh/id_ed25519"])` 为 False；`["/bin/sh","-c","cd repo && git pull"]` 为 True；`["git","pull"]` 为 True。原有用例全部通过。
- AC-B5：新增用例：`build_command_sandbox_plan(..., environ={"AGX_DESKTOP_TOKEN":"x","PATH":"/usr/bin"})` 返回的 `plan.env` 不含 `AGX_DESKTOP_TOKEN`。
- AC-S（server.py 强制门槛）：`agx serve --host 127.0.0.1 --port 8766` 冷启动不崩溃，带 token 访问 `/api/session`、`/api/avatars`、`/api/sessions` 均 200；`npm run dev` 启动 Desktop 后分身列表、历史会话、知识库设置页均正常加载（验证 A2 未遗漏前端 header）。
- AC-R：`pytest -q tests/test_command_sandbox.py tests/test_studio_auth_guard.py` 及现有 studio 相关测试通过。
