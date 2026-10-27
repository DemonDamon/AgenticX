# MA-A06 凭证代理：会话级 MCP 连接 · 占位符注入 · 出站白名单 · 全链路脱敏

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W4 · MA-A06）
Depends-on:
- MA-A01..A05（已实现：`agenticx/managed/{spec,builder,actions,permissions}.py`、`agenticx/managed/events/*`、`agenticx/managed/host/*`）——实际行为以 `.cursor/plans/notes/ma-w1-actual-contracts.md` 为准（**必读**）
- MA-E06 `.cursor/plans/pending/2026-10-25-ma-e06-vault-control-plane.plan.md`（**尚未实现**：`POST /api/internal/ma/vaults/validate`、`POST /api/internal/ma/vault-resolve`、`mcp_server_url` 归一化规则。以实际实现为准，实施前核对）
- MA-E03 `.cursor/plans/2026-10-25-ma-e03-agent-runtime-service.plan.md`（**尚未实现**：`enterprise/apps/agent-runtime/ma_agent_runtime/{config,app}.py` 的 `Settings` 与 `build_app`。以实际实现为准，实施前核对）

> 风险等级：高（凭证明文在进程内存流转；改动个人模式共用的 `agent_tools.py` / `command_sandbox.py` / `session_boundary.py`）。合入前建议强推理档只读审查。
>
> 栈：两个 Python 包——框架 `agenticx/`（主体）与 `enterprise/apps/agent-runtime`（只做接线）。
>
> **实施前核对命令**（签名与本文不一致时按实际调整调用代码，不得为迁就本文去改动与本需求无关的已有逻辑）：
> `rg -n "def build\(|def _ensure_bundle|async def _run|def announce_tool_use|def build_tool_use|def create_session|class ManagedPermissionHook|def evaluate_mcp" agenticx/managed`
> `rg -n "def build_app|class Settings|def from_env" enterprise/apps/agent-runtime/ma_agent_runtime`

---

## 0. 一句话目标

让托管会话（cloud 环境）真正用上 Vault：会话创建时校验 `vault_ids`；每个回合开始时经 `CredentialProvider` 解析凭证（本地开发用 `LocalCredentialProvider` 包 `credential_store`，企业用 `EnterpriseVaultProvider` 调 E06 内部接口），为该会话**单独**建立 MCP 连接并按 `mcp_server_url` 注入令牌；`environment_variable` 凭证在 bash 沙箱里只给 `agxsec_<random>` 占位值，真实值只在**框架自己发出的**出站请求（`web_fetch` 的 URL、MCP 工具参数）命中 `allowed_hosts` 时替换；环境 `egress_allow_domains` 对 `web_fetch`（含重定向）、MCP 连接强制生效，对 bash 在白名单非空时直接断网；所有事件、预览帧、日志统一脱敏。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 与威胁模型的约束

| 来源 | 约束 | 落点 |
|---|---|---|
| master §1.2 | Vault「运行时在出站边界注入；Agent 与沙箱拿不到明文」 | §5.6 占位符；§5.7 MCP 头注入 |
| master §4 决策 8 | MCP 凭证只经 Vault 按 URL 匹配注入，Manifest 无 `headers`/`env` | §5.7 匹配规则 |
| master §7 W4 门 | MCP 调用成功；沙箱 `env` 只见占位值；事件历史与日志全文检索不到密钥；向非 allowlist 主机发请求失败并留下 `session.error` | AC FR-16（门测试） |
| master §9 MA-A06 | `CredentialProvider` 抽象（本地 + 企业）；MCP 按 URL 匹配；`environment_variable` 占位 + 命中 `allowed_hosts` 才替换；事件与日志 `redact_text` | 全文 |
| `docs/managed-agents/threat-model.md` §1（L7-14） | 沙箱 `env` 只有占位值；事件历史与日志检索不到原文 | FR-10 / FR-16 |
| 同上 §4（L35-44） | 原文把「沙箱出站只放行名单内域名」交给 E03；E03 D3 ⑤ 明确改由 A06 负责 | §5.8 |
| E03 §2 D3 | 云端执行 = 每会话工作目录 + OS 命令沙箱（bubblewrap / sandbox-exec），无网络隔离 | bash 断网借用同一命令沙箱（§5.9） |

### 1.2 调研语义

| 来源 | 语义 | 采纳情况 |
|---|---|---|
| `zhipu/mcp.md` L17-19、L124-130 | 无匹配凭证 → 未认证连接；建会话不预检；连接失败会话照常运行，发带 `mcp_server_name` 的 `session.error`（`retry_status`） | 全部采纳（字段名用我们协议的 `error.mcp_server`，`protocol.py` L210-214 已有） |
| `zhipu/vaults.md` L115、`volcengine/use-vaults-authentication.md` L272-274 | `vault_ids` ≤20、不重复、顺序即优先级；多个 Vault 都匹配时第一个优先 | 采纳 |
| `volcengine/use-vaults-authentication.md` L304 | 会话运行期间每次使用时重新解析当前值，轮换无需重启会话 | 采纳为「每回合解析一次」（§2 D3） |
| `bailian/managed-agents-credential-security.md` L31-53 | 占位符注入；网关**按 host** 替换**请求头**里的占位符；非白名单 host 照常放行但不替换；透明 MITM（TLS 终结 + 预置 CA） | 占位符采纳；**透明 MITM 不做**（§2 D5） |
| `volcengine/use-vaults-authentication.md` L236-242 | 占位符只适合原样写入请求头的客户端；签名类客户端会失效 | 写入已知限制 |

### 1.3 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `agenticx/runtime/credential_store.py` | 26-28、146-155、230-265、268-292 | `${cred:NAME}`（`CRED_REF_RE`）、`REDACT_MIN_LEN=8`、`known_secrets()`、`resolve_refs` / `resolve_mapping`、`redact_text`（长值优先，替换为 `[REDACTED:NAME]`） | `LocalCredentialProvider` 用 `resolve_refs`；`SecretRedactor` 照 `redact_text` 的算法（长值优先、最短 8 字符） |
| `agenticx/cli/agent_tools.py` | 12779-12803 | `dispatch_tool_async` 对工具结果调用 `redact_text(result)`——只认 `~/.agenticx/credentials.yaml` 里的值 | Vault 值不在其中 → 必须另做会话级脱敏（§5.4） |
| `agenticx/tools/remote_v2.py` | 93-163 | `MCPServerConfig`：`url` / `headers` / `transport`（`streamable_http` / `sse`）/ `timeout` | 会话级 MCP 用它构造配置，`headers` 只在内存 |
| 同上 | 166-176、341-352、365-372 | `headers` 经 `_resolve_mcp_mapping` → `resolve_mapping`：不含 `${cred:` 的值原样透传 | 直接放 `Authorization: Bearer <token>`；E06 已禁止 secret 含 `${cred:` |
| 同上 | 332-334、357-359 | 连接前用 `egress_denial(url, configured_egress_allowlist())`——读**全局**配置 `runtime.egress_allow_domains` | 不能表达「每会话 / 每环境」白名单 → 会话池在构造客户端前自己检查（§5.7） |
| 同上 | 405-420 | 连接失败日志只记 host，不记 headers | 可接受；仍加全局日志脱敏兜底 |
| `agenticx/cli/studio.py` | 54-60、101-145 | `StudioSession.mcp_hub` / `mcp_configs` / `connected_servers` 是只读属性，**指向进程单例 `GlobalMcpManager`**，赋值被忽略 | 托管会话**不能**复用 `mcp_hub`：一来所有会话共享同一 hub（令牌串会话），二来属性不可替换 → 用独立的 `SessionMcpPool` + fallback resolver（§2 D2） |
| `agenticx/runtime/global_mcp_manager.py` | 63-115 | 进程级单例，懒创建 | 托管路径不得触发它（不变量 3） |
| `agenticx/cli/agent_tools.py` | 1618-1643、8361-8400 | `mcp_call` 工具走 `session.mcp_hub` | 不在托管白名单（`spec.py` L20-24 的 14 个工具），托管会话不会用到 |
| 同上 | 13297-13309 | 未知工具名落到 `session._fallback_chain.execute(name, **arguments)` | MCP 工具以独立函数名暴露，由 resolver 执行 |
| `agenticx/tools/fallback_chain.py` | 23-27、62-64、91-122 | `FallbackLevel` 只有 3 级；`register(level, resolver)` 每级只存一个；`can_handle` 为假则落下一级；resolver 抛异常被吞 | 用组合 resolver 放在 `API_CONNECTOR` 一级（§5.3），resolver 永不抛异常 |
| `agenticx/managed/builder.py` | 102-158 | `build(spec, *, context, confirm_gate, hooks, custom_tool_resolver, history)`；自定义 resolver 注册在 `API_CONNECTOR`；`hooks` 按 `MANAGED_HOOK_PRIORITY` 注册；返回的 `ManagedRuntimeBundle.tools` / `system_prompt` 是可变字段，`run_turn` 每次调用时读取 | **builder 不改**：传入组合 resolver 与动态 hook，每回合改写 `bundle.tools` |
| `agenticx/managed/spec.py` | 43-62、90-95、213-239 | `McpServerSpec(name,url,transport)`、`McpToolsetSpec.policy_for(tool)`（禁用返回 None）；`kind_of` 注明「W1 never returns mcp」 | MCP 工具暴露与策略按 toolset |
| `agenticx/managed/permissions.py` | 128-170 | `PermissionEngine.evaluate_mcp(server, tool, args)` 已实现、未接线 | `ManagedPermissionHook` 识别 MCP 函数名后改走它 |
| `agenticx/managed/events/adapter.py` | 54-64、169-229、336-361 | Ledger 按**名字**绑定 hook 宣告与 runtime `tool_call`；`build_tool_use` 用同一个 `name` 既写事件又写 ledger | MCP 事件名应为原始工具名（`get_issue`）而 runtime 的函数名是 `mcp__github__get_issue` → 新增 `ledger_name` 参数（§5.10） |
| `agenticx/managed/host/actor.py` | 158-159、246-264、324-365、367-412、434-449 | `append`、`announce_tool_use`、`_ensure_bundle`（每 actor 建一次 bundle）、`_run`（回合主循环）、`close` | 扩展点插在这几处（§5.2） |
| `agenticx/managed/host/service.py` | 107-112、136-153 | `create_session` 对非空 `vault_ids` / `resources` 直接 400；记录写 `vault_ids=[]` | 改为可注册校验器（§5.1） |
| `agenticx/managed/host/models.py` | 16-27 | `CreateSessionRequest.vault_ids: list[str]` | 不改模型，校验在服务层 |
| `agenticx/runtime/session_boundary.py` | 56-75 | `egress_denial`：空白名单 = 不限；`domain` 匹配本身与子域；**`*.x.com` 写法永远匹配不上**（只 `lstrip(".")`） | 托管侧另写 `host_matches`，不改 `egress_denial` 语义 |
| `agenticx/cli/agent_tools.py` | 9776-9793、9878-9905 | `_fetch_http_bytes` 用 `httpx.AsyncClient(follow_redirects=True)`；`web_fetch` 只接受 `url`，无自定义头；非 too-large / http 的 `ValueError` 统一回 `"ERROR: network"` | 白名单必须在**每个请求（含重定向）**上检查 → httpx `request` 事件钩子；拦截原因要透出 |
| `agenticx/cli/agent_tools.py` | 6050-6121 | `_apply_command_sandbox` 调 `build_command_sandbox_plan(...)` 不传 `environ`（子进程继承 `os.environ`）；沙箱不可用时经确认门后**无隔离执行** | 占位符经新参数 `environ` 注入；白名单非空时沙箱不可用必须拒绝 |
| `agenticx/runtime/command_sandbox.py` | 65、187-232、319-354、1156-1223、1226-1300 | 明确「不是网络沙箱」；`base_env = dict(os.environ if environ is None else environ)`；macOS `_macos_profile` 以 `(allow default)` 开头；Linux `_bubblewrap_argv` 无 `--unshare-net` | 新增 `network="deny"`：Linux 加 `--unshare-net`，macOS 追加 `(deny network-outbound (remote ip))` |
| `agenticx/runtime/hooks/__init__.py` | 41-47、106-117；`agent_runtime.py` L7871 | `after_tool_call` 可改写结果，改写发生在结果进入上下文与事件之前 | 工具结果脱敏放这里 |
| `agenticx/managed/protocol.py` | 71-85、210-214、395-411 | PAT scopes 含 `ma:vaults:read`；`ErrorInfo.mcp_server`；`SessionRecord.vault_ids` | — |

---

## 2. 关键设计决策（本子规划内定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **扩展点而非硬编码**：新增 `SessionExtension` 协议（`before_turn` / `after_turn` / `close`），`SessionService.register_extension_factory()` 注册，`LocalTurnExecutor` 在回合前后调用。凭证代理是第一个扩展，MA-A07 记忆挂载是第二个 | A06 与 A07 都要在回合边界做事、都要改 hook / 工具表；一次性开好接口，避免两次改 actor |
| D2 | **MCP 隔离 = 每会话、每回合一个 `SessionMcpPool`**：回合开始解析凭证、为 manifest 声明的每个 server 新建 `MCPClientV2`（注入该会话的令牌）、`discover_tools`；回合结束 `close()`。**完全不经过** `StudioSession.mcp_hub` / `GlobalMcpManager`。MCP 工具以函数名 `mcp__<server>__<tool>` 暴露，经 fallback resolver 执行 | 进程单例共享连接 = 不同会话的令牌互串；`mcp_hub` 属性不可替换（`studio.py` L101-114）；每回合重连代价是一次 HTTP initialize，换来轮换即时生效、无空闲连接泄漏 |
| D3 | **每回合解析一次凭证**，结果只放在该回合的内存对象里；占位值在 actor 生命周期内稳定（同一凭证同一会话不变），actor 关闭即丢弃 | 「缓存绑定会话生命周期」与「轮换下一回合生效」兼得；每回合一条审计（E06） |
| D4 | **解析失败 fail-closed**：Vault 解析报错（控制面不可达、500、`MA_VAULT_RESOLVE_ENABLED=0`）→ 本回合不调用模型，写 `session.error{type:"vault_resolution_failed"}` 并以 `retries_exhausted` 收尾 | 不能在缺凭证 / 缺白名单信息时继续执行 |
| D5 | **`environment_variable` 的诚实范围（v1）**：<br>① bash 子进程 `env` 中 `secret_name=agxsec_<32 hex>`，真实值**从不**进入沙箱；<br>② 真实值只在**框架自己发出**的请求里替换：`web_fetch` 请求 URL（含重定向后的每一跳）与 MCP 工具调用参数中出现该占位值、且目标 host 命中该凭证 `allowed_hosts`（或 `unrestricted`）时；<br>③ **bash 内 `curl -H "Authorization: Bearer $X"` 发出的仍是占位值**——对任意子进程做透明替换需要 TLS 终结的 MITM 代理（预置 CA、改写 `SSL_CERT_FILE` 等、处理 HTTP/2 与流式），v1 不做，写入威胁模型「残余风险」 | 把能做到的做实；不在门测试里冒充「出口替换」 |
| D6 | **出站白名单 = 环境 `egress_allow_domains`**（空 = 不限）：`web_fetch` 每个请求（含重定向）检查、MCP 在连接前检查、bash 在白名单非空时**整体断网**（Linux `--unshare-net`，macOS `deny network-outbound`）；白名单非空而命令沙箱不可用 → bash 拒绝执行。命中拦截写 `session.error{type:"egress_blocked"}` | 没有网络命名空间 + 代理时，无法让 bash 只访问白名单主机；「白名单非空即 bash 无网络」是唯一可强制的形态，且失败方向安全 |
| D7 | **引用 Vault 的授权**：建会话带非空 `vault_ids` 时，调用方 scopes 必须含 `ma:vaults:read`（或 `ma:admin`），否则 403 `forbidden_scope`；`vault_ids` ≤20、不重复、每个经 `provider.validate_vault_ids` 为 `active`，否则 400 `invalid_request`（`vault not found: <id>` / `vault is archived: <id>`） | 只持有 `ma:sessions:write` 的调用方不应借会话使用全租户凭证；不新增 scope（`PAT_SCOPES` 冻结） |
| D8 | **`desktop_worker` 环境 v1 不支持 `vault_ids`**：400 `vault_ids are not supported for desktop_worker environments` | 桌面 Worker 用本机凭证；把企业凭证下发到员工机器另需威胁评估 |
| D9 | **脱敏三层**：① `after_tool_call` 改写工具结果；② `SessionActor.append` 对即将落库的每条事件做深度字符串替换（覆盖 `agent.message`、工具入参、错误消息）；③ 预览帧用 `StreamRedactor`（保留可能是密钥前缀的尾巴，跨帧拼接也不泄露）；④ 进程级 `LogRecord` 工厂对所有日志的消息与异常文本脱敏 | W4 门要求事件与日志全文检索不到密钥；单靠 `dispatch_tool_async` 的 `redact_text` 覆盖不到 Vault 值 |
| D10 | **`bearer` 类型**只用于 `web_fetch`：请求 host 与凭证 `host` 完全相等时注入 `Authorization: Bearer <token>`；跨 host 重定向时钩子会按新 host 重新计算（不命中就删除该头） | 与「普通 HTTPS origin 的静态 Bearer」语义一致；MCP 只按 `mcp_server_url` 匹配 |
| D11 | **个人模式零影响**：所有对 `agent_tools.py` / `command_sandbox.py` / `session_boundary.py` 的改动都由「contextvar 未设置」或「session 上无新属性」短路；`agx serve` 行为不变 | AGENTS.md「严禁乱改已有正确逻辑」 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

框架（新建）：
- `agenticx/managed/extensions.py`
- `agenticx/managed/credentials.py`
- `agenticx/managed/redaction.py`
- `agenticx/managed/egress_policy.py`
- `agenticx/managed/mcp_session.py`
- `agenticx/managed/credential_extension.py`

框架（修改，只精确增删目标行）：
- `agenticx/managed/host/service.py`（校验器与扩展注册；`create_session` 第 109-112 行与 147-148 行）
- `agenticx/managed/host/actor.py`（`SessionActor.__init__` / `append` / `announce_tool_use`；`LocalTurnExecutor._ensure_bundle` / `_run` / `close`）
- `agenticx/managed/events/adapter.py`（`build_tool_use` 增加关键字参数 `ledger_name`）
- `agenticx/managed/actions.py`（`ActionBroker.announce_tool_use` 协议签名增加 `ledger_name`）
- `agenticx/managed/permissions.py`（`ManagedPermissionHook` 增加可选 `mcp_router`）
- `agenticx/managed/host/config.py`（`HostConfig.vaults` 字段与 agents 文件 `vaults:` 加载）
- `agenticx/managed/host/app.py`（`create_ma_app` 末尾安装凭证代理）
- `agenticx/runtime/session_boundary.py`（新增 `EgressGuard` 与 contextvar，不改既有函数）
- `agenticx/runtime/command_sandbox.py`（`build_command_sandbox_plan` / `_bubblewrap_argv` / `_macos_profile` 增加网络参数）
- `agenticx/cli/agent_tools.py`（`_apply_command_sandbox`、`_fetch_http_bytes`、`_tool_web_fetch` 三处）

agent-runtime（修改，E03 产物）：
- `enterprise/apps/agent-runtime/ma_agent_runtime/config.py`（`Settings` 加 2 个字段）
- `enterprise/apps/agent-runtime/ma_agent_runtime/app.py`（`build_app` 加接线步骤）
- `enterprise/apps/agent-runtime/README.md`（追加「凭证与出站」一节）

测试（新建）：
- `tests/managed/test_extensions.py`
- `tests/managed/test_credentials.py`
- `tests/managed/test_redaction.py`
- `tests/managed/test_egress_policy.py`
- `tests/managed/test_mcp_session.py`
- `tests/managed/test_credential_broker_e2e.py`
- `tests/managed/test_w4_vault_gate.py`
- `tests/test_command_sandbox_network.py`
- `tests/test_agent_tools_egress_guard.py`
- `enterprise/apps/agent-runtime/tests/test_vault_wiring.py`

文档：
- `docs/managed-agents/threat-model.md`（§1、§4 追加「MA-A06 落地与残余风险」）

### 3.2 Out of scope（不得修改）

- `agenticx/studio/**`（含 `server.py`）、`agenticx/tools/remote_v2.py`、`agenticx/tools/mcp_hub.py`、`agenticx/runtime/global_mcp_manager.py`、`agenticx/runtime/credential_store.py`、`agenticx/runtime/agent_runtime.py`、`agenticx/managed/builder.py`、`agenticx/managed/spec.py`、`agenticx/managed/protocol.py`、`agenticx/managed/errors.py`。
- `enterprise/apps/admin-console/**`（E06）、`enterprise/apps/gateway/**`、`desktop/**`。
- 透明 MITM 出站代理、bash 内占位值替换、`desktop_worker` 下发凭证、`resources`（MA-A07）、`mcp_oauth` 刷新（E06 在解析接口内完成）、MCP stdio（manifest 只允许 http / sse）。

---

## 4. 新模块骨架

所有新文件头：

```python
#!/usr/bin/env python3
"""<English one-line description>.

Author: Damon Li
"""
```

英文注释、绝对 import、import 置顶。

### 4.1 `agenticx/managed/extensions.py`

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Literal, Protocol, Sequence

from agenticx.runtime.hooks import AgentHook, HookOutcome
from agenticx.runtime.session_boundary import EgressGuard
from agenticx.tools.fallback_chain import ToolResolver

if TYPE_CHECKING:  # import cycle: actor imports this module
    from agenticx.managed.builder import ManagedRuntimeBundle
    from agenticx.managed.host.actor import SessionActor
    from agenticx.managed.redaction import SecretRedactor


class TurnSetupError(Exception):
    """Raised by an extension when the turn must not start. ``error_type`` goes into session.error."""

    def __init__(self, error_type: str, message: str) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.message = message


@dataclass
class TurnContribution:
    hooks: list[AgentHook] = field(default_factory=list)
    tool_schemas: list[dict[str, Any]] = field(default_factory=list)
    resolvers: list[ToolResolver] = field(default_factory=list)
    system_prompt_suffix: str = ""
    command_env: dict[str, str] = field(default_factory=dict)
    command_network: Literal["inherit", "deny"] = "inherit"
    egress_guard: EgressGuard | None = None
    redactor: "SecretRedactor | None" = None
    events: list[dict[str, Any]] = field(default_factory=list)


class SessionExtension(Protocol):
    name: str

    async def before_turn(self, bundle: "ManagedRuntimeBundle") -> TurnContribution: ...
    async def after_turn(self, bundle: "ManagedRuntimeBundle") -> list[dict[str, Any]]: ...
    async def close(self) -> None: ...


SessionExtensionFactory = Callable[["SessionActor"], Awaitable["SessionExtension | None"]]


class CompositeToolResolver(ToolResolver):
    """First delegate whose can_handle() is true wins. Never raises from resolve()."""

    def __init__(self, delegates: Sequence[ToolResolver]) -> None: ...
    async def can_handle(self, task_intent: str) -> bool: ...
    async def resolve(self, task_intent: str, **kwargs: Any) -> str: ...


class DynamicToolResolver(ToolResolver):
    """Holds per-turn delegates; set() replaces them at each turn start."""

    def __init__(self) -> None: ...
    def set(self, delegates: Sequence[ToolResolver]) -> None: ...
    async def can_handle(self, task_intent: str) -> bool: ...
    async def resolve(self, task_intent: str, **kwargs: Any) -> str: ...


class DynamicHook(AgentHook):
    """Registered once per bundle; forwards before/after_tool_call to the current turn's hooks in order."""

    def __init__(self) -> None: ...
    def set(self, hooks: Sequence[AgentHook]) -> None: ...
    async def before_tool_call(self, tool_name: str, arguments: dict[str, Any], session: Any) -> HookOutcome | None: ...
    async def after_tool_call(self, tool_name: str, result: str, session: Any) -> str | None: ...
```

- `CompositeToolResolver.resolve`：找到第一个 `can_handle` 为真的 delegate 调 `resolve`；任何异常 → 返回 `f"ERROR: tool {task_intent} failed"`（不带异常文本，异常文本可能含密钥；`logger.exception` 记录，日志由 D9 兜底脱敏）；都不处理 → `f"ERROR: unknown tool '{task_intent}'"`。
- `DynamicHook.before_tool_call`：依次调用，第一个 `blocked=True` 的结果立即返回；`after_tool_call`：链式改写，返回最终字符串（与 `HookRegistry.run_after_tool_call` 同义）。

### 4.2 `agenticx/managed/credentials.py`

```python
from __future__ import annotations

import re
import secrets
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Protocol, Sequence
from urllib.parse import urlsplit

import httpx

from agenticx.runtime.credential_store import CredentialStore, MissingCredentialError, resolve_refs

CredentialType = Literal["static_bearer", "mcp_oauth", "bearer", "environment_variable"]
PLACEHOLDER_PREFIX = "agxsec_"
MAX_VAULT_IDS = 20


class CredentialResolutionError(Exception):
    """Vault validation or resolution failed. Message never contains secret material."""

    def __init__(self, message: str, *, status: int = 0) -> None: ...


@dataclass(frozen=True)
class ResolvedCredential:
    credential_id: str
    vault_id: str
    vault_index: int
    type: CredentialType
    display_name: str | None
    secret: str                                 # token / access_token / secret_value
    mcp_server_url: str | None = None           # normalized (normalize_mcp_url, no query)
    host: str | None = None                     # bearer only
    secret_name: str | None = None              # environment_variable only
    networking: Literal["unrestricted", "limited"] | None = None
    allowed_hosts: tuple[str, ...] = ()
    refresh_error: bool = False

    def label(self) -> str:
        """Redaction label: secret_name, display_name, or credential id."""


@dataclass(frozen=True)
class CredentialBundle:
    credentials: tuple[ResolvedCredential, ...] = ()
    skipped: tuple[tuple[str, str], ...] = ()   # (vault_id, reason)

    def mcp_credential_for(self, server_url: str) -> ResolvedCredential | None: ...
    def bearer_for_host(self, host: str) -> ResolvedCredential | None: ...
    def env_credentials(self) -> tuple[ResolvedCredential, ...]: ...


class CredentialProvider(Protocol):
    async def validate_vault_ids(self, tenant_id: str, vault_ids: Sequence[str]) -> list[tuple[str, str]]: ...
    async def resolve(self, tenant_id: str, session_id: str, vault_ids: Sequence[str]) -> CredentialBundle: ...
    async def aclose(self) -> None: ...


def normalize_mcp_url(raw: str) -> str | None: ...
def host_matches(host: str, pattern: str, *, include_subdomains: bool) -> bool: ...
def new_placeholder() -> str: ...


@dataclass(frozen=True)
class LocalCredentialSpec:
    """One credential in a dev agents file. Secret fields hold ${cred:NAME} references, never values."""
    credential_id: str
    type: CredentialType
    secret_ref: str
    display_name: str | None = None
    mcp_server_url: str | None = None
    host: str | None = None
    secret_name: str | None = None
    networking: Literal["unrestricted", "limited"] | None = None
    allowed_hosts: tuple[str, ...] = ()


class LocalCredentialProvider:
    def __init__(self, vaults: Mapping[str, Sequence[LocalCredentialSpec]], *, store: CredentialStore | None = None) -> None: ...


class EnterpriseVaultProvider:
    def __init__(self, base_url: str, internal_token: str, *, transport: httpx.AsyncBaseTransport | None = None,
                 timeout: float = 10.0) -> None: ...
    def __repr__(self) -> str: ...   # never print the token
```

规则：

- `normalize_mcp_url(raw)`：与 E06 §5.1.2 同义，但**允许 query**（manifest URL 可能带）；任一校验失败返回 `None`（永不匹配）：
  ```text
  text = raw.strip(); if len > 2048 or any(ord(c) < 0x21 or ord(c) > 0x7e for c in text): None
  u = urlsplit(text); if u.scheme.lower() != "https" or u.username or u.password or u.fragment: None
  host = (u.hostname or "").lower().rstrip("."); if not host: None
  port = u.port  (ValueError -> None)
  netloc = host if port in (None, 443) else f"{host}:{port}"
  path = re.sub(r"/+$", "", u.path or "")
  return f"https://{netloc}{path}" + (f"?{u.query}" if u.query else "")
  ```
- `host_matches(host, pattern, *, include_subdomains)`：两边小写去尾点；`pattern` 以 `*.` 开头 → `host.endswith("." + pattern[2:])`（**不含**裸域）；否则 `host == pattern`，或 `include_subdomains and host.endswith("." + pattern)`。环境白名单用 `include_subdomains=True`（与现有 `egress_denial` 语义一致）；凭证 `allowed_hosts` 用 `False`（与调研「`*.example.com` 通配」一致）。
- `new_placeholder()`：`PLACEHOLDER_PREFIX + secrets.token_hex(16)`（共 39 字符）。
- `CredentialBundle.mcp_credential_for(url)`：`target = normalize_mcp_url(url)`；按 `credentials` 顺序返回第一个 `type in {"static_bearer","mcp_oauth"}` 且 `mcp_server_url == target` 的；`target is None` → None。
- `bearer_for_host(host)`：第一个 `type == "bearer"` 且 `host == host.lower()`。
- `LocalCredentialProvider.validate_vault_ids`：存在 → `active`，否则 `missing`。`resolve`：按 `vault_ids` 顺序展开；`secret = resolve_refs(spec.secret_ref, store)`；`MissingCredentialError` → `CredentialResolutionError(f"local credential not defined: {err.name}")`（名字不是密钥，可透出）；`secret_ref` 不含 `${cred:` → `CredentialResolutionError("secret_ref must be a ${cred:NAME} reference")`。
- `EnterpriseVaultProvider`：
  - `httpx.AsyncClient(base_url=base_url, timeout=timeout, trust_env=False, transport=transport, headers={"Authorization": f"Bearer {internal_token}"})`。
  - `validate_vault_ids` → `POST /api/internal/ma/vaults/validate` body `{"tenant_id", "vault_ids"}` → 返回 `[(v["id"], v["status"]) ...]`。
  - `resolve` → `POST /api/internal/ma/vault-resolve` body `{"tenant_id","session_id","vault_ids"}` → 按 E06 §5.6.2 映射：`token` / `access_token` / `secret_value` 统一放 `secret`；`mcp_server_url` 再过一次 `normalize_mcp_url`；`networking` 取 `networking.type`，`allowed_hosts` 取列表；`refresh_error == "failed"` → `True`；`skipped` 映射为元组。
  - 非 200：`CredentialResolutionError(f"vault service returned {status}", status=status)`；网络错误 / 非 JSON：`CredentialResolutionError("vault service unavailable")`。**异常消息与日志里不得出现 token 或响应体。**

### 4.3 `agenticx/managed/redaction.py`

```python
from __future__ import annotations

import logging
import re
import threading
import traceback
from typing import Any, Mapping

REDACT_MIN_LEN = 8


class SecretRedactor:
    """Replace known secret values with [REDACTED:<label>]. Longest value first (same algorithm as credential_store.redact_text)."""

    def __init__(self, secrets: Mapping[str, str]) -> None: ...   # label -> value; values shorter than 8 are ignored
    @property
    def empty(self) -> bool: ...
    @property
    def values(self) -> tuple[str, ...]: ...
    def redact(self, text: str) -> str: ...
    def redact_obj(self, obj: Any) -> Any: ...   # deep copy; redacts every str in dict values / list items; dict keys untouched


class StreamRedactor:
    """Redact a text stream split into deltas without leaking a secret split across deltas."""

    def __init__(self, redactor: SecretRedactor) -> None: ...
    def feed(self, delta: str) -> str: ...
    def flush(self) -> str: ...


class ProcessSecretRegistry:
    """Union of secrets of all live managed sessions, used by the log record factory."""

    def register(self, key: str, redactor: SecretRedactor) -> None: ...
    def unregister(self, key: str) -> None: ...
    def redact(self, text: str) -> str: ...


PROCESS_SECRETS: ProcessSecretRegistry


def install_log_redaction() -> None:
    """Wrap logging's LogRecord factory once (idempotent): redact msg/args and exception text via PROCESS_SECRETS."""
```

- `StreamRedactor.feed(delta)`：`buf += delta`；计算 `tail` = `buf` 的最长后缀，使其是任一密钥的**真前缀**（逐个密钥 `for l in range(min(len(s) - 1, len(buf)), 0, -1): if buf.endswith(s[:l])`）；输出 `redactor.redact(buf[:len(buf) - tail])`，保留 `buf[-tail:]`。`flush()` 输出 `redactor.redact(buf)` 并清空。
- `install_log_redaction`：用模块级标志防重复；新工厂 `def factory(*a, **kw): record = old(*a, **kw); ...`：
  - `msg = record.getMessage()`；`red = PROCESS_SECRETS.redact(msg)`；若不同则 `record.msg = red; record.args = ()`。
  - `record.exc_info` 非空：`record.exc_text = PROCESS_SECRETS.redact("".join(traceback.format_exception(*record.exc_info)))`；`record.exc_info = None`。
  - 工厂内部任何异常都吞掉并返回原 record（日志不能因脱敏失败而丢）。
- `ProcessSecretRegistry` 内部用 `threading.Lock`；`redact` 每次把所有已注册 redactor 的值合并（长值优先）。

### 4.4 `agenticx/managed/egress_policy.py`

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

from agenticx.managed.credentials import CredentialBundle, ResolvedCredential, host_matches
from agenticx.runtime.session_boundary import EgressGuard


@dataclass
class SessionEgressPolicy:
    allow_domains: tuple[str, ...]                    # environment egress_allow_domains (lowercased); empty = unrestricted
    bundle: CredentialBundle
    placeholders: Mapping[str, str]                   # credential_id -> placeholder
    enforce: bool = True
    blocked: list[tuple[str, str]] = field(default_factory=list)   # (host, reason) recorded by check()

    def check(self, url: str) -> str | None: ...
    def rewrite_url(self, url: str) -> str: ...
    def headers_for(self, url: str) -> dict[str, str]: ...
    def substitute_arguments(self, target_url: str, value: Any) -> Any: ...
    def command_env(self) -> dict[str, str]: ...
    def command_network(self) -> str: ...             # "deny" when enforce and allow_domains else "inherit"
    def to_guard(self) -> EgressGuard: ...
    def drain_blocked(self) -> list[tuple[str, str]]: ...
```

- `check(url)`：`enforce is False` 或 `allow_domains` 为空 → None。`host = urlsplit(url).hostname`（小写去尾点）；空 → `"egress blocked: missing host"`。任一 `host_matches(host, d, include_subdomains=True)` → None；否则 `reason = f"egress blocked: {host} is not in the allow list"`，追加到 `blocked` 并返回。
- `rewrite_url(url)`：对 `bundle.env_credentials()` 中每个凭证 `c`：`ph = placeholders[c.credential_id]`；`ph in url` 且 `_cred_allows(c, host)` → `url = url.replace(ph, c.secret)`。`_cred_allows`：`c.networking == "unrestricted"` 或任一 `host_matches(host, h, include_subdomains=False)`。
- `headers_for(url)`：`c = bundle.bearer_for_host(host)` → `{"Authorization": f"Bearer {c.secret}"}`，否则 `{}`。
- `substitute_arguments(target_url, value)`：深拷贝，对其中每个 `str` 做与 `rewrite_url` 相同的占位替换（host 取自 `target_url`）。
- `command_env()`：`{c.secret_name: placeholders[c.credential_id] for c in env_credentials()}`。
- `to_guard()`：`EgressGuard(check=self.check, rewrite_url=self.rewrite_url, headers_for=self.headers_for)`。

### 4.5 `agenticx/managed/mcp_session.py`

```python
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable, Sequence

from agenticx.managed.credentials import CredentialBundle
from agenticx.managed.egress_policy import SessionEgressPolicy
from agenticx.managed.events import session_error_event
from agenticx.managed.spec import AgentSpec, McpServerSpec
from agenticx.tools.fallback_chain import ToolResolver
from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig

MCP_FUNCTION_PREFIX = "mcp__"
MCP_DISCOVER_TIMEOUT_SECONDS = 20.0
MCP_CALL_TIMEOUT_SECONDS = 120.0
MCP_RESULT_MAX_CHARS = 65536
RESERVED_ARGUMENT_NAMES = frozenset({"task_intent", "max_level"})


@dataclass(frozen=True)
class McpToolBinding:
    function_name: str
    server: str
    tool: str
    server_url: str


class McpToolRouter:
    def __init__(self) -> None: ...
    def add(self, binding: McpToolBinding) -> None: ...
    def resolve(self, function_name: str) -> McpToolBinding | None: ...
    def clear(self) -> None: ...


def mcp_function_name(server: str, tool: str, taken: set[str]) -> str: ...


class SessionMcpPool:
    def __init__(self, spec: AgentSpec, bundle: CredentialBundle, policy: SessionEgressPolicy, router: McpToolRouter,
                 *, client_factory: Callable[[MCPServerConfig], Any] = MCPClientV2) -> None: ...
    async def open(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]: ...   # (tool schemas, session.error events)
    async def call(self, function_name: str, arguments: dict[str, Any]) -> str: ...
    async def close(self) -> None: ...


class ManagedMcpResolver(ToolResolver):
    def __init__(self, pool: SessionMcpPool, router: McpToolRouter) -> None: ...
    async def can_handle(self, task_intent: str) -> bool: ...    # router.resolve(task_intent) is not None
    async def resolve(self, task_intent: str, **kwargs: Any) -> str: ...
```

- `mcp_function_name(server, tool, taken)`：`slug = lambda s: re.sub(r"[^A-Za-z0-9_-]", "_", s)`；`name = f"mcp__{slug(server)}__{slug(tool)}"`；长度 >64 → `name[:55] + "_" + sha1(f"{server}\0{tool}").hexdigest()[:8]`；与 `taken` 冲突 → 追加 `_2`、`_3`…（截断保持 ≤64）。
- `open()`：`router.clear()`；对 `spec.mcp_servers` 每个 `server`：
  1. `toolset = spec.mcp_toolset(server.name)`；为 None → 跳过（不暴露，无事件）。
  2. `denial = policy.check(server.url)` → 有则 `events.append(_mcp_error(server.name, "egress_blocked", denial))`，跳过（并调用 `policy.drain_blocked()` 清掉该条，避免重复上报）。
  3. `cred = bundle.mcp_credential_for(server.url)`；`headers = {"Authorization": f"Bearer {cred.secret}"} if cred else {}`。
  4. `config = MCPServerConfig(name=server.name, url=server.url, transport="streamable_http" if server.transport == "http" else "sse", headers=headers, timeout=60.0)`；`client = client_factory(config)`。
  5. `tools = await asyncio.wait_for(client.discover_tools(), MCP_DISCOVER_TIMEOUT_SECONDS)`；任何异常 → `events.append(_mcp_error(server.name, "mcp_connection_failed", f"mcp server {server.name}: {type(exc).__name__}"))`，`await client.close()`（吞异常），跳过。
  6. 对每个 tool：`toolset.policy_for(tool.name)` 为 None → 跳过；`inputSchema.properties` 含 `RESERVED_ARGUMENT_NAMES` 任一 → `logger.warning` 后跳过；生成函数名、`router.add(...)`、schema：
     ```python
     {"type": "function", "function": {"name": fn, "description": f"[MCP {server.name}] {tool.description}"[:1024],
                                        "parameters": tool.inputSchema or {"type": "object", "properties": {}}}}
     ```
  `_mcp_error(server, type, message)` = `session_error_event(type, message[:300], "exhausted")` 再给 `event["error"]["mcp_server"] = server`。
- `call(fn, arguments)`：`b = router.resolve(fn)`；`args = policy.substitute_arguments(b.server_url, {k: v for k, v in arguments.items() if not k.startswith("__")})`；`result = await asyncio.wait_for(client.call_tool(b.tool, args), MCP_CALL_TIMEOUT_SECONDS)`；渲染：`result.content` 中 text 块按 `\n` 拼接，image → `[image omitted]`，其他 → `[<type> omitted]`；`result.isError` → `"ERROR: " + text`；空 → `"(empty result)"`；截断到 `MCP_RESULT_MAX_CHARS`。任何异常 → `f"ERROR: mcp tool {b.server}/{b.tool} failed: {type(exc).__name__}"`（不带异常消息）。
- `close()`：逐个 `await client.close()`，吞异常；幂等。
- `ManagedMcpResolver.resolve(task_intent, **kwargs)`：`return await pool.call(task_intent, kwargs)`（`call` 自己剥 `__` 键）。

### 4.6 `agenticx/managed/credential_extension.py`

```python
from __future__ import annotations

from typing import Any, Sequence

from agenticx.managed.credentials import MAX_VAULT_IDS, CredentialProvider, CredentialResolutionError, new_placeholder
from agenticx.managed.egress_policy import SessionEgressPolicy
from agenticx.managed.errors import FORBIDDEN_SCOPE, INVALID_REQUEST, MAError
from agenticx.managed.extensions import SessionExtension, TurnContribution, TurnSetupError
from agenticx.managed.mcp_session import ManagedMcpResolver, McpToolRouter, SessionMcpPool
from agenticx.managed.redaction import PROCESS_SECRETS, SecretRedactor
from agenticx.runtime.hooks import AgentHook

EXTENSION_NAME = "credentials"


class CredentialBrokerExtension:
    name = EXTENSION_NAME

    def __init__(self, actor: Any, provider: CredentialProvider | None, *, egress_enforce: bool) -> None: ...
    async def before_turn(self, bundle: Any) -> TurnContribution: ...
    async def after_turn(self, bundle: Any) -> list[dict[str, Any]]: ...
    async def close(self) -> None: ...


class _RedactAndReportHook(AgentHook):
    """after_tool_call: redact the result and append pending egress_blocked errors immediately."""


def install_credential_broker(state: Any, provider: CredentialProvider | None, *, egress_enforce: bool = True,
                              mcp_client_factory: Callable[[MCPServerConfig], Any] | None = None) -> None: ...
```

`mcp_client_factory` 只供测试注入假 MCP 客户端（缺省 `MCPClientV2`），经 `CredentialBrokerExtension(..., mcp_client_factory=...)` 传给 `SessionMcpPool(client_factory=...)`；`CredentialBrokerExtension.__init__` 同步增加该关键字参数。（需在本文件 import `Callable` 与 `agenticx.tools.remote_v2.MCPServerConfig`。）FR-7 / FR-8 / FR-15 / FR-16 的 e2e 测试在 `create_ma_app(...)` 之后再调用一次 `install_credential_broker(app.state.ma, LocalCredentialProvider(config.vaults), mcp_client_factory=FakeMcpClient)` 覆盖默认安装（同名扩展工厂替换规则见 §5.6）。

`before_turn(bundle)`：
1. `vault_ids = list(actor.record.vault_ids)`；有且 `provider` 非空 → `bundle_ = await provider.resolve(actor.tenant_id, actor.session_id, vault_ids)`；`CredentialResolutionError` → `raise TurnSetupError("vault_resolution_failed", str(err))`。无 vault → 空 `CredentialBundle()`。
2. 占位值：`self._placeholders`（actor 生命周期字典）中为每个 env 凭证 `setdefault(credential_id, new_placeholder())`。
3. `allow = tuple(d.lower() for d in actor.environment.config.egress_allow_domains)` 当 `actor.environment.type == "cloud"`，否则 `()`。
4. `policy = SessionEgressPolicy(allow, bundle_, dict(self._placeholders), enforce=self._egress_enforce)`。
5. `redactor = SecretRedactor({c.label(): c.secret for c in bundle_.credentials})`；`PROCESS_SECRETS.register(f"{tenant}:{sid}", redactor)`。
6. `router = McpToolRouter()`；`self._pool = SessionMcpPool(actor.spec, bundle_, policy, router)`；`schemas, events = await self._pool.open()`。
7. `self._router = router`（供权限 hook 识别，见 §5.10）。
8. 返回 `TurnContribution(hooks=[_RedactAndReportHook(actor, policy, redactor)], tool_schemas=schemas, resolvers=[ManagedMcpResolver(self._pool, router)], command_env=policy.command_env(), command_network=policy.command_network(), egress_guard=policy.to_guard(), redactor=redactor, events=events)`。

`_RedactAndReportHook.after_tool_call(tool_name, result, session)`：`blocked = policy.drain_blocked()`；有则 `await actor.append([session_error_event("egress_blocked", reason, "exhausted") for _, reason in blocked])`；返回 `redactor.redact(result)`。

`after_turn(bundle)`：`await self._pool.close()`（若有）；`self._router = None`；返回 `[]`（`blocked` 若在最后一个工具后仍有剩余，在这里 drain 成事件返回）。

`close()`：关闭池；`PROCESS_SECRETS.unregister(...)`；清空占位值。

`install_credential_broker(state, provider, *, egress_enforce)`：
- `provider` 非空 → `state.service.register_create_validator("vault_ids", _make_vault_validator(provider))`。
- `state.service.register_extension_factory(lambda actor: _factory(actor))`，`_factory` 只在 `actor.environment.type == "cloud"` 时返回 `CredentialBrokerExtension(actor, provider, egress_enforce=egress_enforce)`，否则 `None`。
- `provider` 有 `aclose` → `state.shutdown_hooks.append(provider.aclose)`。

`_make_vault_validator(provider)` 返回：

```python
async def validate(principal, req, environment) -> list[str]:
    ids = list(req.vault_ids)
    if not ids:
        return []
    if environment.type == "desktop_worker":
        raise MAError(INVALID_REQUEST, "vault_ids are not supported for desktop_worker environments")
    if "ma:vaults:read" not in principal.scopes and "ma:admin" not in principal.scopes:
        raise MAError(FORBIDDEN_SCOPE, "vault_ids require ma:vaults:read", details={"scope": "ma:vaults:read"})
    if len(ids) > MAX_VAULT_IDS or len(set(ids)) != len(ids):
        raise MAError(INVALID_REQUEST, "vault_ids must contain at most 20 unique ids")
    try:
        statuses = await provider.validate_vault_ids(principal.tenant_id, ids)
    except CredentialResolutionError:
        raise MAError(INTERNAL, "vault service unavailable")
    for vault_id, status in statuses:
        if status == "missing":
            raise MAError(INVALID_REQUEST, f"vault not found: {vault_id}")
        if status != "active":
            raise MAError(INVALID_REQUEST, f"vault is archived: {vault_id}")
    return ids
```

（`INTERNAL` 从 `agenticx.managed.errors` 导入。）

---

## 5. 修改既有文件的精确落点

### 5.1 `agenticx/managed/host/service.py`

1. import 区追加（精确增行）：`from agenticx.managed.extensions import SessionExtensionFactory` 与 `from agenticx.managed.protocol import EnvironmentRecord`（若 `EnvironmentRecord` 已在 protocol import 列表中就合入同一行）。类型别名：

   ```python
   CreateValidator = Callable[[Principal, CreateSessionRequest, EnvironmentRecord], Awaitable[list[Any]]]
   ```
2. `__init__` 末尾加：`self._create_validators: dict[str, CreateValidator] = {}`、`self._extension_factories: list[SessionExtensionFactory] = []`。
3. 新方法：

   ```python
   def register_create_validator(self, field: Literal["vault_ids", "resources"], validator: CreateValidator) -> None:
       """Install the validator for a CreateSessionRequest list field. Later calls replace it."""
       self._create_validators[field] = validator

   def register_extension_factory(self, factory: SessionExtensionFactory) -> None:
       self._extension_factories.append(factory)

   @property
   def extension_factories(self) -> tuple[SessionExtensionFactory, ...]:
       return tuple(self._extension_factories)
   ```
4. `create_session`：**删除** L109-112 的两段 `raise`；在 `if not self.supports_environment(...)` 判断之后、`compile_spec(...)` 之前插入：

   ```python
   vault_ids = await self._validated_list("vault_ids", principal, req, environment)
   resources = await self._validated_list("resources", principal, req, environment)
   ```
   并把 `SessionRecord(...)` 中 `vault_ids=[]`、`resources=[]` 改为 `vault_ids=vault_ids`、`resources=resources`。私有方法：

   ```python
   async def _validated_list(self, field, principal, req, environment) -> list[Any]:
       raw = getattr(req, field)
       if not raw:
           return []
       validator = self._create_validators.get(field)
       if validator is None:
           raise MAError(INVALID_REQUEST, f"{field} are not supported by this host yet")
       return await validator(principal, req, environment)
   ```
   （消息与改前逐字相同，保证未安装校验器时行为不变；顺序变化：先校验 agent / 版本 / 环境，再校验这两个字段——W1 测试 `test_host_api.py` L224 用合法 agent + `vault_ids=["x"]`，dev host 安装了 Local 校验器后返回 400 `vault not found: x`，状态码不变。）

### 5.2 `agenticx/managed/host/actor.py`

1. import 追加：`from agenticx.managed.extensions import CompositeToolResolver, DynamicHook, DynamicToolResolver, SessionExtension, TurnContribution, TurnSetupError`、`from agenticx.managed.redaction import SecretRedactor, StreamRedactor`、`from agenticx.runtime.session_boundary import bind_egress_guard, unbind_egress_guard`、`from agenticx.managed.events.adapter import TurnOutcome`（若已从 events 包导入则复用）、`from agenticx.managed.events import session_error_event`。
2. `SessionActor.__init__` 末尾：`self.extensions: list[SessionExtension] = []`、`self.redactor: SecretRedactor | None = None`。
3. `SessionActor.append`：

   ```python
   async def append(self, events: Sequence[Mapping[str, Any]]) -> list[StoredEvent]:
       if self.redactor is not None and not self.redactor.empty:
           events = [self.redactor.redact_obj(dict(event)) for event in events]
       return await self.event_log.append(self.tenant_id, self.session_id, events)
   ```
4. `SessionActor.announce_tool_use` 增加关键字参数 `ledger_name: str | None = None`，原样传给 `self.adapter.build_tool_use(..., ledger_name=ledger_name)`。
5. `LocalTurnExecutor.__init__` 追加：`self._dynamic_resolver = DynamicToolResolver()`、`self._dynamic_hook = DynamicHook()`、`self._base_tools: list[dict] | None = None`、`self._base_system_prompt: str | None = None`、`self._extensions_ready = False`。
6. `_ensure_bundle`：
   - `resolver = CustomToolResolver(...)` 之后，`builder.build(...)` 改为 `custom_tool_resolver=CompositeToolResolver([resolver, self._dynamic_resolver])`、`hooks=[hook, self._dynamic_hook]`。
   - `hook = ManagedPermissionHook(engine=engine, broker=actor, authorization=auth)` 改为 `ManagedPermissionHook(engine=engine, broker=actor, authorization=auth, mcp_router_getter=self._current_mcp_router)`（见 §5.4）。
   - bundle 建好后：`self._base_tools = list(self._bundle.tools)`、`self._base_system_prompt = self._bundle.system_prompt`。
   - 首次（`not self._extensions_ready`）：`for factory in actor.service.extension_factories: ext = await factory(actor); if ext is not None: actor.extensions.append(ext)`；置 `self._extensions_ready = True`。
7. 新私有方法：

   ```python
   def _current_mcp_router(self):
       for ext in self.actor.extensions:
           router = getattr(ext, "current_router", None)
           if router is not None:
               return router
       return None

   async def _before_turn(self, bundle) -> TurnContribution:
       merged = TurnContribution()
       for ext in self.actor.extensions:
           part = await ext.before_turn(bundle)       # TurnSetupError propagates
           merged.hooks.extend(part.hooks)
           merged.tool_schemas.extend(part.tool_schemas)
           merged.resolvers.extend(part.resolvers)
           if part.system_prompt_suffix:
               merged.system_prompt_suffix += "\n" + part.system_prompt_suffix
           merged.command_env.update(part.command_env)
           if part.command_network == "deny":
               merged.command_network = "deny"
           if part.egress_guard is not None:
               merged.egress_guard = part.egress_guard
           if part.redactor is not None:
               merged.redactor = part.redactor
           merged.events.extend(part.events)
       bundle.tools[:] = list(self._base_tools or []) + merged.tool_schemas
       bundle.system_prompt = (self._base_system_prompt or "") + merged.system_prompt_suffix
       bundle.session.managed_command_env = dict(merged.command_env)
       bundle.session.managed_command_network = merged.command_network
       self._dynamic_resolver.set(merged.resolvers)
       self._dynamic_hook.set(merged.hooks)
       self.actor.redactor = merged.redactor
       return merged

   async def _after_turn(self, bundle) -> list[dict]:
       events: list[dict] = []
       for ext in self.actor.extensions:
           try:
               events.extend(await ext.after_turn(bundle))
           except Exception:
               logger.exception("extension after_turn failed session=%s ext=%s", self.actor.session_id, ext.name)
       self._dynamic_resolver.set([])
       self._dynamic_hook.set([])
       return events
   ```
   （`ext.current_router`：`CredentialBrokerExtension` 暴露只读属性 `current_router`，回合内为 `McpToolRouter`，回合外为 None。）
8. `_run`：在 `bundle = await self._ensure_bundle(...)` 之后、`text, unsupported = message_text(message)` 之前插入：

   ```python
   try:
       contribution = await self._before_turn(bundle)
   except TurnSetupError as exc:
       actor.adapter.begin_turn(actor.record.usage)
       usage_events = actor.adapter.finish_turn().events          # session.usage only (no span open)
       outcome = TurnOutcome(
           stop_type="retries_exhausted",
           events=[session_error_event(exc.error_type, exc.message[:500], "exhausted"), *usage_events],
           usage=actor.record.usage,
       )
       async with actor.lock:
           await actor.finish_turn_locked(outcome)
           self._task = None
           if self._queue:
               await self._start_locked(self._queue.popleft())
       return
   if contribution.events:
       await actor.append(contribution.events)
   guard_token = bind_egress_guard(contribution.egress_guard) if contribution.egress_guard is not None else None
   stream = StreamRedactor(actor.redactor) if actor.redactor is not None and not actor.redactor.empty else None
   ```
   - 预览帧：`for frame in output.previews:` 改为若 `stream` 非空且 `frame.get("type") == "event_delta"`：`text = stream.feed(frame["content_delta"])`，为空则跳过，否则发 `{**frame, "content_delta": text}`；`event_start` 帧原样发。循环结束（含异常路径）在 `finish_turn` 前 `tail = stream.flush()`，非空则补发一帧 `event_delta`。
   - 把原有 `try/except` 外层包一层 `try: ... finally:`，在 `finally` 中：`extra = await self._after_turn(bundle)`（存到局部变量，随后在 `async with actor.lock:` 内、`finish_turn_locked(outcome)` 之前 `if extra: await actor.append(extra)`），并 `if guard_token is not None: unbind_egress_guard(guard_token)`。
   - 注意：MA-A04 的「convert 必须在拉取下一条 runtime 事件之前完成」约束不受影响（插入点都在循环外）。
9. `close()`：在取消任务之后追加 `for ext in self.actor.extensions: try: await ext.close() except Exception: logger.exception(...)`。

### 5.3 `agenticx/managed/events/adapter.py`

`build_tool_use` 签名追加关键字参数 `ledger_name: str | None = None`；`self._ledger.record(AnnouncedToolUse(event_id=event_id, kind=kind, name=ledger_name or name, mcp_server=mcp_server))`。其余不变（事件 `name` 仍用 `name`）。docstring 补一句「`ledger_name` binds the announce to a runtime function name that differs from the event name (MCP)」。

### 5.4 `agenticx/managed/actions.py` 与 `agenticx/managed/permissions.py`

- `actions.py`：`ActionBroker.announce_tool_use` 协议签名追加 `ledger_name: str | None = None`。
- `permissions.py`：`ManagedPermissionHook.__init__` 追加可选参数 `mcp_router_getter: Callable[[], Any] | None = None`。`before_tool_call` 在「custom 返回 None」分支之后、内置工具分支之前插入：

  ```python
  router = self._mcp_router_getter() if self._mcp_router_getter is not None else None
  binding = router.resolve(tool_name) if router is not None else None
  if binding is not None:
      decision = self._engine.evaluate_mcp(binding.server, binding.tool, arguments)
      event_id = await self._broker.announce_tool_use(
          kind="mcp", name=binding.tool, input=arguments,
          evaluated_policy=decision.evaluated_policy, mcp_server=binding.server, ledger_name=tool_name,
      )
      # deny / ask / allow handling is identical to the builtin branch below (reuse the same helper)
  ```
  实施时把内置分支里「deny → blocked；ask → request_action → allow 才 grant」的代码抽成私有方法 `_apply_decision(decision, event_id, tool_name)`，两个分支共用；**不改**内置分支的行为与返回文本。`evaluate_mcp` 的实际返回字段以 `permissions.py` 现有实现为准。

### 5.5 `agenticx/managed/host/config.py`

1. `HostConfig` 加字段 `vaults: Mapping[str, tuple[LocalCredentialSpec, ...]] = field(default_factory=dict)`（`from agenticx.managed.credentials import LocalCredentialSpec`）。
2. agents 文件新增可选顶层键 `vaults`，加载函数 `_load_vaults(raw) -> dict[str, tuple[LocalCredentialSpec, ...]]`，格式：

   ```yaml
   vaults:
     - id: dev-vault
       credentials:
         - id: gh
           type: static_bearer
           mcp_server_url: https://mcp.example.com/mcp
           secret_ref: ${cred:GITHUB_MCP_TOKEN}
         - id: example-key
           type: environment_variable
           secret_name: EXAMPLE_API_KEY
           secret_ref: ${cred:EXAMPLE_API_KEY}
           networking: {type: limited, allowed_hosts: [api.example.com]}
   ```
   校验：`id` 匹配 `DEV_ID_RE`、唯一；`type` 四选一；按类型必填同 E06 §4.4（`mcp_server_url` 过 `normalize_mcp_url` 且不得带 query；`host` 小写；`secret_name` 正则 `^[A-Z_][A-Z0-9_]{0,127}$`）；`secret_ref` 必须完整匹配 `^\$\{cred:[A-Z][A-Z0-9_]{1,63}\}$`；任何错误 → `HostConfigError(f"vaults[{i}].credentials[{j}].<field>: invalid")`。**明文值写在 agents 文件里一律拒绝**（`secret_ref` 正则保证）。若 agents 文件的未知顶层键检查存在，把 `vaults` 加入允许集合。

### 5.6 `agenticx/managed/host/app.py`

`create_ma_app` 在 `app.include_router(build_session_router(state))` 之后插入：

```python
install_credential_broker(state, LocalCredentialProvider(config.vaults), egress_enforce=True)
```

（import `install_credential_broker` 与 `LocalCredentialProvider`。）agent-runtime 用自己的 `HostConfig`（`vaults` 为空）调用 `create_ma_app` 后，会**再次**调用 `install_credential_broker`（企业 provider），`register_create_validator` 后者覆盖前者；扩展工厂会被注册两次 → `install_credential_broker` 内部先移除已注册的同名扩展工厂：工厂函数带属性 `_ma_extension_name = "credentials"`，`SessionService.register_extension_factory` 若发现同名则替换（在 §5.1 的 `register_extension_factory` 中实现：`name = getattr(factory, "_ma_extension_name", None)`，有名字且已存在同名 → 替换该位置）。

### 5.7 `agenticx/runtime/session_boundary.py`（只新增，既有函数一字不改）

```python
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class EgressGuard:
    """Per-task outbound policy for framework-issued HTTP requests (managed sessions only)."""

    check: Callable[[str], "str | None"]
    rewrite_url: Callable[[str], str]
    headers_for: Callable[[str], "dict[str, str]"]


_EGRESS_GUARD: ContextVar["EgressGuard | None"] = ContextVar("agx_egress_guard", default=None)


def current_egress_guard() -> "EgressGuard | None":
    return _EGRESS_GUARD.get()


def bind_egress_guard(guard: EgressGuard) -> Token:
    return _EGRESS_GUARD.set(guard)


def unbind_egress_guard(token: Token) -> None:
    _EGRESS_GUARD.reset(token)
```

（import 合入文件顶部 import 区；`from __future__ import annotations` 已有。）

contextvar 传播：`_run` 在自己的 task 内 `bind`，runtime 随后 `asyncio.create_task(dispatch)` 会复制当前上下文，工具执行看得到 guard；`unbind` 在 `finally`。

### 5.8 `agenticx/cli/agent_tools.py`（三处，精确增删）

1. `_fetch_http_bytes`（L9776-9793）：

   ```python
   async def _fetch_http_bytes(url: str, *, timeout: float, max_bytes: int) -> tuple[bytes, str, str]:
       import httpx

       from agenticx.runtime.session_boundary import current_egress_guard

       guard = current_egress_guard()
       transport = _httpx_transport_for_url(url)
       client_kwargs: Dict[str, Any] = {"timeout": timeout, "follow_redirects": True, "transport": transport}
       if guard is not None:
           async def _guard_request(request: "httpx.Request") -> None:
               denial = guard.check(str(request.url))
               if denial:
                   raise ValueError(denial)
               rewritten = guard.rewrite_url(str(request.url))
               if rewritten != str(request.url):
                   request.url = httpx.URL(rewritten)
               request.headers.pop("authorization", None)
               for key, value in guard.headers_for(str(request.url)).items():
                   request.headers[key] = value

           client_kwargs["event_hooks"] = {"request": [_guard_request]}
       async with httpx.AsyncClient(**client_kwargs) as client:
           ...  # unchanged body
   ```
   函数内现有的 `import httpx` 是既有写法（本文件惯例），新增的 `current_egress_guard` 导入**改放文件顶部 import 区**（`agent_tools.py` 顶部已 import `agenticx.runtime.session_boundary` 的 `foreign_session_denial` 时合入同一行）。`guard is None` 时传给 `AsyncClient` 的参数与改前完全相同。
   - 注意：重定向时 httpx 会为新请求再次调用 `request` 钩子；`ValueError` 从 `client.get` 抛出。
   - `final_url`（L9786）在 rewrite 后可能含真实值 → 由 `after_tool_call` 脱敏覆盖（D9 第一层）。
2. `_tool_web_fetch`（L9897-9903 的 `except ValueError as exc:` 块）在 `if reason.startswith("http "):` 之后插入：

   ```python
           if reason.startswith("egress blocked"):
               return f"ERROR: {reason}"
   ```
3. `_apply_command_sandbox`（L6089-6121）：
   - `build_command_sandbox_plan(` 调用追加两个参数：`environ=_managed_command_environ(session),`、`network=_managed_command_network(session),`。
   - `except CommandSandboxUnavailable as exc:` 分支最前插入：

     ```python
         if _managed_command_network(session) == "deny":
             return "ERROR: command sandbox unavailable; this environment restricts network egress and requires the OS sandbox"
     ```
   - 新增两个模块级私有函数（放在 `_apply_command_sandbox` 之前）：

     ```python
     def _managed_command_environ(session: Optional[StudioSession]) -> Optional[Dict[str, str]]:
         """Managed sessions overlay placeholder env vars; None keeps the historical os.environ inheritance."""
         overlay = getattr(session, "managed_command_env", None) if session is not None else None
         if not isinstance(overlay, dict) or not overlay:
             return None
         env = dict(os.environ)
         env.update({str(k): str(v) for k, v in overlay.items()})
         return env


     def _managed_command_network(session: Optional[StudioSession]) -> str:
         value = getattr(session, "managed_command_network", None) if session is not None else None
         return "deny" if value == "deny" else "inherit"
     ```
   - `permissions == DANGER_FULL_ACCESS` 分支（L6069-6087）之前插入：若 `_managed_command_network(session) == "deny"` 且 `permissions == DANGER_FULL_ACCESS` → `return "ERROR: danger-full-access is not allowed in a network-restricted environment"`。

### 5.9 `agenticx/runtime/command_sandbox.py`

1. `build_command_sandbox_plan` 增加关键字参数 `network: str = "inherit"`（docstring 加一句「`"deny"` cuts all IP networking for the child; only honored by confined tiers」）；`network not in {"inherit", "deny"}` → `CommandSandboxError("invalid network mode")`。`DANGER_FULL_ACCESS` 早返回分支：`network == "deny"` → `raise CommandSandboxUnavailable("network isolation requires a confined permission tier")`。
2. darwin 分支：`_macos_profile(..., deny_network=(network == "deny"))`。`_macos_profile` 增加关键字参数 `deny_network: bool = False`；在 `return` 之前、process-exec deny 行之后：`if deny_network: lines.append("(deny network-outbound (remote ip))")`。
3. linux 分支：`_bubblewrap_argv(..., unshare_net=(network == "deny"))`。`_bubblewrap_argv` 增加关键字参数 `unshare_net: bool = False`；在初始列表 `"--unshare-uts",` 之后条件插入 `"--unshare-net"`。
4. Windows / 其他平台分支：`network == "deny"` → `raise CommandSandboxUnavailable("network isolation is not supported on this platform")`。
5. 文件顶部注释「This is not a network sandbox」（L65）**保持**，新增参数的 docstring 说明例外。

### 5.10 agent-runtime 接线（E03 产物，以实际为准）

`ma_agent_runtime/config.py` 的 `Settings` 增加：

| 字段 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `credentials_enabled: bool` | `MA_RUNTIME_CREDENTIALS_ENABLED` | `True`（仅 `"0"` 为假） | 假 → 不注册 Vault 校验器（`vault_ids` 回到 400「not supported」），出站白名单仍生效 |
| `egress_enforce: bool` | `MA_RUNTIME_EGRESS_ENFORCE` | `True`（仅 `"0"` 为假） | 假 → 只记录不拦截（紧急回滚用，启动日志 WARNING） |

`ma_agent_runtime/app.py` 的 `build_app`：在 `create_ma_app(...)` 之后、`app.add_middleware(OnBehalfOfMiddleware)` 之前插入：

```python
install_log_redaction()
provider = (
    EnterpriseVaultProvider(settings.admin_url, settings.internal_token, transport=admin_transport)
    if settings.credentials_enabled else None
)
install_credential_broker(app.state.ma, provider, egress_enforce=settings.egress_enforce)
```

（`admin_transport` 是 E03 `build_app` 已有的测试注入参数，复用它让测试用同一个 `FakeAdminConsole`。）

---

## 6. Before / After

| 场景 | Before | After |
|---|---|---|
| `POST /ma/v1/sessions` 带 `vault_ids` | 400 not supported | 校验 scope / 数量 / 存在性后写入 `vault_ids` |
| Manifest 声明 MCP server | 编译了但不连接，工具不可见 | 每回合为该会话单独连接，按 URL 注入令牌，工具以 `mcp__server__tool` 可调用，事件为 `agent.mcp_tool_use` / `agent.mcp_tool_result` |
| MCP 连接失败 | — | `session.error{type:"mcp_connection_failed", mcp_server}`，会话继续 |
| bash 里 `echo $EXAMPLE_API_KEY` | 变量不存在 | 输出 `agxsec_<32 hex>` |
| `web_fetch` 访问白名单外主机（含重定向跳转） | 放行 | `ERROR: egress blocked: ...` + `session.error{type:"egress_blocked"}` |
| 白名单非空时 bash `curl` | 放行 | 无网络（连接失败） |
| 工具结果 / 模型回复里出现密钥 | 原样落库 | `[REDACTED:<label>]` |
| 个人模式 `agx serve` | — | **不变** |

---

## 7. FR / NFR / AC

测试约定：`tests/managed/` 下 `async def test_*` 依赖仓库 `asyncio_mode = "auto"`；集成测试设 `AGX_EFFECT_GUARD=0`（W1 备忘）；需要真实 HOME 的测试用 `monkeypatch.setenv("HOME", str(tmp_path))`；脚本 LLM 用 `agenticx.managed.testing` 的 `ScriptStep` / `tool_call` / `PerSessionScriptFactory`（参照 `tests/managed/test_w1_gate_e2e.py`）。

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 扩展协议 | `test_extensions.py::test_composite_resolver_order_and_errors`：两个 delegate 都 can_handle → 第一个结果；delegate 抛 `RuntimeError("tok-secret")` → 返回 `"ERROR: tool x failed"` 且不含 `tok-secret`；都不处理 → `ERROR: unknown tool 'x'`。`test_dynamic_hook_chain`：两个 hook 的 after 链式改写；第一个 before 返回 blocked 时第二个不被调用 |
| FR-2 | URL 归一化与 E06 一致 | `test_credentials.py::test_normalize_mcp_url_table`：与 E06 FR-3 同一张表逐项相同；另 `"https://x.com/mcp?a=1"` → `"https://x.com/mcp?a=1"`；`"http://x.com"` → None |
| FR-3 | host 匹配 | `test_host_matches`：`("a.example.com","*.example.com",False)` 真；`("example.com","*.example.com",False)` 假；`("a.example.com","example.com",True)` 真；`("a.example.com","example.com",False)` 假；`("EXAMPLE.com.","example.com",False)` 真 |
| FR-4 | 本地 provider | `test_local_provider_resolves_refs`：HOME=tmp，`CredentialStore().set("GITHUB_MCP_TOKEN","ghp_local_123456")`；provider 解析 → `secret == "ghp_local_123456"`、顺序按 vault_ids；引用未定义 → `CredentialResolutionError` 消息含 `GITHUB_MCP_TOKEN` 不含任何值 |
| FR-5 | 企业 provider | `test_enterprise_provider_maps_response`：`httpx.MockTransport` 返回 E06 §5.6.2 样例 → 四类凭证字段映射正确、`refresh_error` 为 True 的那条正确、`skipped` 正确；请求头 `authorization == "Bearer it"`；500 → `CredentialResolutionError` 且 `str(err)` 不含 `it`；`repr(provider)` 不含 `it` |
| FR-6 | 建会话校验 | `test_credential_broker_e2e.py::test_create_session_vault_validation`（dev host，agents 文件含 `vaults`）：合法 → 201 且 `vault_ids` 回显；未知 id → 400 `vault not found`；21 个 → 400；重复 → 400；principal 无 `ma:vaults:read`（自定义 token 映射）→ 403 `forbidden_scope`；`environment_id="worker"`（desktop_worker）→ 400 `vault_ids are not supported for desktop_worker environments`；不带 `vault_ids` 的建会话行为与 W1 相同 |
| FR-7 | MCP 会话隔离与注入 | `test_mcp_session.py::test_pool_injects_matching_bearer`：`client_factory` 用假客户端记录 `config.headers`；manifest 两个 server（A 有匹配凭证、B 无）→ A 的 headers `{"Authorization":"Bearer tok-a-123456"}`、B 为 `{}`；两个 vault 都有 A 的凭证 → 用 `vault_index=0` 的那条。`test_pool_isolated_per_session`：两个池各用不同令牌，各自假客户端收到各自令牌；`GlobalMcpManager._instance is None`（测试前 `reset_for_testing()`） |
| FR-8 | MCP 工具暴露与权限 | `test_mcp_session.py::test_tool_exposure_respects_toolset`：toolset `configs` 禁用 `delete_repo` → schema 不含；未声明 toolset 的 server 不连接；工具 inputSchema 含 `task_intent` → 跳过。`test_credential_broker_e2e.py::test_mcp_always_ask_requires_action`：manifest MCP toolset `default_policy: always_ask` → 会话停在 `requires_action`，事件为 `agent.mcp_tool_use`（`name` 为原始工具名、`mcp_server` 为 server 名、`evaluated_policy == "always_ask"`）；回 allow 后出现 `agent.mcp_tool_result` 且 `mcp_tool_use_id` 指向该事件 |
| FR-9 | MCP 失败与白名单 | `test_mcp_session.py::test_connect_failure_emits_session_error`：假客户端 `discover_tools` 抛错 → events 一条 `session.error`，`error.type == "mcp_connection_failed"`、`error.mcp_server == "A"`、`retry_status.type == "exhausted"`；`test_mcp_blocked_by_egress`：环境白名单 `["other.com"]` → `error.type == "egress_blocked"` 且 factory 未被调用 |
| FR-10 | 脱敏 | `test_redaction.py::test_longest_first_and_min_len`；`test_redact_obj_deep`（嵌套 dict/list，键不变）；`test_stream_redactor_split_secret`：密钥 `sk-abcdefghij` 拆成 `"x sk-abc"`、`"defghij y"` 两帧 → 拼接输出不含 `sk-abc`（任何长度 ≥3 的密钥子串都不出现）且含 `[REDACTED:` ；`test_log_factory_redacts_message_and_exception`：注册密钥后 `logging.getLogger("t").error("v=%s", secret)` 与 `logger.exception` 带含密钥的异常，`caplog.text` 不含密钥 |
| FR-11 | 出站策略 | `test_egress_policy.py`：空白名单 → `check` 恒 None、`command_network() == "inherit"`；`["example.com"]` → `https://api.example.com/x` 放行、`https://evil.com` 拒绝且 `blocked` 有一条；`rewrite_url`：占位在 URL 且 host ∈ allowed_hosts → 替换，host 不在 → 不替换；`unrestricted` → 任意 host 替换；`headers_for`：bearer host 精确匹配才给头；`substitute_arguments` 深替换 |
| FR-12 | web_fetch 钩子 | `test_agent_tools_egress_guard.py::test_no_guard_keeps_client_kwargs`：monkeypatch `httpx.AsyncClient` 记录 kwargs → 未绑定 guard 时 kwargs 键集合为 `{"timeout","follow_redirects","transport"}`；`test_guard_blocks_redirect`：`_httpx_transport_for_url` 返回 `httpx.MockTransport`：`https://allowed.com/a` 302 → `https://evil.com/b`；绑定白名单 `allowed.com` 的 guard → `_tool_web_fetch({"url": "https://allowed.com/a"})` 返回以 `ERROR: egress blocked: evil.com` 开头；`test_guard_injects_bearer_only_same_host`：记录 MockTransport 收到的请求头，同 host 有 `authorization`，跨 host 重定向后的请求无 |
| FR-13 | bash 占位与断网 | `test_command_sandbox_network.py::test_bwrap_unshare_net`：monkeypatch `shutil.which("bwrap")` → `/usr/bin/bwrap`，`build_command_sandbox_plan(["/bin/true"], writable_roots=[tmp], platform_name="linux", network="deny")` 的 argv 含 `--unshare-net`；`network="inherit"` 时不含；`test_macos_profile_denies_network`：`_macos_profile([tmp], deny_network=True)` 含 `(deny network-outbound (remote ip))`，默认不含；`test_danger_full_access_rejects_deny`；`test_invalid_network_mode`。`test_agent_tools_egress_guard.py::test_managed_command_env_overlay`：session 上设 `managed_command_env={"EXAMPLE_API_KEY":"agxsec_x"}` → `_managed_command_environ(session)["EXAMPLE_API_KEY"] == "agxsec_x"`；未设 → None |
| FR-14 | 回合失败收尾 | `test_credential_broker_e2e.py::test_vault_resolution_failure_ends_turn`：provider.resolve 抛 `CredentialResolutionError` → 会话 `idle` + `retries_exhausted`，事件含 `session.error{type:"vault_resolution_failed"}`，假 LLM 调用次数为 0 |
| FR-15 | 轮换下一回合生效 | `test_credential_broker_e2e.py::test_rotation_applies_next_turn`：第一回合 provider 返回 `tok-1-aaaaaaaa`，第二回合返回 `tok-2-bbbbbbbb` → 假 MCP 客户端两次分别收到对应令牌；占位值两回合相同 |
| FR-16 | **W4 门（凭证部分）** | `test_w4_vault_gate.py::test_w4_vault_gate`：HOME=tmp；dev agents 文件：Agent manifest 含 MCP server `https://mcp.test/mcp`（toolset `always_allow`）、内置 `bash_exec` / `web_fetch` `always_allow`；环境 `egress_allow_domains: ["mcp.test", "api.example.com"]`（在 agents 文件 `environments` 中声明 cloud 环境）；`vaults` 含 `static_bearer`（`${cred:MCP_TOKEN}` = `w4-mcp-token-123456`）与 `environment_variable` `EXAMPLE_API_KEY`（`${cred:EXAMPLE_KEY}` = `w4-env-secret-abcdef`，limited `api.example.com`）。假 MCP 客户端 `call_tool("echo")` 原样返回参数与收到的 Authorization 头。脚本 LLM：① 调 `mcp__srv__echo({"text": "hi"})`；② 调 `bash_exec({"command": "printenv EXAMPLE_API_KEY"})`；③ 调 `web_fetch({"url": "https://evil.example.net/"})`；④ 文本回复 `"token is w4-mcp-token-123456"`。断言：假 MCP 收到 `Bearer w4-mcp-token-123456`；bash 结果匹配 `^agxsec_[0-9a-f]{32}\s*$`（沙箱不可用的平台用 `pytest.skip`，但 `_managed_command_environ` 仍断言）；web_fetch 结果以 `ERROR: egress blocked` 开头且存在 `session.error{type:"egress_blocked"}`；把 SQLite 事件库所有 `payload` 拼成文本 + `caplog.text` → 不含 `w4-mcp-token-123456` 与 `w4-env-secret-abcdef`，且 `agent.message` 文本含 `[REDACTED:` |
| FR-17 | agent-runtime 接线 | `enterprise/apps/agent-runtime/tests/test_vault_wiring.py::test_vault_ids_resolved_via_admin_console`：沿用 E03 `FakeAdminConsole` 增加 `/api/internal/ma/vaults/validate` 与 `/api/internal/ma/vault-resolve` 两个 handler；PAT scopes 含 `ma:vaults:read`；建会话带 `vault_ids` → 201；发消息后 FakeAdminConsole 记录到一次 resolve 请求，body 的 `session_id` 等于会话 id；`MA_RUNTIME_CREDENTIALS_ENABLED=0` 构建的 app → 带 `vault_ids` 建会话 400 `vault_ids are not supported by this host yet` |
| NFR-1 | 个人模式不回归 | `pytest tests/test_agent_tools*.py tests/test_command_sandbox*.py -q --no-cov` 全绿（排除 W1 备忘里列出的 3 个既有失败）；`HOME=$(mktemp -d) agx serve --host 127.0.0.1 --port 18765` 冷启动后 `/api/session` 200 |
| NFR-2 | 托管既有测试不回归 | `pytest tests/managed -q --no-cov` 全绿 |
| NFR-3 | 不触碰 Studio | `git diff --quiet -- agenticx/studio agenticx/tools/remote_v2.py agenticx/runtime/global_mcp_manager.py agenticx/runtime/credential_store.py agenticx/managed/builder.py agenticx/managed/spec.py agenticx/managed/protocol.py` |
| NFR-4 | 日志不泄露 | 人工：`rg -n "logger\.\w+\(.*(token|secret)" agenticx/managed` 只出现键名不出现值变量 |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
export AGX_EFFECT_GUARD=0
python -m pytest -o addopts="" -o asyncio_mode=auto \
  tests/managed/test_extensions.py tests/managed/test_credentials.py tests/managed/test_redaction.py \
  tests/managed/test_egress_policy.py tests/managed/test_mcp_session.py \
  tests/managed/test_credential_broker_e2e.py tests/managed/test_w4_vault_gate.py -q
python -m pytest -o addopts="" tests/test_command_sandbox_network.py tests/test_agent_tools_egress_guard.py -q
python -m pytest tests/managed -q --no-cov
python -m pytest tests/test_command_sandbox*.py -q --no-cov
python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q
# 个人模式冷启动（必须临时 HOME，避免改写真实 serve.port）
TMPH=$(mktemp -d); HOME=$TMPH agx serve --host 127.0.0.1 --port 18765 & SPID=$!; sleep 12
curl --noproxy '*' -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18765/api/session; kill $SPID
# 本地托管宿主演示（agents 文件含 vaults，--data-dir 指向临时目录）
agx ma serve --dev --port 8093 --agents-file /tmp/w4-agents.yaml --data-dir "$(mktemp -d)"
git status --porcelain
```

---

## 9. 回滚

- agent-runtime：`MA_RUNTIME_CREDENTIALS_ENABLED=0` → `vault_ids` 回到「not supported」400；`MA_RUNTIME_EGRESS_ENFORCE=0` → 白名单只记录不拦截、bash 不断网（启动日志 WARNING）。
- 控制面侧：E06 `MA_VAULT_RESOLVE_ENABLED=0` → 回合以 `vault_resolution_failed` 收尾（不会无凭证执行）。
- 代码：删除 §3.1 新建文件，`git checkout` 被修改文件。个人模式代码路径在 guard / session 属性缺失时本就与改前等价，回滚无数据迁移。

---

## 10. 不变量、风险与待确认问题

### 10.1 不变量

1. 个人模式（`agx serve`、Near）：未绑定 `EgressGuard`、session 无 `managed_command_*` 属性 → `web_fetch`、`bash_exec`、命令沙箱行为与改前逐字节一致。
2. 托管会话绝不读写 `StudioSession.mcp_hub` / `GlobalMcpManager`；不同会话的 MCP 客户端与令牌互不可见。
3. 凭证明文只存在于：provider 返回对象、`SessionMcpPool` 的 `MCPServerConfig.headers`、`SessionEgressPolicy` 内存、出站请求本身；从不写入事件库、日志、沙箱环境、模型上下文。
4. 未安装扩展的宿主（例如只用 `SessionService` 的单测）行为与 W1 相同；`TurnExecutor` 协议不变。
5. `egress_denial` / `configured_egress_allowlist` 的语义与调用方不变。

### 10.2 风险与残余缺口（同步写入威胁模型）

1. **bash 内凭证不可用（D5③）**：`environment_variable` 对 bash 内直接 HTTP 调用无效（对方收到占位值）。补齐需要 TLS 终结的出站代理（预置 CA、改写 CA 环境变量、处理 HTTP/2 / WebSocket / 流式），列入后续候选。
2. **白名单只对框架路径精确生效**：bash 在白名单非空时整体断网；白名单为空时 bash 网络不受限（与 E03 现状一致）。macOS `deny network-outbound (remote ip)` 需在目标机实测（AC FR-13 只验证 profile 文本，W4 门在 Linux 容器实测）。
3. **外部服务回显**：MCP / 网页把收到的头回显进结果时，脱敏只能处理与已知密钥完全相同的字符串（编码 / 截断后的变体拦不住），与调研文档的保证边界相同。
4. **短密钥**：长度 <8 的密钥不脱敏（与 `credential_store.REDACT_MIN_LEN` 一致），E06 不强制最小长度 → 管理页提示「建议至少 8 位」，见 Q2。
5. 每回合重连 MCP 增加首包延迟（一次 initialize + list_tools）。

### 10.3 须先登记到 master §12 / 待确认问题

- **登记项**：① 会话面新增扩展协议 `SessionExtension`（`agenticx/managed/extensions.py`），A07 复用；② 建会话 `vault_ids` 需 `ma:vaults:read`（D7）、`desktop_worker` 不支持 `vault_ids`（D8）；③ 新增 `session.error.type` 取值 `vault_resolution_failed` / `mcp_connection_failed` / `egress_blocked`；④ MCP 工具函数命名 `mcp__<server>__<tool>`；⑤ 威胁模型残余风险（D5③）。
- **Q1**：门户（MA-E04）的服务 PAT 当前 scope 不含 `ma:vaults:read`（E03 §5.12 预置脚本）。门户若需要替用户引用 Vault，需要给服务 PAT 加该 scope——是否接受？
- **Q2**：是否在 E06 强制密钥最小长度 8（否则无法脱敏）？
- **Q3**：是否需要在 v1.5 立项「出站凭证代理（MITM）」以让 bash 内的 `environment_variable` 真正可用？
