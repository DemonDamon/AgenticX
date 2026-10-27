# Connectors 模块结论

> 结论覆盖基线至 commit `22d051f5d18ad83a4c6083683342ab41d7850149`（`agenticx/connectors` 共 7 个源文件；与 `agenticx/runtime/connectors_store.py` 分工见 Responsibility）。

## Responsibility

- 在 **remote MCP 模板实例** 之外，为对话侧提供三类连接器能力：**REST**（经本地 Go `connector-runtime` 网关注册 action 并执行）、**database**（内置 stdio MCP `agenticx.connectors.db_mcp` + 只读 SQL 门禁）、**OAuth**（REST 的 PKCE / client_credentials 探针，以及 remote MCP 的 `OAuthClientProvider` 桥接）。
- 负责 **本地 connector gateway 生命周期客户端**：发现/拉起 sidecar、`/admin/*` 管理面调用、把 loopback MCP URL 写回 `mcp.json` 的 `connector-runtime` / `connector-runtime-local` 条目（与 Desktop 同形）。
- 负责 **OpenAPI/Swagger → gateway connector JSON**（`rest_spec`），以及 **数据库连接与 MCP 工具实现**（`database` / `db_mcp`）；编排层 `manage` 汇总 REST/DB 流程并委托 `connectors_store` 做 `mcp.json` 纯函数变更。
- Explicit non-responsibilities:
  - **不**拥有 `~/.agenticx/mcp.json` 的读写契约与模板目录：路径、`read_mcp_doc` / `write_mcp_doc`、`connector_templates.json` 加载、`upsert_connector` / `set_connector_credential(s)` / `list_instances` / `public_instance` / `scrub_secret` 均在 **`agenticx/runtime/connectors_store.py`**；`manage.create_database` / `set_database_password` 仅调用 `cs.servers_map`、`cs.list_instances`、`cs.sanitize_server_name`、`cs.META_KEY` 等，不重复实现去重与脱敏规则。
  - **不**实现 MCP Hub 持久会话与工具调用（`agenticx/tools/remote_v2.py` 消费 `build_mcp_oauth_provider`，gateway 执行 REST action 仍走 MCP `mcp_call`）。
  - **不**实现 Go 网关本体（仅 `gateway_client` 子进程与 HTTP 客户端）；**不**维护 Desktop TS 去重模型（Python 侧镜像在 `connectors_store`）。
  - `__init__.py` **不** re-export 子模块符号。

## Entry points and public interfaces

- `python -m agenticx.connectors.db_mcp`：`db_mcp.main()` → `build_server().run("stdio")`。
- `agenticx.connectors.database`：`DbConfig.from_env` / `to_env` / `validate` / `identity`；`Database`（`list_tables`、`describe_table`、`query`、`execute_write`、`health`）；`check_read_only_sql`、`driver_status`、`normalize_db_type`、`DbError`。
- `agenticx.connectors.rest_spec`：`load_spec_text`、`parse_spec_text`、`actions_from_openapi`、`actions_from_endpoint_list`、`build_connector`、`suggest_auth`、`connector_id_from_name`；`SpecError`。
- `agenticx.connectors.gateway_client`：`ensure_gateway`、`stop_spawned_gateway`；`Gateway.admin` / `mcp_url` / `runtime_token`；`ensure_gateway_mcp_entry`；`data_dir`、`binary_path`、`gateway_proxy_status`；常量 `GATEWAY_SERVER_NAME`、`GATEWAY_FALLBACK_SERVER_NAME`；`GatewayError`。
- `agenticx.connectors.manage`：`build_rest_auth`、`credential_fields`；`register_rest`、`rest_instances`、`save_rest_credential`、`check_rest`、`unregister_rest`、`get_rest_definition`；`create_database`、`set_database_password`、`database_entry_command`；常量 `REST_PREFIX`、`REST_AUTH_TYPES`。
- `agenticx.connectors.oauth`：`run_pkce_authorization`、`exchange_client_credentials`、`pkce_pair`、`LoopbackReceiver`；`build_mcp_oauth_provider`、`FileTokenStorage`、`fix_authorize_url`；`OAuthFlowError`。
- 对外主入口（模块外）：Studio 工具 **`connector_manage`**（`agenticx/cli/agent_tools.py` 的 `_tool_connector_manage` / `_connector_manage_ext`）调用上述符号并配合 `connectors_store` 落盘。

## Core execution path

- **REST 创建**：`connector_manage`（`create_rest` 等）→ `gateway_client.ensure_gateway` → `manage.register_rest`（可选 `rest_spec.load_spec_text` → `actions_from_openapi` 或 `actions_from_endpoint_list` → `rest_spec.build_connector`）→ `Gateway.admin("PUT", "/admin/connectors/{cid}", definition)` → 返回 `instance_id` 形如 `rest:{connector_id}`；凭证经 `save_rest_credential` → `POST/PUT /admin/connections`；会话侧需 `_connector_ensure_gateway_mcp` → `ensure_gateway_mcp_entry` 写入 `mcp.json` 后 `mcp_connect` + `mcp_call` 执行 gateway action。
- **Database 创建**：`manage.create_database` 构造 `command`+`args`（`sys.executable`, `-m agenticx.connectors.db_mcp`）与 `env`（`AGX_DB_*`）及 `_agenticx.kind=database` → 经 `connectors_store` 合并进 `mcpServers` → MCP 连接后 `db_mcp.build_server` 懒加载 `Database`，工具 `query` 走 `check_read_only_sql` 与连接级只读；`AGX_DB_ALLOW_WRITES=1` 时暴露 `execute_write`。
- **REST OAuth**：`authorize_oauth` 等路径 → `oauth.run_pkce_authorization`（浏览器 + `LoopbackReceiver`）→ token 写入 gateway connection secret（不经模型返回明文）。
- **Remote MCP OAuth**：`mcp.json` 条目 `oauth: true` → `remote_v2` 在 HTTP transport 上挂载 `oauth.build_mcp_oauth_provider`（`FileTokenStorage` 于 `~/.agenticx/connectors/oauth/`）。
- **Gateway 发现**：读 `data_dir()/sidecar.json` + pid + `/healthz`；否则 `subprocess.Popen` 启动 `connector-runtime serve`；进程退出时 `atexit` 调用 `stop_spawned_gateway`。

## Data and configuration

- **`~/.agenticx/mcp.json`**：database 实例与 gateway 基础设施条目（REST 用户 connector 定义在 gateway 数据目录，列表经 `/admin/apps`）；变更由 `connectors_store.write_mcp_doc` 执行（`manage` / `agent_tools` 触发）。
- **`~/.agenticx/connector-runtime/`**：`sidecar.json`、`runtime.token`、`admin.token`（0600）、`gateway.log`；目录可由 `AGX_CONNECTOR_RUNTIME_DIR` 覆盖；二进制 `AGX_CONNECTOR_RUNTIME_BIN` 或 `PATH` / `desktop/bundled-sidecar/<arch>/connector-runtime`。
- **`~/.agenticx/connectors/oauth/<server>.json`**：`FileTokenStorage` 存 MCP OAuth token 与 `redirect_port`（0600）。
- **Database**：密码与连接参数在 `mcp.json` 的 `env`（`AGX_DB_TYPE`、`AGX_DB_PATH` / `AGX_DB_HOST` 等、`AGX_DB_PASSWORD`、`AGX_DB_ROW_LIMIT`、`AGX_DB_ALLOW_WRITES`、`AGX_DB_SSL`）；运行时 `DbConfig.from_env()` 读取。
- HTTP 出站统一经 `agenticx.utils.proxy_policy`（`make_client` / `make_async_client`；loopback 直连）。

## Dependencies

- Upstream：`mcp`（`FastMCP`、`OAuthClientProvider`、`OAuthToken`）；可选 `pymysql`、`psycopg2` / `psycopg`；可选 `yaml`（OpenAPI YAML）；`agenticx.utils.proxy_policy`；**`agenticx.runtime.connectors_store`**（DB 条目与 URL/命名校验，非 REST 注册体）。
- Downstream：`agenticx/cli/agent_tools.py`（`connector_manage`、gateway 确保、DB 校验、`run_pkce_authorization`）；`agenticx/tools/remote_v2.py`（`build_mcp_oauth_provider`）；`agenticx/studio/server.py`（凭证澄清与 `connector_manage` 分类）；`agenticx/runtime/prompts/meta_agent.py`（提示使用 `connector_manage`）。
- 运行时外部：`connector-runtime` Go sidecar；Electron/Desktop 与之共享 data dir 与 `mcp.json` gateway 条目形态。

## Tests and operations

- `tests/test_connectors_rest_db.py`：`rest_spec` 解析/OpenAPI action、`manage.build_rest_auth` / `create_database`、`connector_manage` 模板与 DB 流、`oauth.fix_authorize_url` / `FileTokenStorage` 权限。
- `tests/test_connector_gateway_integration.py`：真实 `connector-runtime` 二进制；`ensure_gateway` 复用、`create_rest` + `mcp_call`、`oauth2_client_credentials` / authorization_code PKCE（mock `webbrowser`）、sqlite `db_mcp` stdio。
- `tests/test_connectors_store.py`：`connectors_store` 与 `connector_manage` 的 `mcp.json` 去重/凭证（边界在 store，对话 REST/DB 扩展在 connectors）。
- 运维：REST 依赖本机 gateway 健康（`gateway.log`、`/healthz`）；DB 连接器需对应 Python 驱动；生产 REST 凭证仅存 gateway connection 与 `mcp.json` env/headers，工具返回经 `public_instance` / gateway 错误摘要，禁止把 `admin.token` 或 DB 密码注入模型上下文；修改 `connectors_store` 去重语义须同时回归 Desktop TS 与 `test_connectors_store.py`。
