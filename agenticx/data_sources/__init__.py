#!/usr/bin/env python3
"""Unified external data source gateway for AgenticX Studio tools.

Author: Damon Li
"""

from agenticx.data_sources.base import ApiSpec, DataSourcePlugin, DataSourceResult
from agenticx.data_sources.errors import (
    DataSourceApiNotFoundError,
    DataSourceError,
    DataSourceNotFoundError,
    InvalidParamsError,
    MissingCredentialError,
    UpstreamTimeoutError,
)
from agenticx.data_sources.registry import DataSourceRegistry, build_registry_from_config

__all__ = [
    "ApiSpec",
    "DataSourceApiNotFoundError",
    "DataSourceError",
    "DataSourceNotFoundError",
    "DataSourcePlugin",
    "DataSourceRegistry",
    "DataSourceResult",
    "InvalidParamsError",
    "MissingCredentialError",
    "UpstreamTimeoutError",
    "build_registry_from_config",
]
