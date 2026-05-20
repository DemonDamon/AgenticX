"""Multi-brain knowledge subsystem."""

from .manager import BrainManager
from .mount import resolve_mounted_brain_ids
from .registry import BrainRegistry
from .search import search_code_brains, search_docs_brains
from .types import Brain, BrainScope, BrainType

__all__ = [
    "Brain",
    "BrainManager",
    "BrainRegistry",
    "BrainScope",
    "BrainType",
    "resolve_mounted_brain_ids",
    "search_code_brains",
    "search_docs_brains",
]
