#!/usr/bin/env python3
"""Near Desktop delivery loop — POC/MVP orchestration from customer materials.

Author: Damon Li
"""

from agenticx.delivery.config import get_delivery_config
from agenticx.delivery.orchestrator import DeliveryOrchestrator

__all__ = ["DeliveryOrchestrator", "get_delivery_config"]
