"""Resolve which brains are mounted for a session / avatar."""

from __future__ import annotations

from typing import Any, List, Optional

from .registry import BrainRegistry
from .types import Brain, BrainScope, BrainType, BrainsEnabledSpec


def _avatar_id_normalized(avatar_id: Optional[str]) -> Optional[str]:
    if avatar_id is None:
        return None
    s = str(avatar_id).strip()
    if not s or s.startswith("automation:"):
        return None
    return s


def brain_visible_to(brain: Brain, avatar_id: Optional[str]) -> bool:
    if not brain.enabled:
        return False
    if brain.scope == BrainScope.GLOBAL:
        return True
    if brain.scope == BrainScope.PRIVATE:
        aid = _avatar_id_normalized(avatar_id)
        return bool(aid and brain.owner_avatar_id == aid)
    return False


def list_visible_brains(
    *,
    avatar_id: Optional[str],
    brain_type: Optional[BrainType] = None,
) -> List[Brain]:
    reg = BrainRegistry.instance()
    out: List[Brain] = []
    for b in reg.list_brains():
        if brain_type is not None and b.type != brain_type:
            continue
        if brain_visible_to(b, avatar_id):
            out.append(b)
    return out


def resolve_mounted_brain_ids(
    *,
    avatar_id: Optional[str],
    brains_enabled: BrainsEnabledSpec = None,
    explicit_brain_id: Optional[str] = None,
    brain_type: BrainType,
    max_brains: int = 5,
) -> List[str]:
    """Return ordered brain ids to query."""
    if explicit_brain_id:
        bid = str(explicit_brain_id).strip()
        brain = BrainRegistry.instance().get(bid)
        if brain is None:
            return []
        if brain.type != brain_type or not brain_visible_to(brain, avatar_id):
            return []
        return [bid]

    visible = list_visible_brains(avatar_id=avatar_id, brain_type=brain_type)
    visible_by_id = {b.id: b for b in visible}

    if brains_enabled == "*":
        ids = [b.id for b in visible]
    elif isinstance(brains_enabled, list) and brains_enabled:
        ids = [str(x) for x in brains_enabled if str(x) in visible_by_id]
    else:
        # None → global only (Meta default + avatar default)
        ids = [b.id for b in visible if b.scope == BrainScope.GLOBAL]

    return ids[:max_brains]


def session_has_mounted_code_brains(
    session: Any = None, *, avatar_id: Optional[str] = None
) -> bool:
    """True when this session would search at least one mounted code brain."""
    resolved_avatar: Optional[str] = (
        str(avatar_id).strip() if avatar_id is not None and str(avatar_id).strip() else None
    )
    if resolved_avatar is None and session is not None:
        for attr in ("bound_avatar_id", "avatar_id"):
            raw = str(getattr(session, attr, "") or "").strip()
            if raw and not raw.startswith(("group:", "automation:")):
                resolved_avatar = raw
                break
    try:
        BrainRegistry.instance().bootstrap()
        targets = resolve_mounted_brain_ids(
            avatar_id=resolved_avatar,
            brains_enabled=load_avatar_brains_enabled(resolved_avatar),
            brain_type=BrainType.CODE,
        )
        return bool(targets)
    except Exception:
        return False


def load_avatar_brains_enabled(avatar_id: Optional[str]) -> BrainsEnabledSpec:
    aid = _avatar_id_normalized(avatar_id)
    if not aid:
        return None
    try:
        from agenticx.avatar.registry import AvatarRegistry

        av = AvatarRegistry().get_avatar(aid)
        if av is None:
            return None
        return getattr(av, "brains_enabled", None)
    except Exception:
        return None
