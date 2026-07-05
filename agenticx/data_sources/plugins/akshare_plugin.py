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
                    "days": {
                        "type": "integer",
                        "description": (
                            f"最近 N 个交易日，默认 {DEFAULT_HISTORY_DAYS}，"
                            f"上限 {MAX_HISTORY_DAYS}"
                        ),
                    },
                },
                example_params={"symbol": "603678", "market": "a", "days": 30},
            ),
            ApiSpec(
                name="stock_realtime_quote",
                description="A股实时快照（最新价/涨跌幅/成交量）。",
                params_schema={"symbol": {"type": "string"}},
                example_params={"symbol": "603678"},
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
            try:
                import akshare as ak  # optional dependency
            except ImportError as exc:
                raise ImportError(
                    "akshare 未安装。请运行 `pip install 'agenticx[data-sources]'` 或 `pip install akshare`。"
                ) from exc

            if market == "a":
                df = ak.stock_zh_a_hist(symbol=symbol, period="daily", adjust="qfq")
            elif market == "hk":
                df = ak.stock_hk_hist(symbol=symbol, period="daily", adjust="qfq")
            else:
                df = ak.stock_us_hist(symbol=symbol, period="daily", adjust="qfq")
            df = df.tail(days)
            return df.to_dict(orient="records")

        rows = await asyncio.to_thread(_fetch)
        as_of = None
        if rows:
            as_of = str(rows[-1].get("日期") or rows[-1].get("date") or "")
        return DataSourceResult(
            source=self.name,
            api="stock_price_history",
            data=rows,
            as_of=as_of or None,
            attribution="数据来源：AkShare（新浪财经/东方财富，非实时，可能有 15 分钟延迟）",
        )

    async def _quote(self, params: Dict[str, Any]) -> DataSourceResult:
        symbol = str(params.get("symbol") or "").strip()
        if not symbol:
            raise InvalidParamsError("stock_realtime_quote requires 'symbol'")

        def _fetch() -> dict:
            try:
                import akshare as ak
            except ImportError as exc:
                raise ImportError(
                    "akshare 未安装。请运行 `pip install 'agenticx[data-sources]'` 或 `pip install akshare`。"
                ) from exc

            df = ak.stock_zh_a_spot_em()
            row = df[df["代码"] == symbol]
            if row.empty:
                return {}
            return row.to_dict(orient="records")[0]

        row = await asyncio.to_thread(_fetch)
        return DataSourceResult(
            source=self.name,
            api="stock_realtime_quote",
            data=row,
            attribution="数据来源：AkShare（东方财富，近实时）",
        )


def build_plugin(config: dict) -> AkSharePlugin:
    return AkSharePlugin()
