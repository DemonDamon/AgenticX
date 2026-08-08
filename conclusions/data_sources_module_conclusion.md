# Data Sources 模块结论

## Responsibility

`agenticx/data_sources` 是 Studio 对话侧的统一外部数据源网关：将 AkShare、World Bank、IMF、Tushare（MCP 桥接）、iFinD（stub）等插件封装为一致的 `DataSourcePlugin` 协议，由 `DataSourceRegistry` 按 `~/.agenticx/config.yaml` 的 `data_sources` 节加载，并通过 Agent 工具 `list_data_sources` / `query_data_source` 及 REST `/api/data-sources/*` 暴露给 Desktop 设置页与 Meta-Agent 查数纪律（须先工具取数再回答量化结论）。

## Entry points and public interfaces

- **包导出**（`agenticx/data_sources/__init__.py`）：`DataSourcePlugin`、`ApiSpec`、`DataSourceResult`、`DataSourceRegistry`、`build_registry_from_config`、异常类 `DataSourceError` 及其子类。
- **Agent 工具**（`agenticx/cli/agent_tools.py`）：`_tool_list_data_sources`、`_tool_query_data_source`；内部 `_get_data_source_registry()` 懒加载单例，`reset_data_source_registry_cache()` 在配置变更后失效。
- **HTTP**（`agenticx/studio/data_sources_routes.py`）：`GET /api/data-sources/config`、`PUT /api/data-sources/config`、`GET /api/data-sources/status`、`POST /api/data-sources/test`。
- **配置辅助**（`credential_store.py`）：`get_data_sources_section`、`get_plugin_config`、`is_plugin_enabled`、`get_credentials`、`has_required_credentials`——供 UI/插件读取，非 registry 主路径。

## Core execution path

1. `build_registry_from_config()` 读取 `ConfigManager.GLOBAL_CONFIG_PATH`，经 `_effective_data_sources_section()` 与 `DEFAULT_DATA_SOURCES`（来自 `DATA_SOURCE_CATALOG`）合并。
2. 对每个 `enabled: true` 的条目，查 `_PLUGIN_MODULE_PATHS` 懒 `importlib.import_module`，调用模块级 `build_plugin(raw_entry)` 构造实例并 `registry.register()`；单插件失败仅 warning，不阻断其他源。
3. `registry.call(data_source_name, api_name, params)` 校验插件与 API 存在性，再 `asyncio.wait_for(plugin.call(...), timeout=DEFAULT_CALL_TIMEOUT_SECONDS)`（默认 20s），超时抛 `UpstreamTimeoutError`。
4. 工具层将 `DataSourceResult.to_dict()` JSON 返回；`MissingCredentialError` / `DataSourceError` 映射为可读 `ERROR:` 字符串。

## Important classes and functions

| 符号 | 角色 |
|------|------|
| `DataSourcePlugin` (Protocol) | `name`、`display_name`、`domain`、`requires_credential`；`list_apis()` / `async call()` |
| `ApiSpec` / `DataSourceResult` | API 元数据与统一返回（含 `as_of`、`attribution`、`warnings`） |
| `DataSourceRegistry` | 注册表与带超时的 `call()` 路由 |
| `build_registry_from_config` | 从 YAML 构建 registry |
| `DATA_SOURCE_CATALOG` / `DEFAULT_DATA_SOURCES` | 静态目录与默认 enabled 开关 |
| `AkSharePlugin` | `stock_price_history`、`stock_realtime_quote`（可选依赖 `akshare`） |
| `WorldBankPlugin` | `indicator_by_country`（httpx → World Bank API） |
| `ImfPlugin` | `macro_indicator`（httpx → IMF DataMapper） |
| `TusharePlugin` | `daily` / `income`，经 `GlobalMcpManager.hub.call_tool` 路由到 `tushareMcp` |
| `IFindPlugin` | 列出 iFinD API 名但 `call()` 恒抛 `MissingCredentialError`（`stub_only`） |
| 异常层级 | `DataSourceNotFoundError`、`DataSourceApiNotFoundError`、`MissingCredentialError`、`UpstreamTimeoutError`、`InvalidParamsError` |

## Data and configuration

- **配置位置**：`~/.agenticx/config.yaml` → `data_sources.<name>.enabled`、可选 `credentials`、`mcp_server`（Tushare）等；`ConfigManager.update_section("data_sources", …)` 供 PUT API 写入。
- **默认启用**：catalog 中 `akshare`、`world_bank`、`imf` 的 `default_enabled: true`；`tushare`、`ifind` 默认关闭且需凭证/MCP。
- **插件模块映射**：`_PLUGIN_MODULE_PATHS` 固定五键 → `agenticx.data_sources.plugins.*_plugin`。
- **运行时缓存**：`agent_tools` 模块级 `_DATA_SOURCE_REGISTRY` 单例；配置 PUT 后必须 `reset_data_source_registry_cache()`。

## Dependencies

- **`agenticx.cli.config_manager.ConfigManager`**：YAML 读写与 `get_value`。
- **插件可选/外部**：`httpx`（宏观 REST）；`akshare`（finance，缺失时 ImportError 提示 `pip install 'agenticx[data-sources]'`）；`agenticx.runtime.global_mcp_manager.GlobalMcpManager`（Tushare MCP 连通性与工具发现）。
- **上游联动**：`meta_agent` 查数纪律块、`data_source_flow_guard` 检测未调用 `query_data_source` 的量化声称、`tool_result_budget` 对两工具的结果分级、`compactor` 对 `query_data_source` 结果专项压缩。

## Tests and operations

- `tests/test_smoke_data_source_registry.py`：`build_registry_from_config` 默认加载免费源、registry 路由与超时。
- `tests/test_smoke_data_source_plugins_wave1.py`：各插件 `list_apis` / `call` 行为（含 iFinD stub、AkShare 裁剪逻辑）。
- `tests/test_smoke_data_sources_routes.py`：Studio status/config/test 端点。
- `tests/test_smoke_data_source_skill_discipline.py`：Meta 提示与 uncited quant 检测。
- **运维**：Desktop「数据源」Tab 通过 status 字段区分 `disabled` / `ready` / `mcp_disconnected` / `missing_credential` / `unavailable`；Tushare 需先在 MCP 连接 `tushareMcp`。

## Unverified or ambiguous

- `credential_store.has_required_credentials` 未被 registry 统一调用；各插件在 `build_plugin(config)` 或 `call()` 内自行校验（iFinD 恒 stub，Tushare 查 MCP 连接而非 YAML credentials）。
- AkShare 历史行情在 A 股市场优先 `stock_zh_a_daily`（新浪），失败回退 `stock_zh_a_hist`；网络/代理环境影响实际可用性，模块内仅打 warning。
