#!/usr/bin/env python3
"""Advanced injection detection with Unicode normalization and entropy analysis.

Level 2 detection: strips zero-width characters, detects Unicode confusables
(Cyrillic lookalikes), flags high-entropy segments that may indicate encoded payloads.

Author: Damon Li
"""

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional


# Zero-width characters commonly used to evade detection
_ZERO_WIDTH_CHARS = frozenset("\u200b\u200c\u200d\u200e\u200f\ufeff\u00ad\u2060\u180e")

# Common Cyrillic→Latin confusables (Cyrillic char → Latin equivalent)
_CONFUSABLE_MAP: dict[str, str] = {
    "\u0430": "a",  # а → a
    "\u0435": "e",  # е → e
    "\u0456": "i",  # і → i
    "\u043e": "o",  # о → o
    "\u0440": "p",  # р → p
    "\u0441": "c",  # с → c
    "\u0443": "y",  # у → y
    "\u0445": "x",  # х → x
    "\u042c": "b",  # Ь → b (uppercase soft sign looks like b)
    "\u0410": "A",  # А → A
    "\u0412": "B",  # В → B
    "\u0415": "E",  # Е → E
    "\u041a": "K",  # К → K
    "\u041c": "M",  # М → M
    "\u041d": "H",  # Н → H
    "\u041e": "O",  # О → O
    "\u0420": "P",  # Р → P
    "\u0421": "C",  # С → C
    "\u0422": "T",  # Т → T
    "\u0425": "X",  # Х → X
}


@dataclass
class AdvancedDetectionResult:
    risk_score: float = 0.0
    has_zero_width_chars: bool = False
    has_confusables: bool = False
    has_high_entropy_segments: bool = False
    zero_width_count: int = 0
    confusable_count: int = 0
    max_entropy: float = 0.0
    details: list[str] = field(default_factory=list)


class AdvancedInjectionDetector:
    """Detects adversarial injection evasion techniques."""

    def __init__(
        self,
        entropy_threshold: float = 4.5,
        entropy_window: int = 64,
    ):
        self._entropy_threshold = entropy_threshold
        self._entropy_window = entropy_window

    def analyze(self, content: str) -> AdvancedDetectionResult:
        """Analyze content for adversarial injection patterns."""
        result = AdvancedDetectionResult()

        # Check zero-width characters
        zw_count = sum(1 for c in content if c in _ZERO_WIDTH_CHARS)
        if zw_count > 0:
            result.has_zero_width_chars = True
            result.zero_width_count = zw_count
            result.risk_score += min(0.4, zw_count * 0.1)
            result.details.append(f"Found {zw_count} zero-width characters")

        # Check confusables
        conf_count = sum(1 for c in content if c in _CONFUSABLE_MAP)
        if conf_count > 0:
            result.has_confusables = True
            result.confusable_count = conf_count
            result.risk_score += min(0.4, conf_count * 0.05)
            result.details.append(f"Found {conf_count} Unicode confusable characters")

        # Check entropy
        max_ent = self._max_window_entropy(content)
        result.max_entropy = max_ent
        if max_ent > self._entropy_threshold:
            result.has_high_entropy_segments = True
            result.risk_score += min(0.3, (max_ent - self._entropy_threshold) * 0.15)
            result.details.append(f"High entropy segment: {max_ent:.2f} bits/char")

        result.risk_score = min(1.0, result.risk_score)
        return result

    def normalize(self, content: str) -> str:
        """Normalize content by stripping zero-width chars and replacing confusables."""
        result = []
        for c in content:
            if c in _ZERO_WIDTH_CHARS:
                continue
            result.append(_CONFUSABLE_MAP.get(c, c))
        return "".join(result)

    def _max_window_entropy(self, text: str) -> float:
        """Compute max Shannon entropy over sliding windows."""
        if len(text) < self._entropy_window:
            return self._shannon_entropy(text)
        max_ent = 0.0
        for i in range(0, len(text) - self._entropy_window + 1, self._entropy_window // 2):
            window = text[i : i + self._entropy_window]
            ent = self._shannon_entropy(window)
            if ent > max_ent:
                max_ent = ent
        return max_ent

    @staticmethod
    def _shannon_entropy(text: str) -> float:
        """Compute Shannon entropy of a string in bits per character."""
        if not text:
            return 0.0
        freq = Counter(text)
        length = len(text)
        entropy = 0.0
        for count in freq.values():
            p = count / length
            if p > 0:
                entropy -= p * math.log2(p)
        return entropy
