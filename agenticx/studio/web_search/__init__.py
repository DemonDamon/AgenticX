#!/usr/bin/env python3
"""Machi built-in web search (Studio).

Author: Damon Li
"""

from agenticx.studio.web_search.routes import register_web_search_routes
from agenticx.studio.web_search.service import WebSearchService

__all__ = [
    "WebSearchService",
    "register_web_search_routes",
]
