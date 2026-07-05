# Sub-Plan A：统一查数网关核心框架（DataSourcePlugin 协议 + Registry + 原生工具）

Planned-with: Claude Sonnet 5
Plan-Id: 2026-07-05-data-source-gateway-core-framework
Plan-File: .cursor/plans/2026-07-05-data-source-gateway-core-framework.plan.md
父规划: `.cursor/plans/2026-07-05-unified-data-source-gateway.plan.md`

## 1. 需求

### FR（功能需求）

- **FR-1**：新增原生工具 `query_data_source`，参数为 `data_source_name`（string）、`api_name`（string）、`params`（object），返回结构化 JSON 字符串（对齐 Kimi 的三元组调用心智）。
- **FR-2**：新增原生工具 `list_data_sources`，Agent 可在不确定有哪些数据源/API 时先查询目录（返回已启用插件列表 + 每个插件的 `list_apis()` 摘要），避免 system prompt 里硬编码全部 API 文档导致上下文膨胀。
- **FR-3**：定义 `DataSourcePlugin` Protocol：`name`、`display_name`、`domain`（如 `finance`/`macro`/`academic`/`enterprise`/`legal`）、`requires_credential`（bool）、`list_apis() -> list[ApiSpec]`、`async call(api_name, params) -> DataSourceResult`。
- **FR-4**：`DataSourceRegistry` 负责：按 `~/.agenticx/config.yaml` 的 `data_sources:` 节加载已启用插件、按 `data_source_name` 路由、统一异常包装（插件未启用/凭证缺失/参数校验失败/上游超时四类错误要有区分明确的错误信息）。
- **FR-5**：`DataSourceResult` 统一返回结构：`{ "source": str, "api": str, "data": Any, "as_of": str|None, "attribution": str|None, "warnings": list[str] }`，保证下游 `show_widget` 渲染与 Skill 文本引用有稳定字段可用。
- **FR-6**：凭证解析复用现有 `CredentialStore`（若不存在等价机制，需先確认 `agenticx/tools/remote.py` 或 `agenticx/security` 下是否已有凭证抽象，避免重复造轮子——**执行者必须先搜索确认**，若确无则在本任务内新增最小 `DataSourceCredentialStore`，落盘路径复用 `~/.agenticx/config.yaml` 的 `data_sources.<name>.credentials`，且遵守「禁止 `file_write`/`file_edit` 直改 config.yaml」的既有安全约束，须走 `ConfigManager` 专用写入方法）。
- **FR-7**：工具结果需纳入现有 `tool_result_budget.py` / `compactor.py` 的裁剪体系（金融时间序列数据量可能较大，需定义一个 `"query_data_source": "medium"`（或按数据量动态）的预算档位，避免撑爆上下文）。

### NFR（非功能需求）

- **NFR-1**：单次工具调用超时统一 20s（可配置），超时需返回明确错误而非挂起 Agent Loop。
- **NFR-2**：插件加载失败（如缺依赖库、凭证未配置）不得影响其他插件加载——**条目级容错**，与 `2026-06-22-near-remote-url-mcp-support.plan.md` 中「单条 MCP 失败不拖垮全局」同一原则。
- **NFR-3**：日志/错误信息中不得打印凭证明文（对齐现有 MCP headers 不落日志的先例）。
- **NFR-4**：`query_data_source` 与 `list_data_sources` 均需注册进 `agenticx/studio/server.py` 的 `/api/tools/registry` 分类表（`_TOOL_CATEGORIES`），新增分类 `"data_source"`。

### AC（验收标准）

- **AC-1**：`registry.list_plugins()` 在零插件启用时返回空列表且不抛异常。
- **AC-2**：调用未知 `data_source_name` 返回 `ERROR: unknown data source '<name>'. Available: [...]`（而非裸异常堆栈）。
- **AC-3**：调用已知数据源但缺凭证时返回 `ERROR: data source '<name>' requires credentials. Configure via Desktop 设置 → 数据源.`（不指向手改 YAML）。
- **AC-4**：一个插件的 `call()` 抛异常不影响同一会话内后续调用其他插件。
- **AC-5**：`list_data_sources` 返回体積可控（每个插件仅摘要，不含完整 API 参数 schema，除非 `verbose=true`）。

## 2. 技术方案

### 2.1 目录结构（新增）

```
agenticx/data_sources/
├── __init__.py              # 导出 DataSourcePlugin, DataSourceRegistry, DataSourceResult
├── base.py                  # Protocol 定义 + DataSourceResult + ApiSpec dataclass
├── registry.py              # DataSourceRegistry：加载/路由/错误包装
├── errors.py                # DataSourceError 及子类（NotFound/MissingCredential/UpstreamTimeout/InvalidParams）
├── credential_store.py      # 凭证读写（若确认无可复用现有实现）
└── plugins/
    └── __init__.py          # 留空，Sub-Plan B 填充具体插件
```

参考既有范式 `agenticx/studio/kb/`（`contracts.py` 定义冻结契约 + `manager.py` 编排 + `runtime.py` 执行），本模块采用同构分层：`base.py`≈`contracts.py`，`registry.py`≈`manager.py`。

### 2.2 `base.py` 核心类型

```python
#!/usr/bin/env python3
"""Data source gateway contracts: plugin protocol and result shapes.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable


@dataclass
class ApiSpec:
    """Describes one callable API exposed by a data source plugin."""

    name: str
    description: str
    params_schema: Dict[str, Any] = field(default_factory=dict)
    example_params: Optional[Dict[str, Any]] = None


@dataclass
class DataSourceResult:
    """Uniform return shape for every plugin call."""

    source: str
    api: str
    data: Any
    as_of: Optional[str] = None
    attribution: Optional[str] = None
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "api": self.api,
            "data": self.data,
            "as_of": self.as_of,
            "attribution": self.attribution,
            "warnings": self.warnings,
        }


@runtime_checkable
class DataSourcePlugin(Protocol):
    """Contract every data source adapter must satisfy."""

    name: str
    display_name: str
    domain: str  # "finance" | "macro" | "academic" | "enterprise" | "legal"
    requires_credential: bool

    def list_apis(self) -> List[ApiSpec]: ...

    async def call(self, api_name: str, params: Dict[str, Any]) -> DataSourceResult: ...
```

### 2.3 `errors.py`

```python
#!/usr/bin/env python3
"""Data source gateway error taxonomy.

Author: Damon Li
"""

from __future__ import annotations


class DataSourceError(Exception):
    """Base class for all data source gateway errors."""


class DataSourceNotFoundError(DataSourceError):
    """Raised when data_source_name does not match any enabled plugin."""


class DataSourceApiNotFoundError(DataSourceError):
    """Raised when api_name is not exposed by the resolved plugin."""


class MissingCredentialError(DataSourceError):
    """Raised when a plugin requires credentials that are not configured."""


class UpstreamTimeoutError(DataSourceError):
    """Raised when the upstream call exceeds the configured timeout."""


class InvalidParamsError(DataSourceError):
    """Raised when params fail plugin-side validation."""
```

### 2.4 `registry.py`（关键方法签名，执行者据此补全实现）

```python
#!/usr/bin/env python3
"""Registry that loads and routes data source plugins.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional

from agenticx.data_sources.base import DataSourcePlugin, DataSourceResult
from agenticx.data_sources.errors import (
    DataSourceApiNotFoundError,
    DataSourceError,
    DataSourceNotFoundError,
    UpstreamTimeoutError,
)

logger = logging.getLogger(__name__)

DEFAULT_CALL_TIMEOUT_SECONDS = 20.0


class DataSourceRegistry:
    """Loads enabled plugins from config and routes query_data_source calls."""

    def __init__(self, timeout_seconds: float = DEFAULT_CALL_TIMEOUT_SECONDS) -> None:
        self._plugins: Dict[str, DataSourcePlugin] = {}
        self._timeout_seconds = timeout_seconds

    def register(self, plugin: DataSourcePlugin) -> None:
        """Register a plugin instance, overwriting any prior registration with the same name."""
        self._plugins[plugin.name] = plugin

    def list_plugins(self) -> List[DataSourcePlugin]:
        return list(self._plugins.values())

    def get(self, name: str) -> Optional[DataSourcePlugin]:
        return self._plugins.get(name)

    async def call(self, data_source_name: str, api_name: str, params: dict) -> DataSourceResult:
        plugin = self._plugins.get(data_source_name)
        if plugin is None:
            available = ", ".join(sorted(self._plugins.keys())) or "(none enabled)"
            raise DataSourceNotFoundError(
                f"unknown data source '{data_source_name}'. Available: {available}"
            )
        api_names = {spec.name for spec in plugin.list_apis()}
        if api_name not in api_names:
            raise DataSourceApiNotFoundError(
                f"'{data_source_name}' has no api '{api_name}'. "
                f"Available: {', '.join(sorted(api_names))}"
            )
        try:
            return await asyncio.wait_for(
                plugin.call(api_name, params), timeout=self._timeout_seconds
            )
        except asyncio.TimeoutError as exc:
            raise UpstreamTimeoutError(
                f"'{data_source_name}.{api_name}' timed out after {self._timeout_seconds}s"
            ) from exc


def build_registry_from_config() -> DataSourceRegistry:
    """Load ~/.agenticx/config.yaml `data_sources:` section and instantiate enabled plugins.

    Must be entry-level fault tolerant: one plugin failing to construct (missing
    dependency, invalid credential shape) must not prevent other plugins from loading.
    Implementation note: import plugin modules lazily inside the per-entry try/except
    so a missing optional dependency (e.g. akshare not installed) only disables that
    one plugin instead of raising at import time.
    """
    raise NotImplementedError  # filled in during Sub-Plan A implementation
```

**`build_registry_from_config` 实现要点（供实施者展开）**：
1. 用 `ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)` 读取 `data_sources:` 节，形如：
   ```yaml
   data_sources:
     akshare:
       enabled: true
     world_bank:
       enabled: true
     tushare:
       enabled: false
       credentials:
         token: "..."
   ```
2. 遍历节点，`try/except Exception` 逐条加载对应插件模块（Sub-Plan B 提供 `agenticx.data_sources.plugins.<name>.build_plugin(config: dict) -> DataSourcePlugin`），失败仅 `logger.warning` 并 `continue`（与 `RegistryHub.search()` 对单源异常仅 warning 的既有先例一致）。
3. 未在 config 中出现的插件视为未启用，不加载（避免默认拉起需要网络/凭证的插件影响冷启动）。

### 2.5 原生工具接入 `agenticx/cli/agent_tools.py`

**Files:**
- Modify: `agenticx/cli/agent_tools.py`（`STUDIO_TOOLS` 列表追加两个工具定义；`dispatch_tool_async` 追加两个分支）

在 `STUDIO_TOOLS` 中新增（放在 `liteparse` 工具定义之后，`show_widget` 之前，保持「取数 → 渲染」的语义相邻）：

```python
{
    "type": "function",
    "function": {
        "name": "list_data_sources",
        "description": (
            "List enabled external data source plugins (finance/macro/academic/"
            "enterprise/legal domains) and their available APIs. Call this first "
            "when unsure which data_source_name or api_name to use with "
            "query_data_source."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "domain": {
                    "type": "string",
                    "description": "Optional filter, e.g. 'finance', 'macro', 'academic'.",
                },
                "verbose": {
                    "type": "boolean",
                    "description": "If true, include full params_schema for each API.",
                },
            },
            "additionalProperties": False,
        },
    },
},
{
    "type": "function",
    "function": {
        "name": "query_data_source",
        "description": (
            "Unified gateway to query an external data source plugin (stock prices, "
            "macro indicators, academic papers, company registry, legal statutes, etc). "
            "Call list_data_sources first if you don't know the exact api_name or "
            "params shape. Returns structured JSON; follow up with show_widget to "
            "visualize when appropriate (e.g. price history as a chart)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "data_source_name": {
                    "type": "string",
                    "description": "Plugin id, e.g. 'akshare', 'world_bank', 'tushare'.",
                },
                "api_name": {
                    "type": "string",
                    "description": "API id exposed by the plugin, from list_data_sources.",
                },
                "params": {
                    "type": "object",
                    "description": "API-specific parameters.",
                },
            },
            "required": ["data_source_name", "api_name", "params"],
            "additionalProperties": False,
        },
    },
},
```

`dispatch_tool_async` 追加分支（放在 `liteparse` 分支附近）：

```python
if name == "list_data_sources":
    return await _tool_list_data_sources(arguments)
if name == "query_data_source":
    return await _tool_query_data_source(arguments)
```

`_tool_query_data_source` / `_tool_list_data_sources` 实现（新增函数，放在 `_tool_show_widget` 附近）：

```python
_DATA_SOURCE_REGISTRY: Optional["DataSourceRegistry"] = None


def _get_data_source_registry() -> "DataSourceRegistry":
    global _DATA_SOURCE_REGISTRY
    if _DATA_SOURCE_REGISTRY is None:
        from agenticx.data_sources.registry import build_registry_from_config

        _DATA_SOURCE_REGISTRY = build_registry_from_config()
    return _DATA_SOURCE_REGISTRY


async def _tool_list_data_sources(arguments: Dict[str, Any]) -> str:
    from agenticx.data_sources.errors import DataSourceError

    registry = _get_data_source_registry()
    domain_filter = str(arguments.get("domain") or "").strip().lower()
    verbose = bool(arguments.get("verbose", False))
    items = []
    for plugin in registry.list_plugins():
        if domain_filter and plugin.domain.lower() != domain_filter:
            continue
        apis = plugin.list_apis()
        items.append({
            "name": plugin.name,
            "display_name": plugin.display_name,
            "domain": plugin.domain,
            "apis": [
                {"name": a.name, "description": a.description}
                if not verbose
                else {"name": a.name, "description": a.description, "params_schema": a.params_schema}
                for a in apis
            ],
        })
    return json.dumps({"data_sources": items}, ensure_ascii=False)


async def _tool_query_data_source(arguments: Dict[str, Any]) -> str:
    from agenticx.data_sources.errors import DataSourceError

    registry = _get_data_source_registry()
    data_source_name = str(arguments.get("data_source_name") or "").strip()
    api_name = str(arguments.get("api_name") or "").strip()
    params = arguments.get("params") or {}
    if not data_source_name or not api_name:
        return "ERROR: query_data_source requires data_source_name and api_name."
    try:
        result = await registry.call(data_source_name, api_name, params)
    except DataSourceError as exc:
        return f"ERROR: {exc}"
    except Exception as exc:  # noqa: BLE001 - surface upstream failure to the model
        logger.warning("query_data_source unexpected failure: %s", exc)
        return f"ERROR: query_data_source failed unexpectedly: {exc}"
    return json.dumps(result.to_dict(), ensure_ascii=False, default=str)
```

### 2.6 工具结果预算裁剪

**Files:**
- Modify: `agenticx/runtime/tool_result_budget.py`

在既有映射表（含 `"show_widget": "small"`）旁新增：

```python
"query_data_source": "medium",
"list_data_sources": "small",
```

并在 `agenticx/runtime/compactor.py` 补一条与 `show_widget` 并列的分支，确保时间序列类 `data` 字段裁剪时优先保留首尾若干条 + `warnings` 字段，而不是整体截断丢失 `attribution`。

### 2.7 `/api/tools/registry` 分类

**Files:**
- Modify: `agenticx/studio/server.py`（`_TOOL_CATEGORIES` 字典）

```python
"list_data_sources": "data_source", "query_data_source": "data_source",
```

## 3. 验收标准与用例

### 单元测试（新增 `tests/test_smoke_data_source_registry.py`）

```python
"""Smoke tests for the unified data source gateway core framework.

Author: Damon Li
"""

import asyncio

import pytest

from agenticx.data_sources.base import ApiSpec, DataSourcePlugin, DataSourceResult
from agenticx.data_sources.errors import DataSourceApiNotFoundError, DataSourceNotFoundError, UpstreamTimeoutError
from agenticx.data_sources.registry import DataSourceRegistry


class _FakePlugin:
    name = "fake"
    display_name = "Fake Source"
    domain = "finance"
    requires_credential = False

    def list_apis(self):
        return [ApiSpec(name="ping", description="returns pong")]

    async def call(self, api_name, params):
        if api_name == "slow":
            await asyncio.sleep(10)
        return DataSourceResult(source=self.name, api=api_name, data={"pong": True})


def test_unknown_data_source_returns_clear_error():
    registry = DataSourceRegistry()
    with pytest.raises(DataSourceNotFoundError):
        asyncio.run(registry.call("nope", "ping", {}))


def test_unknown_api_returns_clear_error():
    registry = DataSourceRegistry()
    registry.register(_FakePlugin())
    with pytest.raises(DataSourceApiNotFoundError):
        asyncio.run(registry.call("fake", "nope", {}))


def test_successful_call_roundtrips_result():
    registry = DataSourceRegistry()
    registry.register(_FakePlugin())
    result = asyncio.run(registry.call("fake", "ping", {}))
    assert result.data == {"pong": True}


def test_plugin_timeout_raises_upstream_timeout_error():
    registry = DataSourceRegistry(timeout_seconds=0.05)
    registry.register(_FakePlugin())
    with pytest.raises(UpstreamTimeoutError):
        asyncio.run(registry.call("fake", "slow", {}))
```

### 用例（人工验收，走 Desktop 对话）

| 用例 | 步骤 | 预期 |
|---|---|---|
| UC-1 | 未启用任何数据源时问「帮我查一下股票数据」 | Agent 调 `list_data_sources` 返回空列表，回答引导用户去设置页开启 |
| UC-2 | 调用一个拼错名字的 `data_source_name` | 收到 `ERROR: unknown data source ...` 且列出可用项，而非工具调用崩溃/静默失败 |
| UC-3 | 模拟上游超时（fake plugin 注入延迟） | 20s 后返回明确超时错误，Agent Loop 未被挂起 |

## 4. 风险与资源排期

| 风险 | 影响 | 缓解 |
|---|---|---|
| `CredentialStore` 是否已存在等价实现未经确认就重复实现 | 增加维护面、与既有凭证体系不一致 | 实施第一步必须先 `Grep "CredentialStore"` 全仓库确认，若已有则复用并只加 `data_sources` 命名空间 |
| `config.yaml` 直改被安全策略拦截（现有工具对 `file_write`/`file_edit` 改 config.yaml 有硬拦截） | 插件启停/凭证配置若走错路径会被拒绝 | 复用 `ConfigManager` 专用写入方法或新增 `/api/data-sources/config` 端点（详见 Sub-Plan C），不新增直改 YAML 的旁路 |
| 工具结果体积过大污染上下文 | 长时间序列或宏观多国数据一次性塞进 tool_result | 落实 2.6 节裁剪策略，Sub-Plan B 的适配器需自行限制默认返回条数（如日线默认最近 120 个交易日） |
| 异步插件 `call()` 中出现同步阻塞 I/O（如某些 SDK 无异步接口） | 阻塞事件循环影响并发会话 | 要求插件作者在 `call()` 内用 `asyncio.to_thread()` 包装同步 SDK 调用，本条写入 Sub-Plan B 的插件开发规范 |

**预估工作量**：1.5 人天（core framework + 单测 + `/api/tools/registry` 接线）。
**前置条件**：无（可立即开始）。
**产出物**：`agenticx/data_sources/{base,registry,errors,credential_store}.py`、`agenticx/data_sources/plugins/__init__.py`（空目录占位）、`STUDIO_TOOLS` 两个新工具、`tests/test_smoke_data_source_registry.py`。
