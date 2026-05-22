#!/usr/bin/env python3
"""Feature list mutations with state-machine validation.

Author: Damon Li
"""

from __future__ import annotations

import time
from typing import Iterable, List, Optional

from agenticx.project_state.schema import (
    FEATURE_COMMITTED,
    FEATURE_IN_PROGRESS,
    FEATURE_PENDING,
    FEATURE_VERIFIED,
    Feature,
    FeatureListV1,
    is_valid_transition,
)
from agenticx.project_state.store import ProjectStateError, ProjectStore


def find_feature(payload: FeatureListV1, feature_id: str) -> Optional[Feature]:
    """Return the feature with the given id or None."""
    fid = (feature_id or "").strip()
    if not fid:
        return None
    for feat in payload.features:
        if feat.id == fid:
            return feat
    return None


def upsert_features(
    payload: FeatureListV1,
    new_items: Iterable[Feature],
    *,
    allow_status_overwrite: bool = False,
) -> List[str]:
    """Add or update features in-place. Returns affected ids.

    Status of an existing feature is preserved unless ``allow_status_overwrite``
    is True; this keeps Initializer-stage rewrites safe.
    """
    affected: List[str] = []
    by_id = {f.id: f for f in payload.features}
    for new in new_items:
        if new.id in by_id:
            existing = by_id[new.id]
            existing.title = new.title
            existing.description = new.description
            existing.acceptance_criteria = list(new.acceptance_criteria)
            existing.depends_on = list(new.depends_on)
            existing.priority = int(new.priority)
            if allow_status_overwrite:
                existing.status = new.status
            existing.updated_at = time.time()
        else:
            payload.features.append(new)
        affected.append(new.id)
    return affected


def transition_feature(
    payload: FeatureListV1,
    feature_id: str,
    new_status: str,
    *,
    evidence: Optional[dict] = None,
) -> Feature:
    """Move ``feature_id`` to ``new_status`` if the transition is allowed."""
    feat = find_feature(payload, feature_id)
    if feat is None:
        raise ProjectStateError(f"unknown feature id: {feature_id}")
    if not is_valid_transition(feat.status, new_status):
        raise ProjectStateError(
            f"illegal transition for {feature_id}: {feat.status} -> {new_status}"
        )
    feat.status = new_status
    if evidence is not None:
        merged = dict(feat.evidence or {})
        merged.update(evidence)
        feat.evidence = merged
    feat.updated_at = time.time()
    return feat


def select_next_pending(payload: FeatureListV1) -> Optional[Feature]:
    """Pick the highest-priority pending feature with all deps committed."""
    committed_ids = {f.id for f in payload.features if f.status == FEATURE_COMMITTED}
    candidates = [f for f in payload.features if f.status == FEATURE_PENDING]
    candidates = [
        f for f in candidates if all(dep in committed_ids for dep in f.depends_on)
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda f: (int(f.priority), f.created_at, f.id))
    return candidates[0]


def has_active_in_progress(payload: FeatureListV1) -> Optional[Feature]:
    """Return the feature currently in_progress if any."""
    for feat in payload.features:
        if feat.status == FEATURE_IN_PROGRESS:
            return feat
    return None


def summarize(payload: FeatureListV1) -> dict:
    """Build a compact summary suitable for prompt blocks and API responses."""
    counts = {s: 0 for s in [
        FEATURE_PENDING, FEATURE_IN_PROGRESS, FEATURE_VERIFIED, FEATURE_COMMITTED,
    ]}
    counts["skipped"] = 0
    for feat in payload.features:
        counts[feat.status] = counts.get(feat.status, 0) + 1
    return {
        "total": len(payload.features),
        "pending": counts.get(FEATURE_PENDING, 0),
        "in_progress": counts.get(FEATURE_IN_PROGRESS, 0),
        "verified": counts.get(FEATURE_VERIFIED, 0),
        "committed": counts.get(FEATURE_COMMITTED, 0),
        "skipped": counts.get("skipped", 0),
    }


def commit_active_feature(
    store: ProjectStore,
    payload: FeatureListV1,
    feature_id: str,
    commit_sha: str,
) -> Feature:
    """Move a verified feature to committed and persist an archive snapshot."""
    feat = find_feature(payload, feature_id)
    if feat is None:
        raise ProjectStateError(f"unknown feature id: {feature_id}")
    if feat.status != FEATURE_VERIFIED:
        raise ProjectStateError(
            f"feature {feature_id} must be verified before commit (current: {feat.status})"
        )
    sha = (commit_sha or "").strip()
    if not sha:
        raise ProjectStateError("commit_sha is required to mark feature committed")
    feat = transition_feature(
        payload,
        feature_id,
        FEATURE_COMMITTED,
        evidence={"commit_sha": sha},
    )
    snapshot = feat.to_dict()
    snapshot["committed_at"] = time.time()
    store.write_archive(feature_id, snapshot)
    return feat
