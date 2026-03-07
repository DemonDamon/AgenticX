#!/usr/bin/env python3
"""Pre-execution input validation for tool arguments.

Scans LLM-generated tool arguments against security rules before execution.
Catches shell injection, path traversal, SSRF, SQL injection, command
substitution, and system file references.  Supports per-tool custom policies
and recursive dict/list flattening.

Author: Damon Li
"""

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional, Sequence

logger = logging.getLogger(__name__)


class InputRiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class InputViolation:
    rule_id: str
    description: str
    risk_level: InputRiskLevel
    is_blocking: bool
    matched_value: str
    param_path: str


@dataclass
class InputValidationResult:
    violations: list["InputViolation"] = field(default_factory=list)

    @property
    def is_blocked(self) -> bool:
        return any(v.is_blocking for v in self.violations)


@dataclass
class ToolInputPolicy:
    tool_name: str
    risk_level: InputRiskLevel
    blocked_patterns: list[str] = field(default_factory=list)


_RuleTuple = tuple[str, str, str, InputRiskLevel, bool]

DEFAULT_RULES: list[_RuleTuple] = [
    (
        "shell_injection",
        "Shell command injection via chained dangerous commands",
        r";\s*(?:rm\s+-rf|curl\s+.*\|\s*(?:sh|bash)|wget\s+.*\|\s*(?:sh|bash)|chmod\s+777)",
        InputRiskLevel.CRITICAL,
        True,
    ),
    (
        "path_traversal",
        "Path traversal via repeated ../ sequences",
        r"(?:\.\./){2,}",
        InputRiskLevel.CRITICAL,
        True,
    ),
    (
        "system_file_ref",
        "Reference to sensitive system files",
        r"(?:/etc/passwd|/etc/shadow|\.ssh/id_rsa|\.aws/credentials|\.gnupg/)",
        InputRiskLevel.CRITICAL,
        True,
    ),
    (
        "command_substitution",
        "Shell command substitution via $() or backticks",
        r"\$\(.*\)|`.*`",
        InputRiskLevel.HIGH,
        True,
    ),
    (
        "sql_injection",
        "Potential SQL injection pattern",
        r"(?i)(?:;\s*DROP\s+TABLE|;\s*DELETE\s+FROM|UNION\s+SELECT|'\s*OR\s+1\s*=\s*1)",
        InputRiskLevel.MEDIUM,
        False,
    ),
    (
        "ssrf_private_ip",
        "SSRF via private/loopback IP address",
        r"(?:https?://)?(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)",
        InputRiskLevel.HIGH,
        True,
    ),
]

_MAX_MATCHED_VALUE_LEN = 100


class InputValidator:
    """Scan tool arguments against security rules before execution."""

    def __init__(
        self,
        extra_rules: Optional[Sequence[_RuleTuple]] = None,
        tool_policies: Optional[Sequence[ToolInputPolicy]] = None,
    ):
        self._rules: list[tuple[str, str, "re.Pattern[str]", InputRiskLevel, bool]] = []
        for rule_id, desc, pattern, level, blocking in DEFAULT_RULES:
            self._rules.append((rule_id, desc, re.compile(pattern), level, blocking))

        if extra_rules:
            for rule_id, desc, pattern, level, blocking in extra_rules:
                self._rules.append((rule_id, desc, re.compile(pattern), level, blocking))

        self._tool_policies: dict[str, ToolInputPolicy] = {}
        if tool_policies:
            for policy in tool_policies:
                self._tool_policies[policy.tool_name] = policy

    def validate(self, tool_name: str, args: dict[str, Any]) -> InputValidationResult:
        """Validate tool arguments against all rules and tool-specific policies."""
        violations: list[InputViolation] = []
        flat = self._flatten_args(args)

        for param_path, value in flat:
            for rule_id, desc, pattern, level, blocking in self._rules:
                if pattern.search(value):
                    violations.append(InputViolation(
                        rule_id=rule_id,
                        description=desc,
                        risk_level=level,
                        is_blocking=blocking,
                        matched_value=value[:_MAX_MATCHED_VALUE_LEN],
                        param_path=param_path,
                    ))

        policy = self._tool_policies.get(tool_name)
        if policy:
            for idx, pat_str in enumerate(policy.blocked_patterns):
                compiled = re.compile(pat_str)
                for param_path, value in flat:
                    if compiled.search(value):
                        violations.append(InputViolation(
                            rule_id=f"policy:{tool_name}:{idx}",
                            description=f"Tool-specific policy pattern #{idx} for {tool_name}",
                            risk_level=policy.risk_level,
                            is_blocking=True,
                            matched_value=value[:_MAX_MATCHED_VALUE_LEN],
                            param_path=param_path,
                        ))

        if violations:
            blocked_ids = [v.rule_id for v in violations if v.is_blocking]
            warn_ids = [v.rule_id for v in violations if not v.is_blocking]
            if blocked_ids:
                logger.warning(
                    "Input validation BLOCKED tool %s: %s", tool_name, blocked_ids,
                )
            if warn_ids:
                logger.info(
                    "Input validation warnings for tool %s: %s", tool_name, warn_ids,
                )

        return InputValidationResult(violations=violations)

    @staticmethod
    def _flatten_args(
        args: Any, prefix: str = "",
    ) -> list[tuple[str, str]]:
        """Recursively flatten dict/list/tuple args into (path, string_value) pairs."""
        pairs: list[tuple[str, str]] = []
        if isinstance(args, dict):
            for key, val in args.items():
                path = f"{prefix}.{key}" if prefix else key
                pairs.extend(InputValidator._flatten_args(val, path))
        elif isinstance(args, (list, tuple)):
            for idx, val in enumerate(args):
                path = f"{prefix}[{idx}]"
                pairs.extend(InputValidator._flatten_args(val, path))
        elif isinstance(args, str):
            pairs.append((prefix, args))
        return pairs
