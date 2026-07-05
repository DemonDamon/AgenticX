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
        return [ApiSpec(name=name, description=desc) for name, desc in _IFIND_APIS]

    async def call(self, api_name: str, params: Dict[str, Any]) -> DataSourceResult:
        raise MissingCredentialError(
            "ifind 数据源需要企业同花顺 iFinD 账号与 SDK 授权，当前未配置。"
            "请联系管理员在 Desktop 设置 → 数据源 中填写 iFinD 凭证后重新连接。"
        )


def build_plugin(config: dict) -> IFindPlugin:
    return IFindPlugin()
