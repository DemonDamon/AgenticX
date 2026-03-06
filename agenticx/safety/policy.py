#!/usr/bin/env python3
"""Rule-based security policy engine.

Checks content against configurable rules with Block/Warn/Review/Sanitize actions.
Default rules cover system file access, private keys, and shell injection.

Internalized from IronClaw src/safety/policy.rs.

Author: Damon Li
"""

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class PolicyAction(Enum):
    WARN = "warn"
    BLOCK = "block"
    REVIEW = "review"
    SANITIZE = "sanitize"


class PolicySeverity(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class PolicyRule:
    id: str
    description: str
    severity: PolicySeverity
    pattern: str
    action: PolicyAction
    _compiled: Optional[re.Pattern] = field(default=None, repr=False, compare=False, init=False)

    @property
    def regex(self) -> re.Pattern:
        if self._compiled is None:
            self._compiled = re.compile(self.pattern)
        return self._compiled


@dataclass
class PolicyCheckResult:
    matched_rules: list[PolicyRule] = field(default_factory=list)

    @property
    def is_blocked(self) -> bool:
        return any(r.action == PolicyAction.BLOCK for r in self.matched_rules)


_DEFAULT_RULES: list[PolicyRule] = [
    PolicyRule("system_file_access", "Block access to system files",
               PolicySeverity.CRITICAL, r"(?:/etc/passwd|\.ssh/|\.aws/credentials|\.gnupg/)",
               PolicyAction.BLOCK),
    PolicyRule("crypto_private_key", "Block private key content",
               PolicySeverity.CRITICAL, r"-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----",
               PolicyAction.BLOCK),
    PolicyRule("shell_injection", "Block shell injection patterns",
               PolicySeverity.CRITICAL, r";\s*(?:rm\s+-rf|curl\s+.*\|\s*(?:sh|bash)|wget\s+.*\|\s*(?:sh|bash))",
               PolicyAction.BLOCK),
    PolicyRule("sql_pattern", "Warn on SQL injection patterns",
               PolicySeverity.MEDIUM, r"(?i)(?:;\s*DROP\s+TABLE|;\s*DELETE\s+FROM|UNION\s+SELECT|OR\s+1\s*=\s*1)",
               PolicyAction.WARN),
    PolicyRule("excessive_urls", "Warn on excessive URL count",
               PolicySeverity.LOW, r"(?:https?://[^\s]+\s*){10,}",
               PolicyAction.WARN),
    PolicyRule("encoded_exploit", "Sanitize encoded exploit payloads",
               PolicySeverity.MEDIUM, r"(?:base64_decode|eval\s*\(\s*base64)",
               PolicyAction.SANITIZE),
]


class Policy:
    """Rule-based security policy engine."""

    def __init__(
        self,
        rules: Optional[list[PolicyRule]] = None,
        extra_rules: Optional[list[PolicyRule]] = None,
    ):
        self._rules = list(rules or _DEFAULT_RULES)
        if extra_rules:
            self._rules.extend(extra_rules)

    def check(self, content: Optional[str]) -> PolicyCheckResult:
        """Check content against all policy rules."""
        if not content:
            return PolicyCheckResult()
        matched: list[PolicyRule] = []
        for rule in self._rules:
            if rule.regex.search(content):
                matched.append(rule)
                logger.debug("Policy rule matched: %s (%s)", rule.id, rule.action.value)
        return PolicyCheckResult(matched_rules=matched)
