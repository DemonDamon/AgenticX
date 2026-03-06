#!/usr/bin/env python3
"""Secret leak detection engine with dual-engine matching.

Uses prefix-based pre-filtering (optionally Aho-Corasick) followed by
regex validation. Covers 17 common secret patterns including API keys,
private keys, bearer tokens, and cloud credentials.

Internalized from IronClaw src/safety/leak_detector.rs.

Author: Damon Li
"""

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class LeakAction(Enum):
    BLOCK = "block"
    REDACT = "redact"
    WARN = "warn"


class LeakSeverity(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class LeakPattern:
    name: str
    pattern: str
    severity: LeakSeverity
    action: LeakAction
    _compiled: Optional[re.Pattern] = field(default=None, repr=False, compare=False)

    @property
    def regex(self) -> re.Pattern:
        if self._compiled is None:
            self._compiled = re.compile(self.pattern)
        return self._compiled


@dataclass
class LeakMatch:
    pattern_name: str
    severity: LeakSeverity
    action: LeakAction
    start: int
    end: int
    masked_preview: str


@dataclass
class LeakScanResult:
    matches: list[LeakMatch] = field(default_factory=list)
    redacted_content: Optional[str] = None

    @property
    def has_matches(self) -> bool:
        return len(self.matches) > 0

    @property
    def should_block(self) -> bool:
        return any(m.action == LeakAction.BLOCK for m in self.matches)


class SecretLeakError(Exception):
    """Raised when a secret leak is detected with BLOCK action."""

    def __init__(self, matches: list[LeakMatch]):
        self.matches = matches
        names = ", ".join(m.pattern_name for m in matches)
        super().__init__(f"Secret leak detected and blocked: {names}")


_DEFAULT_PATTERNS: list[LeakPattern] = [
    LeakPattern("openai_api_key", r"sk-(?:proj-)?[A-Za-z0-9]{20,}", LeakSeverity.CRITICAL, LeakAction.BLOCK),
    LeakPattern("anthropic_api_key", r"sk-ant-api\d{2}-[A-Za-z0-9\-]{20,}", LeakSeverity.CRITICAL, LeakAction.BLOCK),
    LeakPattern("aws_access_key", r"AKIA[0-9A-Z]{16}", LeakSeverity.CRITICAL, LeakAction.BLOCK),
    LeakPattern("github_token", r"gh[ps]_[A-Za-z0-9]{36,}", LeakSeverity.CRITICAL, LeakAction.BLOCK),
    LeakPattern("github_fine_grained", r"github_pat_[A-Za-z0-9_]{22,}", LeakSeverity.CRITICAL, LeakAction.BLOCK),
    LeakPattern("stripe_key", r"sk_(?:live|test)_[A-Za-z0-9]{24,}", LeakSeverity.CRITICAL, LeakAction.BLOCK),
    LeakPattern("slack_token", r"xox[baprs]-[A-Za-z0-9\-]{10,}", LeakSeverity.HIGH, LeakAction.BLOCK),
    LeakPattern("slack_webhook", r"https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+", LeakSeverity.HIGH, LeakAction.BLOCK),
    LeakPattern("private_key_pem", r"-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----", LeakSeverity.CRITICAL, LeakAction.BLOCK),
    LeakPattern("ssh_private_key", r"-----BEGIN\s+(?:OPENSSH|EC|DSA)\s+PRIVATE\s+KEY-----", LeakSeverity.CRITICAL, LeakAction.BLOCK),
    LeakPattern("gcp_service_account", r'"type"\s*:\s*"service_account"', LeakSeverity.HIGH, LeakAction.BLOCK),
    LeakPattern("azure_connection_string", r"DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{20,}", LeakSeverity.CRITICAL, LeakAction.BLOCK),
    LeakPattern("bearer_token", r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", LeakSeverity.MEDIUM, LeakAction.REDACT),
    LeakPattern("authorization_basic", r"Basic\s+[A-Za-z0-9+/]+=*", LeakSeverity.MEDIUM, LeakAction.REDACT),
    LeakPattern("generic_api_key_param", r'(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*["\']?[A-Za-z0-9\-._]{20,}', LeakSeverity.MEDIUM, LeakAction.WARN),
    LeakPattern("password_param", r'(?:password|passwd|pwd)\s*[=:]\s*["\']?[^\s"\']{8,}', LeakSeverity.MEDIUM, LeakAction.WARN),
    LeakPattern("high_entropy_hex", r"\b[0-9a-f]{40,}\b", LeakSeverity.LOW, LeakAction.WARN),
]


class LeakDetector:
    """Secret leak detection engine.

    Scans text content for known secret patterns and returns matches
    with severity levels and recommended actions.

    Optionally uses pyahocorasick for prefix-based pre-filtering
    to reduce regex overhead on large inputs.
    """

    def __init__(
        self,
        patterns: Optional[list[LeakPattern]] = None,
        extra_patterns: Optional[list[LeakPattern]] = None,
    ):
        self._patterns: list[LeakPattern] = list(patterns or _DEFAULT_PATTERNS)
        if extra_patterns:
            self._patterns.extend(extra_patterns)

        self._automaton = None
        self._prefix_map: dict[str, list[int]] = {}
        self._build_prefix_index()

    def _build_prefix_index(self) -> None:
        """Build a prefix lookup for fast candidate filtering."""
        prefixes: dict[str, list[int]] = {}
        for i, p in enumerate(self._patterns):
            literal = _extract_literal_prefix(p.pattern)
            if literal and len(literal) >= 3:
                prefixes.setdefault(literal.lower(), []).append(i)
        self._prefix_map = prefixes

        try:
            import ahocorasick  # type: ignore[import-untyped]
            auto = ahocorasick.Automaton()
            for prefix, indices in prefixes.items():
                auto.add_word(prefix, (prefix, indices))
            auto.make_automaton()
            self._automaton = auto
        except ImportError:
            self._automaton = None

    def scan(self, content: str) -> LeakScanResult:
        """Scan content for secret leaks."""
        if not content:
            return LeakScanResult()

        candidates = self._get_candidates(content)
        matches: list[LeakMatch] = []

        for idx in candidates:
            pattern = self._patterns[idx]
            for m in pattern.regex.finditer(content):
                matched_text = m.group()
                preview = matched_text[:4] + "..." + matched_text[-4:] if len(matched_text) > 12 else "***"
                matches.append(LeakMatch(
                    pattern_name=pattern.name,
                    severity=pattern.severity,
                    action=pattern.action,
                    start=m.start(),
                    end=m.end(),
                    masked_preview=preview,
                ))

        matches.sort(key=lambda x: x.start)
        redacted = self._build_redacted(content, matches) if matches else None
        return LeakScanResult(matches=matches, redacted_content=redacted)

    def scan_and_clean(self, content: str) -> str:
        """Scan and return cleaned content with all secrets redacted.

        Unlike scan_and_block, this method never raises; it always
        returns a sanitized string with matched secrets replaced.
        """
        result = self.scan(content)
        return result.redacted_content if result.redacted_content else content

    def scan_and_block(self, content: str) -> str:
        """Scan and raise SecretLeakError on any match with BLOCK action."""
        result = self.scan(content)
        block_matches = [m for m in result.matches if m.action == LeakAction.BLOCK]
        if block_matches:
            raise SecretLeakError(block_matches)
        return result.redacted_content if result.redacted_content else content

    def _get_candidates(self, content: str) -> set[int]:
        """Get candidate pattern indices using prefix pre-filtering."""
        if self._automaton is not None:
            candidates: set[int] = set()
            content_lower = content.lower()
            for _, (_, indices) in self._automaton.iter(content_lower):
                candidates.update(indices)
            no_prefix = {i for i in range(len(self._patterns))
                         if not any(i in idxs for idxs in self._prefix_map.values())}
            candidates.update(no_prefix)
            return candidates

        return set(range(len(self._patterns)))

    def _build_redacted(self, content: str, matches: list[LeakMatch]) -> str:
        """Build redacted content by replacing matched regions."""
        if not matches:
            return content
        regions = [(m.start, m.end, m.pattern_name, m.action) for m in matches]
        regions.sort(key=lambda x: x[0])

        merged: list[tuple[int, int, str, LeakAction]] = []
        for region in regions:
            if merged and region[0] <= merged[-1][1]:
                prev = merged[-1]
                merged[-1] = (prev[0], max(prev[1], region[1]), prev[2], prev[3])
            else:
                merged.append(region)

        parts: list[str] = []
        last_end = 0
        for start, end, name, action in merged:
            parts.append(content[last_end:start])
            if action in (LeakAction.BLOCK, LeakAction.REDACT):
                parts.append(f"[REDACTED:{name}]")
            else:
                parts.append(content[start:end])
            last_end = end
        parts.append(content[last_end:])
        return "".join(parts)


def _extract_literal_prefix(pattern: str) -> Optional[str]:
    """Extract a literal prefix from a regex pattern for pre-filtering."""
    prefix_chars: list[str] = []
    i = 0
    while i < len(pattern):
        c = pattern[i]
        if c == "\\":
            if i + 1 < len(pattern) and pattern[i + 1] in r"\.^$*+?{}[]|()":
                prefix_chars.append(pattern[i + 1])
                i += 2
                continue
            break
        if c in r".^$*+?{}[]|()":
            break
        prefix_chars.append(c)
        i += 1
    result = "".join(prefix_chars)
    return result if len(result) >= 3 else None
