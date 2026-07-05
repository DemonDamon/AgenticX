#!/usr/bin/env python3
"""AkShare-backed data source plugin: free A-share/HK/US equity data.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

from agenticx.data_sources.base import ApiSpec, DataSourceResult
from agenticx.data_sources.errors import InvalidParamsError

logger = logging.getLogger("agenticx.data_sources.akshare")

# Default candlestick window: ~3 months of trading days. Fewer bars (e.g. a
# literal "最近一周" reading) render as a sparse, hard-to-read chart in the
# chat widget; see agenticx-query-data-source SKILL.md for the full rationale.
DEFAULT_HISTORY_DAYS = 60
MAX_HISTORY_DAYS = 1000


def _sina_symbol(symbol: str, market: str) -> str:
    """Normalize a bare A-share code to the sina `sh/sz/bj`-prefixed form.

    The sina-backed ``stock_zh_a_daily`` API needs an exchange prefix; already
    prefixed inputs are returned unchanged.
    """
    s = symbol.strip().lower()
    if s.startswith(("sh", "sz", "bj")):
        return s
    if market == "a":
        if s.startswith("6"):
            return f"sh{s}"
        if s.startswith(("0", "3")):
            return f"sz{s}"
        if s.startswith(("4", "8", "9")):
            return f"bj{s}"
    return s


def _readnum(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _trim_ohlcv_rows(rows: list[dict]) -> list[dict]:
    """Keep only chart-essential OHLCV fields, normalized to English keys.

    Dropping amount/outstanding_share/turnover shrinks each row ~2.5x so a full
    60–120 day window survives the tool-result budget intact (avoiding the
    truncate → re-query loop) and de-noises the payload the model must reason over.
    Handles both sina (`stock_zh_a_daily`, English keys) and eastmoney
    (`stock_zh_a_hist`, Chinese keys) column names.
    """
    trimmed: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        date = str(row.get("date") or row.get("日期") or "").strip()
        if not date:
            continue
        entry = {
            "date": date,
            "open": _readnum(row.get("open", row.get("开盘"))),
            "high": _readnum(row.get("high", row.get("最高"))),
            "low": _readnum(row.get("low", row.get("最低"))),
            "close": _readnum(row.get("close", row.get("收盘"))),
        }
        volume = _readnum(row.get("volume", row.get("成交量")))
        if volume is not None:
            entry["volume"] = volume
        trimmed.append(entry)
    return trimmed


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
                # sina (`stock_zh_a_daily`) is more reliable behind proxied /
                # fake-ip networks than eastmoney (`stock_zh_a_hist`), which is
                # often reset. Prefer sina, fall back to eastmoney.
                try:
                    df = ak.stock_zh_a_daily(
                        symbol=_sina_symbol(symbol, market), adjust="qfq"
                    )
                except Exception as exc:  # noqa: BLE001 — try the alternate host
                    logger.warning(
                        "akshare sina daily failed (%s); falling back to eastmoney",
                        exc,
                    )
                    df = ak.stock_zh_a_hist(symbol=symbol, period="daily", adjust="qfq")
            elif market == "hk":
                df = ak.stock_hk_hist(symbol=symbol, period="daily", adjust="qfq")
            else:
                df = ak.stock_us_hist(symbol=symbol, period="daily", adjust="qfq")
            df = df.tail(days)
            return _trim_ohlcv_rows(df.to_dict(orient="records"))

        rows = await asyncio.to_thread(_fetch)
        as_of = None
        if rows:
            as_of = str(rows[-1].get("date") or "")
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
