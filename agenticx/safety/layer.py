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
from dataclasses import dataclass
from typing import Optional

from agenticx.safety.input_validator import InputValidator, InputValidationResult
from agenticx.safety.leak_detector import LeakDetector
from agenticx.safety.sanitizer import Sanitizer
from agenticx.safety.policy import Policy, PolicyAction

logger = logging.getLogger(__name__)


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
        input_validator: Optional[InputValidator] = None,
    ):
        self.config = config or SafetyConfig()
        self._leak_detector = leak_detector or LeakDetector()
        self._sanitizer = sanitizer or Sanitizer()
        self._policy = policy or Policy()
        self._input_validator = input_validator or InputValidator()

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

        return content

    def validate_tool_input(self, tool_name: str, args: dict) -> InputValidationResult:
        """Pre-execution validation of tool arguments."""
        return self._input_validator.validate(tool_name, args)

    def wrap_for_llm(self, content: str, source: str) -> str:
        """Wrap tool output with XML tags for LLM context isolation."""
        return self._sanitizer.wrap_for_llm(content, source=source)

    def wrap_external_content(self, content: str) -> str:
        """Wrap external content with UNTRUSTED safety notice."""
        return self._sanitizer.wrap_external_content(content)
