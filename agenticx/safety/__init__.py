#!/usr/bin/env python3
"""AgenticX Safety Module — defense-in-depth security pipeline.

Internalized from IronClaw (nearai/ironclaw) security architecture.
Provides LeakDetector, Sanitizer, Policy, and unified SafetyLayer.

Author: Damon Li
"""

from agenticx.safety.leak_detector import (
    LeakDetector,
    LeakAction,
    LeakSeverity,
    LeakPattern,
    LeakMatch,
    LeakScanResult,
    SecretLeakError,
)

__all__ = [
    "LeakDetector",
    "LeakAction",
    "LeakSeverity",
    "LeakPattern",
    "LeakMatch",
    "LeakScanResult",
    "SecretLeakError",
]
