"""Code semantic index subsystem (Semble-backed by default)."""

from agenticx.code_index.config import is_enabled, load_code_index_config
from agenticx.code_index.manager import CodeIndexManager
from agenticx.code_index.tools import (
    dispatch_code_find_related,
    dispatch_code_index_cancel,
    dispatch_code_index_clear,
    dispatch_code_index_create,
    dispatch_code_index_status,
    dispatch_code_search,
)

__all__ = [
    "CodeIndexManager",
    "dispatch_code_search",
    "dispatch_code_index_create",
    "dispatch_code_index_status",
    "dispatch_code_index_clear",
    "dispatch_code_index_cancel",
    "dispatch_code_find_related",
    "is_enabled",
    "load_code_index_config",
]
