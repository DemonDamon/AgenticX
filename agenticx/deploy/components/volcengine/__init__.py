#!/usr/bin/env python3
"""
AgenticX VolcEngine Deploy Components

Provides deployment adapters for Volcengine AgentKit platform.

Author: Damon Li
"""

from typing import Dict, Type, Optional
import logging

logger = logging.getLogger(__name__)

# Component mapping
_COMPONENTS: Dict[str, Type] = {}


def get_component(name: str) -> Optional[Type]:
    """Get component class by name."""
    return _COMPONENTS.get(name)


def list_components():
    """List all available components."""
    return list(_COMPONENTS.keys())


# Auto-import available components
try:
    from .component import VolcEngineComponent
    _COMPONENTS["volcengine"] = VolcEngineComponent
    logger.debug("VolcEngine component registered")
except ImportError as e:
    logger.debug(f"VolcEngine component not available: {e}")


__all__ = [
    "get_component",
    "list_components",
]
