#!/usr/bin/env python3
"""Data source gateway error taxonomy.

Author: Damon Li
"""

from __future__ import annotations


class DataSourceError(Exception):
    """Base class for all data source gateway errors."""


class DataSourceNotFoundError(DataSourceError):
    """Raised when data_source_name does not match any enabled plugin."""


class DataSourceApiNotFoundError(DataSourceError):
    """Raised when api_name is not exposed by the resolved plugin."""


class MissingCredentialError(DataSourceError):
    """Raised when a plugin requires credentials that are not configured."""


class UpstreamTimeoutError(DataSourceError):
    """Raised when the upstream call exceeds the configured timeout."""


class InvalidParamsError(DataSourceError):
    """Raised when params fail plugin-side validation."""
