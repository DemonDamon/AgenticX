# Sub-Plan B：首批数据源适配器（akshare / world_bank / imf / tushare 桥接 / ifind 接入位）

Planned-with: Claude Sonnet 5
Plan-Id: 2026-07-05-data-source-adapters-wave1
Plan-File: .cursor/plans/2026-07-05-data-source-adapters-wave1.plan.md
父规划: `.cursor/plans/2026-07-05-unified-data-source-gateway.plan.md`
前置依赖: Sub-Plan A（`agenticx/data_sources/base.py` + `registry.py` 必须先落地）

## 1. 需求

### FR

- **FR-1**：实现 `akshare` 插件（A股/港股/美股行情，免费、无需 API Key，Python 库 `akshare`），提供至少两个 API：`stock_price_history`（历史日线）、`stock_realtime_quote`（实时快照）。此为**主力冒烟数据源**，因为免登录、免费、可立即演示，直接对应用户截图里「三股供应链与走势」场景。
- **FR-2**：实现 `world_bank` 插件（免费 REST，无 Key），提供 `indicator_by_country`（如 GDP/人口/通胀）。
- **FR-3**：实现 `imf` 插件（IMF 公开数据 REST，免费），提供 `macro_indicator`。若 IMF 官方 API 稳定性/文档在实施时勘验不通过，允许降级为仅实现 `world_bank`，并在验收报告中说明降级原因（不得为了交付而伪造数据）。
- **FR-4**：`tushare` 插件采用**桥接模式**而非直连 SDK：复用仓库已支持的 Remote URL MCP（`~/.agenticx/mcp.json` 的 `tushareMcp`），插件内部通过 `mcp_call` 转发，对 Agent 呈现的仍是统一的 `query_data_source(data_source_name="tushare", ...)` 接口，但底层是「原生插件 → 已连接的 MCP client → Tushare MCP」。此设计验证「统一网关可以吃 MCP 后端」这一架构灵活性。
- **FR-5**：`ifind`（同花顺 iFinD）只做**接入位 stub**：`agenticx/data_sources/plugins/ifind.py` 定义插件骨架、`list_apis()` 返回真实 iFinD API 目录（对齐 Kimi 回答里列出的 8 个 API 名称，作为文档价值），但 `call()` 直接返回 `MissingCredentialError`，附带清晰提示「需企业 iFinD 账号，请联系管理员配置」。不实现真实 SDK 调用（无授权无法测试，避免交付不可验证的假实现）。
- **FR-6**：所有插件默认返回条数/时间跨度设上限（如日线默认最近 120 个交易日，超出需用户显式传 `limit` 参数放宽），防止单次响应过大。

### NFR

- **NFR-1**：`akshare`、`world_bank` 两个插件必须**零凭证可用**（免费源），作为「开箱即用」的默认演示能力，不依赖用户先去设置页配置任何东西。
- **NFR-2**：`akshare` 依赖为可选依赖（`pyproject.toml` 的 extras，如 `agenticx[data-sources]`），未安装时插件在 `build_registry_from_config` 阶段被跳过并给出安装提示日志，不影响核心框架其他部分。
- **NFR-3**：所有网络 I/O 使用 `httpx.AsyncClient`（仓库已依赖 `httpx`），或对同步 SDK（`akshare` 底层是同步 `requests`）用 `asyncio.to_thread()` 包装，遵守 Sub-Plan A 的插件开发规范。
- **NFR-4**：每个插件的 `call()` 返回的 `attribution` 字段必须真实标注数据来源（如「数据来源：AkShare（新浪财经/东方财富）」），不得省略，供前端渲染和用户信任判断。

### AC

- **AC-1**：`query_data_source(data_source_name="akshare", api_name="stock_price_history", params={"symbol": "603678", "days": 120})` 在联网环境下返回近 120 个交易日的 OHLCV 数据，`attribution` 非空。
- **AC-2**：`world_bank` 查询「中国 GDP 近 5 年」返回带年份索引的数值序列。
- **AC-3**：`tushare` 插件在对应 Remote MCP 未连接时返回 `MissingCredentialError`-等价的清晰提示（「请先在 MCP 设置中连接 tushareMcp」），而不是抛出底层 `mcp_call` 异常堆栈。
- **AC-4**：`ifind` 插件的 `list_apis()` 返回 8 条 API 摘要（供 Agent 感知能力边界），`call()` 任意调用都返回 `MissingCredentialError`。
- **AC-5**：卸载 `akshare` 依赖包后重启 registry，其余插件（`world_bank`/`ifind` stub）仍能正常加载与调用。

## 2. 技术方案

### 2.1 插件文件与构造函数约定

**Files:**
- Create: `agenticx/data_sources/plugins/akshare_plugin.py`
- Create: `agenticx/data_sources/plugins/world_bank_plugin.py`
- Create: `agenticx/data_sources/plugins/imf_plugin.py`（若 FR-3 未降级）
- Create: `agenticx/data_sources/plugins/tushare_plugin.py`
- Create: `agenticx/data_sources/plugins/ifind_plugin.py`
- Modify: `agenticx/data_sources/registry.py`（`build_registry_from_config` 补全插件加载分发表）

每个插件模块导出：

```python
def build_plugin(config: dict) -> "DataSourcePlugin":
    """Construct the plugin instance from its config.yaml sub-section.

    Must raise a clear exception (caught by the registry, not swallowed here)
    when required dependencies or credentials are missing, so the registry can
    log a specific reason instead of a generic import failure.
    """
```

`registry.py` 的加载分发表（放在 `build_registry_from_config` 内）：

```python
_PLUGIN_BUILDERS = {
    "akshare": "agenticx.data_sources.plugins.akshare_plugin",
    "world_bank": "agenticx.data_sources.plugins.world_bank_plugin",
    "imf": "agenticx.data_sources.plugins.imf_plugin",
    "tushare": "agenticx.data_sources.plugins.tushare_plugin",
    "ifind": "agenticx.data_sources.plugins.ifind_plugin",
}
```

### 2.2 `akshare_plugin.py`（核心示例，其余插件同构）

```python
#!/usr/bin/env python3
"""AkShare-backed data source plugin: free A-share/HK/US equity data.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from agenticx.data_sources.base import ApiSpec, DataSourceResult
from agenticx.data_sources.errors import InvalidParamsError

DEFAULT_HISTORY_DAYS = 120
MAX_HISTORY_DAYS = 1000


class AkSharePlugin:
    name = "akshare"
    display_name = "AkShare（免费行情）"
    domain = "finance"
    requires_credential = False

    def list_apis(self) -> List[ApiSpec]:
        return [
            ApiSpec(
                name="stock_price_history",
                description="A股/港股/美股历史日线（OHLCV）。",
                params_schema={
                    "symbol": {"type": "string", "description": "股票代码，如 603678 或 00700"},
                    "market": {"type": "string", "description": "'a'|'hk'|'us'，默认 'a'"},
                    "days": {"type": "integer", "description": f"最近 N 个交易日，默认 {DEFAULT_HISTORY_DAYS}，上限 {MAX_HISTORY_DAYS}"},
                },
                example_params={"symbol": "603678", "market": "a", "days": 120},
            ),
            ApiSpec(
                name="stock_realtime_quote",
                description="A股实时快照（最新价/涨跌幅/成交量）。",
                params_schema={"symbol": {"type": "string"}},
            ),
        ]

    async def call(self, api_name: str, params: Dict[str, Any]) -> DataSourceResult:
        if api_name == "stock_price_history":
            return await self._history(params)
        if api_name == "stock_realtime_quote":
            return await self._quote(params)
        raise InvalidParamsError(f"akshare has no api '{api_name}'")

    async def _history(self, params: Dict[str, Any]) -> DataSourceResult:
        symbol = str(params.get("symbol") or "").strip()
        if not symbol:
            raise InvalidParamsError("stock_price_history requires 'symbol'")
        days = min(int(params.get("days", DEFAULT_HISTORY_DAYS)), MAX_HISTORY_DAYS)
        market = str(params.get("market", "a")).lower()

        def _fetch() -> list[dict]:
            import akshare as ak  # local import: optional dependency

            if market == "a":
                df = ak.stock_zh_a_hist(symbol=symbol, period="daily", adjust="qfq")
            elif market == "hk":
                df = ak.stock_hk_hist(symbol=symbol, period="daily", adjust="qfq")
            else:
                df = ak.stock_us_hist(symbol=symbol, period="daily", adjust="qfq")
            df = df.tail(days)
            return df.to_dict(orient="records")

        rows = await asyncio.to_thread(_fetch)
        return DataSourceResult(
            source=self.name,
            api="stock_price_history",
            data=rows,
            as_of=rows[-1].get("日期") if rows else None,
            attribution="数据来源：AkShare（新浪财经/东方财富，非实时，可能有 15 分钟延迟）",
        )

    async def _quote(self, params: Dict[str, Any]) -> DataSourceResult:
        symbol = str(params.get("symbol") or "").strip()
        if not symbol:
            raise InvalidParamsError("stock_realtime_quote requires 'symbol'")

        def _fetch() -> dict:
            import akshare as ak

            df = ak.stock_zh_a_spot_em()
            row = df[df["代码"] == symbol]
            return row.to_dict(orient="records")[0] if not row.empty else {}

        row = await asyncio.to_thread(_fetch)
        return DataSourceResult(
            source=self.name,
            api="stock_realtime_quote",
            data=row,
            attribution="数据来源：AkShare（东方财富，近实时）",
        )


def build_plugin(config: dict) -> AkSharePlugin:
    return AkSharePlugin()
```

### 2.3 `tushare_plugin.py`（MCP 桥接模式，展示架构灵活性）

```python
#!/usr/bin/env python3
"""Tushare data source plugin, bridged through the already-connected Tushare MCP.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List

from agenticx.data_sources.base import ApiSpec, DataSourceResult
from agenticx.data_sources.errors import MissingCredentialError


class TusharePlugin:
    name = "tushare"
    display_name = "Tushare Pro（经 MCP 桥接）"
    domain = "finance"
    requires_credential = True

    def __init__(self, mcp_hub: Any, server_name: str = "tushareMcp") -> None:
        self._mcp_hub = mcp_hub
        self._server_name = server_name

    def list_apis(self) -> List[ApiSpec]:
        return [
            ApiSpec(name="daily", description="A股日线行情（Tushare daily 接口）。"),
            ApiSpec(name="income", description="上市公司利润表。"),
        ]

    async def call(self, api_name: str, params: Dict[str, Any]) -> DataSourceResult:
        if self._mcp_hub is None or not await self._is_connected():
            raise MissingCredentialError(
                "tushare 数据源需先在 Desktop 设置 → MCP 中连接 'tushareMcp'（配置 Tushare token）。"
            )
        raw = await self._mcp_hub.call_tool(f"{self._server_name}:{api_name}", params)
        return DataSourceResult(
            source=self.name,
            api=api_name,
            data=raw,
            attribution="数据来源：Tushare Pro（经 MCP 桥接）",
        )

    async def _is_connected(self) -> bool:
        try:
            tools = await self._mcp_hub.list_tools()
        except Exception:
            return False
        return any(self._server_name in t.get("name", "") for t in tools)


def build_plugin(config: dict) -> TusharePlugin:
    from agenticx.cli.studio_mcp import get_session_mcp_hub  # exact accessor to confirm at implementation time

    return TusharePlugin(mcp_hub=get_session_mcp_hub())
```

> **实施者注意**：`get_session_mcp_hub` 是占位调用，需在实施时先确认 `agenticx/cli/studio_mcp.py` 或 `StudioSession` 上实际获取当前会话 `MCPHub` 实例的正确方法名（Sub-Plan A 未绑定 session 上下文，`build_registry_from_config()` 目前是无 session 参数的全局单例；若 MCP 访问必须绑定 session，需要把 `_get_data_source_registry()` 改为按 `session` 懒建或传入 hub 引用——这是本子规划实施时必须先探明并在 PR 描述里记录的架构决策点，不能想当然实现）。

### 2.4 `ifind_plugin.py`（接入位 stub）

```python
#!/usr/bin/env python3
"""iFinD (Tonghuashun) plugin stub: documents the API surface, requires enterprise credentials.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List

from agenticx.data_sources.base import ApiSpec, DataSourceResult
from agenticx.data_sources.errors import MissingCredentialError

_IFIND_APIS = [
    ("ifind_get_price", "历史行情数据"),
    ("ifind_get_stock_info", "股票基本信息"),
    ("ifind_get_financial_statements", "财务报表（三大表）"),
    ("ifind_get_stock_financial_index", "财务指标（六大类）"),
    ("ifind_get_stock_business_segmentation", "业务分板块收入"),
    ("ifind_get_forecast", "盈利预测"),
    ("ifind_get_holder_info", "股东信息"),
    ("ifind_get_stock_announcement", "公司公告"),
]


class IFindPlugin:
    name = "ifind"
    display_name = "同花顺 iFinD（需企业授权）"
    domain = "finance"
    requires_credential = True

    def list_apis(self) -> List[ApiSpec]:
        return [ApiSpec(name=n, description=d) for n, d in _IFIND_APIS]

    async def call(self, api_name: str, params: Dict[str, Any]) -> DataSourceResult:
        raise MissingCredentialError(
            "ifind 数据源需要企业同花顺 iFinD 账号与 SDK 授权，当前未配置。"
            "请联系管理员在 Desktop 设置 → 数据源 中填写 iFinD 凭证后重新连接。"
        )


def build_plugin(config: dict) -> IFindPlugin:
    return IFindPlugin()
```

### 2.5 依赖管理

**Files:**
- Modify: `pyproject.toml`

```toml
[project.optional-dependencies]
data-sources = ["akshare>=1.14"]
```

`build_registry_from_config` 加载 `akshare` 插件时若 `ImportError`，捕获后记录：

```
logger.warning("data source 'akshare' disabled: akshare not installed. Run `pip install agenticx[data-sources]`.")
```

## 3. 验收标准与用例

### 冒烟测试（新增 `tests/test_smoke_data_source_plugins_wave1.py`）

```python
"""Smoke tests for wave-1 data source plugins.

Author: Damon Li
"""

import asyncio

import pytest

from agenticx.data_sources.errors import MissingCredentialError


def test_ifind_stub_lists_apis_but_call_requires_credential():
    from agenticx.data_sources.plugins.ifind_plugin import IFindPlugin

    plugin = IFindPlugin()
    apis = plugin.list_apis()
    assert len(apis) == 8
    with pytest.raises(MissingCredentialError):
        asyncio.run(plugin.call("ifind_get_price", {}))


def test_akshare_plugin_missing_dependency_is_handled_gracefully(monkeypatch):
    """If akshare isn't installed, calling should surface a clear ImportError-derived message,
    not an unhandled traceback."""
    from agenticx.data_sources.plugins.akshare_plugin import AkSharePlugin

    plugin = AkSharePlugin()
    # This test only asserts list_apis works without the dependency installed.
    apis = plugin.list_apis()
    assert any(a.name == "stock_price_history" for a in apis)


@pytest.mark.skipif_no_network  # implementer: wire to existing network-gated marker convention
def test_akshare_history_returns_recent_rows():
    from agenticx.data_sources.plugins.akshare_plugin import AkSharePlugin

    plugin = AkSharePlugin()
    result = asyncio.run(plugin.call("stock_price_history", {"symbol": "603678", "days": 30}))
    assert len(result.data) <= 30
    assert result.attribution
```

> 实施时确认仓库现有「跳过需联网测试」的 pytest marker 惯例（搜索 `pytest.mark.skip` / `network` 相关标记），沿用既有约定而不是新造一个。

### 人工用例

| 用例 | 步骤 | 预期 |
|---|---|---|
| UC-1 | 全新环境 `pip install agenticx[data-sources]` 后启动 `agx serve`，问「火炬电子最近走势」 | 无需任何配置即拿到近 120 日行情 |
| UC-2 | 未装 `akshare` 时启动，问同样问题 | Agent 通过 `list_data_sources` 得知 `akshare` 未启用，改用 `world_bank` 等其他源或提示用户安装 |
| UC-3 | 未连接 `tushareMcp` 时强制指定 `data_source_name="tushare"` | 返回引导去 MCP 设置连接的清晰提示 |

## 4. 风险与资源排期

| 风险 | 影响 | 缓解 |
|---|---|---|
| `akshare` 上游（新浪/东方财富）接口无 SLA，可能随时变更字段 | 冒烟测试偶发失败 | 用 `days` 参数限定小窗口降低抓取成本；网络测试标记为可跳过，不阻塞 CI 主干 |
| Tushare MCP 桥接的 session/hub 绑定方式未定 | 可能导致插件拿不到当前会话的 MCP 连接 | 2.3 节已标注为「必须先探明的架构决策点」，实施第一步应先用 `Grep` 定位 `StudioSession` 对 `MCPHub` 的持有方式 |
| IMF 官方 API 可用性/字段稳定性未经验证 | FR-3 可能延期或降级 | 明确允许降级为仅 `world_bank`，验收时如实说明 |
| `akshare` 依赖体积/安装耗时较大（含 pandas 等） | 影响默认安装体验 | 定义为 optional extras，非默认安装 |

**预估工作量**：2 人天（akshare 1 天 + world_bank/imf 0.5 天 + tushare 桥接 0.3 天 + ifind stub 0.2 天）。
**前置条件**：Sub-Plan A 完成。
**产出物**：5 个插件文件 + `pyproject.toml` extras + `tests/test_smoke_data_source_plugins_wave1.py`。
