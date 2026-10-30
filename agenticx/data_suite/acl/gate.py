from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional

from agenticx.data_suite.acl.policy import DatasetGrant, QueryAclPolicy


class QueryAccessDenied(Exception):
    """Raised when a self-serve query is not permitted for the role."""

    def __init__(self, reason: str, *, code: str = "query_acl_denied") -> None:
        super().__init__(reason)
        self.reason = reason
        self.code = code


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    reason: str


def _matches(allowed: frozenset[str], value: str) -> bool:
    return "*" in allowed or value in allowed


def _grant_for(policy: QueryAclPolicy, role: str) -> Optional[DatasetGrant]:
    for g in policy.grants:
        if g.role == role:
            return g
    return None


def check_query_access(
    policy: QueryAclPolicy,
    *,
    role: str,
    dataset_id: str,
    board_id: Optional[str] = None,
    fields: Optional[Iterable[str]] = None,
) -> AccessDecision:
    """Evaluate role × dataset (/board /fields) against an ACL policy.

    Default effect applies when the role has no grant. Field checks use an
    allowlist on the grant when ``fields`` is set on the grant; omitted grant
    fields mean all fields are allowed (masking still applies downstream).
    """
    grant = _grant_for(policy, role)
    if grant is None:
        if policy.default_effect == "allow":
            return AccessDecision(True, "default_allow")
        return AccessDecision(False, f"role_not_granted:{role}")

    if not _matches(grant.datasets, dataset_id):
        return AccessDecision(False, f"dataset_denied:{dataset_id}")

    if board_id is not None:
        # Empty boards set = no board restriction once dataset matches
        if grant.boards and not _matches(grant.boards, board_id):
            return AccessDecision(False, f"board_denied:{board_id}")

    if fields is not None and grant.fields is not None:
        requested: List[str] = [str(f) for f in fields]
        for f in requested:
            if not _matches(grant.fields, f):
                return AccessDecision(False, f"field_denied:{f}")

    return AccessDecision(True, "granted")


def assert_query_access(
    policy: QueryAclPolicy,
    *,
    role: str,
    dataset_id: str,
    board_id: Optional[str] = None,
    fields: Optional[Iterable[str]] = None,
) -> AccessDecision:
    decision = check_query_access(
        policy, role=role, dataset_id=dataset_id, board_id=board_id, fields=fields
    )
    if not decision.allowed:
        raise QueryAccessDenied(decision.reason)
    return decision
