#!/usr/bin/env python3
"""IM platform adapters for the remote command gateway.

Author: Damon Li
"""

from agenticx.gateway.adapters.base import IMAdapter
from agenticx.gateway.adapters.dingtalk import DingTalkAdapter
from agenticx.gateway.adapters.feishu import FeishuAdapter
from agenticx.gateway.adapters.wecom import WeComAdapter

__all__ = [
    "IMAdapter",
    "FeishuAdapter",
    "WeComAdapter",
    "DingTalkAdapter",
]
