#!/usr/bin/env python3
"""Project state schema (FeatureListV1 / StatusV1).

Author: Damon Li
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

SCHEMA_VERSION = 1

PHASE_INITIALIZE = "initialize"
PHASE_IMPLEMENT = "implement"
PHASE_VERIFY = "verify"
PHASE_COMMIT = "commit"
VALID_PHASES = frozenset({PHASE_INITIALIZE, PHASE_IMPLEMENT, PHASE_VERIFY, PHASE_COMMIT})

FEATURE_PENDING = "pending"
FEATURE_IN_PROGRESS = "in_progress"
FEATURE_VERIFIED = "verified"
FEATURE_COMMITTED = "committed"
FEATURE_SKIPPED = "skipped"
FEATURE_STATUSES = frozenset(
    {
        FEATURE_PENDING,
        FEATURE_IN_PROGRESS,
        FEATURE_VERIFIED,
        FEATURE_COMMITTED,
        FEATURE_SKIPPED,
    }
)

# Allowed forward transitions. Every other transition is rejected.
_ALLOWED_TRANSITIONS = {
    FEATURE_PENDING: {FEATURE_IN_PROGRESS, FEATURE_SKIPPED},
    FEATURE_IN_PROGRESS: {FEATURE_VERIFIED, FEATURE_PENDING, FEATURE_SKIPPED},
    FEATURE_VERIFIED: {FEATURE_COMMITTED},
    FEATURE_COMMITTED: set(),
    FEATURE_SKIPPED: {FEATURE_PENDING},
}


def is_valid_transition(old: str, new: str) -> bool:
    """Return True if moving from ``old`` to ``new`` is allowed."""
    if old == new:
        return True
    allowed = _ALLOWED_TRANSITIONS.get(old, set())
    return new in allowed


@dataclass
class Feature:
    """One deliverable in the feature list."""

    id: str
    title: str
    description: str = ""
    acceptance_criteria: List[str] = field(default_factory=list)
    depends_on: List[str] = field(default_factory=list)
    priority: int = 100
    status: str = FEATURE_PENDING
    evidence: Dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "Feature":
        if not isinstance(raw, dict):
            raise ValueError(f"feature payload must be dict, got {type(raw).__name__}")
        fid = str(raw.get("id", "")).strip()
        title = str(raw.get("title", "")).strip()
        if not fid or not title:
            raise ValueError("feature requires non-empty id and title")
        status = str(raw.get("status", FEATURE_PENDING)).strip().lower() or FEATURE_PENDING
        if status not in FEATURE_STATUSES:
            raise ValueError(f"invalid feature status: {status}")
        criteria_raw = raw.get("acceptance_criteria") or []
        if not isinstance(criteria_raw, list):
            raise ValueError("acceptance_criteria must be a list of strings")
        depends_raw = raw.get("depends_on") or []
        if not isinstance(depends_raw, list):
            raise ValueError("depends_on must be a list of feature ids")
        evidence_raw = raw.get("evidence") or {}
        if not isinstance(evidence_raw, dict):
            raise ValueError("evidence must be a dict")
        return cls(
            id=fid,
            title=title,
            description=str(raw.get("description", "") or ""),
            acceptance_criteria=[str(x) for x in criteria_raw],
            depends_on=[str(x) for x in depends_raw],
            priority=int(raw.get("priority", 100) or 100),
            status=status,
            evidence=dict(evidence_raw),
            created_at=float(raw.get("created_at", time.time()) or time.time()),
            updated_at=float(raw.get("updated_at", time.time()) or time.time()),
        )


@dataclass
class FeatureListV1:
    """Versioned feature list payload."""

    schema_version: int = SCHEMA_VERSION
    features: List[Feature] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "features": [f.to_dict() for f in self.features],
        }

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "FeatureListV1":
        if not isinstance(raw, dict):
            raise ValueError("feature list root must be a dict")
        version = int(raw.get("schema_version", SCHEMA_VERSION) or SCHEMA_VERSION)
        if version != SCHEMA_VERSION:
            raise ValueError(f"unsupported feature_list schema_version: {version}")
        features_raw = raw.get("features") or []
        if not isinstance(features_raw, list):
            raise ValueError("features must be a list")
        features = [Feature.from_dict(item) for item in features_raw]
        seen: set[str] = set()
        for feat in features:
            if feat.id in seen:
                raise ValueError(f"duplicate feature id: {feat.id}")
            seen.add(feat.id)
        return cls(schema_version=version, features=features)


@dataclass
class StatusV1:
    """Current cursor across the project state machine."""

    schema_version: int = SCHEMA_VERSION
    phase: str = PHASE_INITIALIZE
    active_feature_id: Optional[str] = None
    last_commit_sha: Optional[str] = None
    verify_pass_count: int = 0
    verify_fail_count: int = 0
    initializer_min_features: int = 5
    project_id: Optional[str] = None
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "StatusV1":
        if not isinstance(raw, dict):
            raise ValueError("status payload must be a dict")
        version = int(raw.get("schema_version", SCHEMA_VERSION) or SCHEMA_VERSION)
        if version != SCHEMA_VERSION:
            raise ValueError(f"unsupported status schema_version: {version}")
        phase = str(raw.get("phase", PHASE_INITIALIZE) or PHASE_INITIALIZE).strip().lower()
        if phase not in VALID_PHASES:
            raise ValueError(f"invalid status phase: {phase}")
        return cls(
            schema_version=version,
            phase=phase,
            active_feature_id=(str(raw["active_feature_id"]) if raw.get("active_feature_id") else None),
            last_commit_sha=(str(raw["last_commit_sha"]) if raw.get("last_commit_sha") else None),
            verify_pass_count=int(raw.get("verify_pass_count", 0) or 0),
            verify_fail_count=int(raw.get("verify_fail_count", 0) or 0),
            initializer_min_features=int(raw.get("initializer_min_features", 5) or 5),
            project_id=(str(raw["project_id"]) if raw.get("project_id") else None),
            updated_at=float(raw.get("updated_at", time.time()) or time.time()),
        )


def default_status(project_id: Optional[str] = None) -> StatusV1:
    """Build a fresh StatusV1 with phase=initialize."""
    return StatusV1(project_id=project_id)


def default_feature_list() -> FeatureListV1:
    """Build an empty FeatureListV1."""
    return FeatureListV1()
