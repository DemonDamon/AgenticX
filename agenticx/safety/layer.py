#!/usr/bin/env python3
"""Unified safety pipeline — defense-in-depth facade.

Orchestrates LeakDetector, Sanitizer, and Policy in a fixed order:
  1. Length truncation
  2. Leak detection and redaction
  3. Policy check
  4. Injection detection and sanitization

Internalized from IronClaw src/safety/mod.rs SafetyLayer.

Author: Damon Li
"""

import logging
import re
from dataclasses import dataclass
from typing import Optional

from agenticx.safety.leak_detector import LeakDetector
from agenticx.safety.sanitizer import Sanitizer, InjectionSeverity
from agenticx.safety.policy import Policy, PolicyAction

logger = logging.getLogger(__name__)

# Patterns that indicate prompt injection attempts
_INJECTION_PATTERNS = [
    re.compile(r"(?i)ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)"),
    re.compile(r"(?i)disregard\s+(?:all\s+)?(?:previous|prior|above|your)\s+(?:instructions|prompts|rules)"),
    re.compile(r"(?i)forget\s+(?:all\s+)?(?:previous|prior|above|your)\s+(?:instructions|training)"),
]


@dataclass
class SafetyConfig:
    max_output_length: int = 50_000
    injection_check_enabled: bool = True
    leak_detection_enabled: bool = True
    policy_check_enabled: bool = True


class SafetyLayer:
    """Unified security pipeline for tool output sanitization.

    Applies defense-in-depth: truncation -> leak detection -> policy -> injection.
    Each stage can be independently enabled/disabled via SafetyConfig.
    """

    def __init__(
        self,
        config: Optional[SafetyConfig] = None,
        leak_detector: Optional[LeakDetector] = None,
        sanitizer: Optional[Sanitizer] = None,
        policy: Optional[Policy] = None,
    ):
        self.config = config or SafetyConfig()
        self._leak_detector = leak_detector or LeakDetector()
        self._sanitizer = sanitizer or Sanitizer()
        self._policy = policy or Policy()

    def sanitize_tool_output(self, output: str, tool_name: str) -> str:
        """Run the full safety pipeline on tool output."""
        content = output

        # Stage 1: truncation — notice is short to keep total <= max_output_length + 14
        if len(content) > self.config.max_output_length:
            content = content[: self.config.max_output_length]
            content += "...[truncated]"
            logger.info("Tool %s output truncated to %d chars", tool_name, self.config.max_output_length)

        # Stage 2: leak detection and redaction
        if self.config.leak_detection_enabled:
            scan_result = self._leak_detector.scan(content)
            if scan_result.has_matches:
                logger.warning(
                    "Leak detected in %s output: %s",
                    tool_name,
                    ", ".join(m.pattern_name for m in scan_result.matches),
                )
                if scan_result.redacted_content is not None:
                    content = scan_result.redacted_content

        # Stage 3: policy check
        if self.config.policy_check_enabled:
            policy_result = self._policy.check(content)
            if policy_result.is_blocked:
                blocked_ids = [r.id for r in policy_result.matched_rules if r.action == PolicyAction.BLOCK]
                logger.warning("Policy blocked %s output: %s", tool_name, blocked_ids)
                content = f"[BLOCKED by policy: {', '.join(blocked_ids)}] Tool output suppressed."

        # Stage 4: injection detection and sanitization
        if self.config.injection_check_enabled:
            sanitized = self._sanitizer.sanitize(content)
            if sanitized.was_modified:
                logger.warning(
                    "Injection sanitized in %s output: %d warnings",
                    tool_name,
                    len(sanitized.warnings),
                )
                content = sanitized.content
            elif sanitized.warnings:
                # Sanitizer detected injection patterns but did not escape the text itself.
                # Apply additional escaping for high-severity injection phrases.
                has_critical = any(
                    w.severity == InjectionSeverity.CRITICAL for w in sanitized.warnings
                )
                if has_critical:
                    content = self._escape_injection_phrases(content)
                    logger.warning(
                        "Injection phrases escaped in %s output: %d warnings",
                        tool_name,
                        len(sanitized.warnings),
                    )

        return content

    @staticmethod
    def _escape_injection_phrases(content: str) -> str:
        """Escape known injection phrases by wrapping matches in [ESCAPED:...] markers."""
        result = content
        for pattern in _INJECTION_PATTERNS:
            result = pattern.sub(lambda m: f"[ESCAPED:{m.group(0)}]", result)
        return result

    def wrap_for_llm(self, content: str, source: str) -> str:
        """Wrap tool output with XML tags for LLM context isolation."""
        return self._sanitizer.wrap_for_llm(content, source=source)

    def wrap_external_content(self, content: str) -> str:
        """Wrap external content with UNTRUSTED safety notice."""
        return self._sanitizer.wrap_external_content(content)
