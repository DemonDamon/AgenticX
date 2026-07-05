#!/usr/bin/env python3
"""World Bank open-data REST plugin.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

import httpx

from agenticx.data_sources.base import ApiSpec, DataSourceResult
from agenticx.data_sources.errors import InvalidParamsError

DEFAULT_COUNTRY = "CHN"
DEFAULT_INDICATOR = "NY.GDP.MKTP.KD.ZG"
DEFAULT_YEARS = 5
MAX_YEARS = 50


class WorldBankPlugin:
    name = "world_bank"
    display_name = "World Bank（宏观指标）"
    domain = "macro"
    requires_credential = False

    def list_apis(self) -> List[ApiSpec]:
        return [
            ApiSpec(
                name="indicator_by_country",
                description="按国家查询 World Bank 宏观指标时间序列。",
                params_schema={
                    "country": {"type": "string", "description": "ISO3 国家码，默认 CHN"},
                    "indicator": {
                        "type": "string",
                        "description": "指标 ID，默认 NY.GDP.MKTP.KD.ZG（GDP 增速）",
                    },
                    "years": {
                        "type": "integer",
                        "description": f"最近 N 年，默认 {DEFAULT_YEARS}，上限 {MAX_YEARS}",
                    },
                },
                example_params={
                    "country": "CHN",
                    "indicator": "NY.GDP.MKTP.KD.ZG",
                    "years": 5,
                },
            ),
        ]

    async def call(self, api_name: str, params: Dict[str, Any]) -> DataSourceResult:
        if api_name != "indicator_by_country":
            raise InvalidParamsError(f"world_bank has no api '{api_name}'")
        return await self._indicator_by_country(params)

    async def _indicator_by_country(self, params: Dict[str, Any]) -> DataSourceResult:
        country = str(params.get("country") or DEFAULT_COUNTRY).strip().upper()
        indicator = str(params.get("indicator") or DEFAULT_INDICATOR).strip()
        years = min(int(params.get("years", DEFAULT_YEARS)), MAX_YEARS)
        end_year = datetime.utcnow().year
        start_year = end_year - years + 1
        url = f"https://api.worldbank.org/v2/country/{country}/indicator/{indicator}"
        query = {
            "format": "json",
            "per_page": years + 5,
            "date": f"{start_year}:{end_year}",
        }
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, params=query)
            response.raise_for_status()
            payload = response.json()

        rows_raw = payload[1] if isinstance(payload, list) and len(payload) > 1 else []
        series = [
            {"year": row.get("date"), "value": row.get("value")}
            for row in rows_raw
            if isinstance(row, dict) and row.get("value") is not None
        ]
        series.sort(key=lambda item: str(item.get("year") or ""))
        as_of = str(series[-1]["year"]) if series else None
        return DataSourceResult(
            source=self.name,
            api="indicator_by_country",
            data={
                "country": country,
                "indicator": indicator,
                "series": series,
            },
            as_of=as_of,
            attribution="数据来源：World Bank Open Data API（https://data.worldbank.org）",
        )


def build_plugin(config: dict) -> WorldBankPlugin:
    return WorldBankPlugin()
