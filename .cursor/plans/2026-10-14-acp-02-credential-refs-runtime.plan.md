# acp-02 框架凭证引用与脱敏

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

密钥只存一处（本机凭证库），模型供应商和 MCP 配置里写引用 `${cred:NAME}`。运行时在进程边界替换成真值；工具结果、会话落盘里出现的已知密钥值被替换成 `[REDACTED:NAME]`。

## 根因与证据

- Provider key 明文：`~/.agenticx/config.yaml` 的 `providers.<name>.api_key`，读取入口 `AgxConfig.get_provider()`（`agenticx/cli/config_manager.py` 约 216 行）原样返回。
- MCP 明文：`~/.agenticx/mcp.json` 的 `mcpServers.*.env` / `headers`。stdio 连接在 `agenticx/tools/remote_v2.py` 约 293–301 行 `env = dict(os.environ); env.update(self.server_config.env)`；streamable-http / SSE 在约 315、332 行 `headers=dict(self.server_config.headers) or None`。
- 没有任何凭证引用或统一脱敏；`messages.json` 由 `SessionManager._persist_session_state`（`agenticx/studio/session_manager.py` 约 2555 行）原样写盘。

## 设计

### 凭证库文件

`~/.agenticx/credentials.yaml`，目录权限不变，文件权限 `0600`（Windows 跳过 chmod）：

```yaml
version: 1
credentials:
  GITHUB_TOKEN:
    value: "ghp_xxx"
    description: "GitHub MCP"
    updated_at: "2026-10-14T03:00:00Z"
```

名称正则 `^[A-Z][A-Z0-9_]{1,63}$`。路径解析跟随 `ConfigManager` 的 home 解析方式（读该文件里 `GLOBAL_CONFIG_PATH` 的元类实现，保证测试里改 HOME 生效）。

### 新模块 `agenticx/runtime/credential_store.py`

```python
CRED_REF_RE = re.compile(r"\$\{cred:([A-Z][A-Z0-9_]{1,63})\}")
REDACT_MIN_LEN = 8

class CredentialError(ValueError): ...
class MissingCredentialError(CredentialError):
    def __init__(self, name: str): ...  # self.name = name

@dataclass(frozen=True)
class CredentialMeta:
    name: str
    description: str
    updated_at: str

class CredentialStore:
    def __init__(self, path: Path | None = None): ...
    def list(self) -> list[CredentialMeta]: ...          # 不含 value
    def get(self, name: str) -> str | None: ...
    def set(self, name: str, value: str | None, description: str | None = None) -> CredentialMeta: ...
        # 新建时 value 必填；更新时 value=None 表示只改描述
    def delete(self, name: str) -> bool: ...
    def known_secrets(self) -> list[tuple[str, str]]: ... # (name, value)，只含 len(value) >= REDACT_MIN_LEN

def default_store() -> CredentialStore: ...             # 每次调用都重新读文件，不做进程级缓存
def resolve_refs(value: str, store: CredentialStore | None = None) -> str: ...
    # 无引用原样返回；引用不存在抛 MissingCredentialError
def resolve_mapping(mapping: Mapping[str, str], store: CredentialStore | None = None) -> dict[str, str]: ...
def redact_text(text: str, store: CredentialStore | None = None) -> str: ...
    # 按 value 长度降序替换为 [REDACTED:NAME]；凭证库为空或文件不存在时零开销返回
def find_references(text: str) -> list[str]: ...
```

写文件用临时文件 + `os.replace` 原子替换。

### 注入点

1. `agenticx/tools/remote_v2.py`：把 stdio 环境构造提成模块函数 `build_stdio_env(server_config) -> dict[str, str]`（`dict(os.environ)` 后 `update(resolve_mapping(server_config.env))`），原位置改为调用它；两处 headers 改为 `resolve_mapping(dict(self.server_config.headers)) or None`。`MissingCredentialError` 时抛 `RuntimeError(f"MCP 服务「{name}」引用了未定义的凭证 {err.name}，请在设置 → 凭证中添加")`，`name` 取该文件里已有的服务名字段。
2. `AgxConfig.get_provider()`：`api_key` 与 `secret_key` 经 `resolve_refs`；引用缺失时抛 `MissingCredentialError`，让上层现有的 provider 错误展示链路带出可读信息。
3. 在 `agenticx/studio`、`agenticx/llms`、`agenticx/runtime` 中 `rg -n "\[\"api_key\"\]|get\(\"api_key\"\)"`，凡是绕过 `get_provider()` 直接从 `providers` 字典取 key 去发请求的运行时路径，改为经过 `resolve_refs`。只改「拿 key 发请求」的位置；写配置、展示打码的位置不动。在交付说明里逐条列出改了哪些。

### 脱敏点

1. `dispatch_tool_async`（`agenticx/cli/agent_tools.py` 约 12412 行）：在函数最终返回字符串结果处统一过 `redact_text`。只加一处出口包装，不改各工具实现。
2. `SessionManager._persist_session_state`：写盘前对每条消息字符串型 `content` 过 `redact_text`（不改内存里的对象，只改写盘副本）。

### Studio 接口

新建 `agenticx/studio/credentials_routes.py`，导出 `register_credentials_routes(app, check_token)`，在 `agenticx/studio/server.py` 中紧挨 `register_command_routes(app, _check_token)`（约 1507 行）加一行调用，并在顶部 import 区按字母序**只新增一行** import。不得改动相邻任何行。

- `GET /api/credentials` → `{"ok": true, "credentials": [{"name", "description", "updated_at", "referenced_by": [...]}]}`。`referenced_by` 扫描 `mcp.json` 各服务的 env/headers 与 `config.yaml` 各 provider 的 `api_key`/`secret_key`，形如 `"mcp:github"`、`"provider:openai"`。
- `PUT /api/credentials/{name}`，body `{"value"?: str, "description"?: str}`；名称非法 400；新建缺 value 400。
- `DELETE /api/credentials/{name}`；被引用时仍允许删除，但响应带 `"referenced_by"` 供前端提示。
- 任何响应都不返回 value。

## AC

1. `tests/test_credential_store.py`：CRUD；文件权限 0600（非 Windows）；`resolve_refs` 正常、缺失抛错、无引用原样；`resolve_mapping`；`redact_text` 长值优先、短于 8 不脱敏、空库原样。
2. `tests/test_credential_refs_injection.py`：`build_stdio_env` 替换引用；缺失时报含凭证名的错误；`get_provider()` 解析 `${cred:OPENAI_KEY}`。
3. `tests/test_credentials_routes.py`：用 FastAPI `TestClient` 挂 `register_credentials_routes` 到空 app，验证三个接口与「不回显 value」。
4. `pytest tests/test_credential_store.py tests/test_credential_refs_injection.py tests/test_credentials_routes.py -q --no-cov` 通过，且既有 `tests/` 里与 `remote_v2`、`config_manager` 相关的测试不回归（`pytest -q --no-cov -k "remote_v2 or config_manager or mcp"`）。
5. 冷启动：`agx serve --host 127.0.0.1 --port 18731`，`curl --noproxy '*'` 访问 `/api/session`、`/api/avatars`、`/api/sessions`、`/api/credentials` 均 200。

## Out of scope

Desktop 页面（acp-08）；把现有明文自动迁成引用；系统钥匙串；企业下发凭证。
