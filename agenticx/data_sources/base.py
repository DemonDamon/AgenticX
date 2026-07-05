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
    domain: str
    requires_credential: bool

    def list_apis(self) -> List[ApiSpec]: ...

    async def call(self, api_name: str, params: Dict[str, Any]) -> DataSourceResult: ...
