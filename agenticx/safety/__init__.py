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
from agenticx.safety.sanitizer import (
    Sanitizer,
    SanitizedOutput,
    InjectionWarning,
    InjectionSeverity,
)
from agenticx.safety.policy import (
    Policy,
    PolicyRule,
    PolicyAction,
    PolicySeverity,
    PolicyCheckResult,
)
from agenticx.safety.input_validator import (
    InputValidator,
    InputValidationResult,
    InputViolation,
    InputRiskLevel,
    ToolInputPolicy,
)
from agenticx.safety.audit import SafetyAuditLog, SafetyEvent, SafetyStage
from agenticx.safety.layer import SafetyLayer, SafetyConfig

__all__ = [
    "LeakDetector",
    "LeakAction",
    "LeakSeverity",
    "LeakPattern",
    "LeakMatch",
    "LeakScanResult",
    "SecretLeakError",
    "Sanitizer",
    "SanitizedOutput",
    "InjectionWarning",
    "InjectionSeverity",
    "Policy",
    "PolicyRule",
    "PolicyAction",
    "PolicySeverity",
    "PolicyCheckResult",
    "InputValidator",
    "InputValidationResult",
    "InputViolation",
    "InputRiskLevel",
    "ToolInputPolicy",
    "SafetyAuditLog",
    "SafetyEvent",
    "SafetyStage",
    "SafetyLayer",
    "SafetyConfig",
]
