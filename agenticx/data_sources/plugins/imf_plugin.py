#!/usr/bin/env python3
"""IMF DataMapper REST plugin.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List

import httpx

from agenticx.data_sources.base import ApiSpec, DataSourceResult
from agenticx.data_sources.errors import InvalidParamsError

DEFAULT_COUNTRY = "CHN"
DEFAULT_INDICATOR = "NGDP_RPCH"
MAX_POINTS = 50


class ImfPlugin:
    name = "imf"
    display_name = "IMF DataMapper（宏观指标）"
    domain = "macro"
    requires_credential = False

    def list_apis(self) -> List[ApiSpec]:
        return [
            ApiSpec(
                name="macro_indicator",
                description="IMF DataMapper 宏观指标（按国家/指标）。",
                params_schema={
                    "country": {"type": "string", "description": "ISO3 国家码，默认 CHN"},
                    "indicator": {
                        "type": "string",
                        "description": "指标 ID，默认 NGDP_RPCH（实际 GDP 增速）",
                    },
                },
                example_params={"country": "CHN", "indicator": "NGDP_RPCH"},
            ),
        ]

    async def call(self, api_name: str, params: Dict[str, Any]) -> DataSourceResult:
        if api_name != "macro_indicator":
            raise InvalidParamsError(f"imf has no api '{api_name}'")
        return await self._macro_indicator(params)

    async def _macro_indicator(self, params: Dict[str, Any]) -> DataSourceResult:
        country = str(params.get("country") or DEFAULT_COUNTRY).strip().upper()
        indicator = str(params.get("indicator") or DEFAULT_INDICATOR).strip()
        url = f"https://www.imf.org/external/datamapper/api/v1/{indicator}/{country}"
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            payload = response.json()

        values_map = (
            payload.get("values", {}).get(indicator, {}).get(country, {})
            if isinstance(payload, dict)
            else {}
        )
        series = [
            {"year": year, "value": value}
            for year, value in sorted(values_map.items(), key=lambda item: item[0])
            if value is not None
        ][-MAX_POINTS:]
        as_of = str(series[-1]["year"]) if series else None
        return DataSourceResult(
            source=self.name,
            api="macro_indicator",
            data={
                "country": country,
                "indicator": indicator,
                "series": series,
            },
            as_of=as_of,
            attribution="数据来源：IMF DataMapper API（https://www.imf.org/external/datamapper）",
        )


def build_plugin(config: dict) -> ImfPlugin:
    return ImfPlugin()
