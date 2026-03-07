#!/usr/bin/env python3
"""Risk-based sandbox backend recommendation.

Recommends sandbox isolation level (docker/subprocess/none) based on
tool risk level. Supports per-tool risk profiles and name-based inference.

Author: Damon Li
"""

import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class RiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class SandboxRecommendation:
    backend: Optional[str]  # "docker", "subprocess", or None
    network_enabled: bool = True
    max_timeout: int = 300
    memory_mb: int = 2048


@dataclass
class ToolRiskProfile:
    tool_name: str
    risk_level: RiskLevel = RiskLevel.MEDIUM
    force_backend: Optional[str] = None
    network_enabled: bool = True
    max_timeout: int = 300


_HIGH_RISK_KEYWORDS = re.compile(
    r"(?i)(?:shell|bash|exec|terminal|command|curl|wget|http_request)"
)
_MEDIUM_RISK_KEYWORDS = re.compile(
    r"(?i)(?:file|read|write|upload|download|path)"
)


class SandboxPolicy:
    """Recommends sandbox backend based on tool risk level."""

    def __init__(
        self,
        tool_profiles: Optional[list[ToolRiskProfile]] = None,
    ):
        self._profiles: dict[str, ToolRiskProfile] = {}
        if tool_profiles:
            for tp in tool_profiles:
                self._profiles[tp.tool_name] = tp

    def recommend(
        self,
        tool_name: str,
        risk_level: Optional[RiskLevel] = None,
    ) -> SandboxRecommendation:
        """Get sandbox recommendation for a tool."""
        profile = self._profiles.get(tool_name)
        if profile:
            level = risk_level or profile.risk_level
            backend = profile.force_backend or self._backend_for_level(level)
            return SandboxRecommendation(
                backend=backend,
                network_enabled=profile.network_enabled,
                max_timeout=profile.max_timeout,
            )

        if risk_level is None:
            risk_level = self._infer_risk(tool_name)

        return SandboxRecommendation(
            backend=self._backend_for_level(risk_level),
            network_enabled=(risk_level not in (RiskLevel.HIGH, RiskLevel.CRITICAL)),
            max_timeout=self._timeout_for_level(risk_level),
        )

    @staticmethod
    def _backend_for_level(level: RiskLevel) -> Optional[str]:
        if level in (RiskLevel.CRITICAL, RiskLevel.HIGH):
            return "docker"
        elif level == RiskLevel.MEDIUM:
            return "subprocess"
        return None

    @staticmethod
    def _timeout_for_level(level: RiskLevel) -> int:
        if level == RiskLevel.CRITICAL:
            return 60
        elif level == RiskLevel.HIGH:
            return 120
        elif level == RiskLevel.MEDIUM:
            return 300
        return 600

    @staticmethod
    def _infer_risk(tool_name: str) -> RiskLevel:
        if _HIGH_RISK_KEYWORDS.search(tool_name):
            return RiskLevel.HIGH
        if _MEDIUM_RISK_KEYWORDS.search(tool_name):
            return RiskLevel.MEDIUM
        return RiskLevel.LOW
