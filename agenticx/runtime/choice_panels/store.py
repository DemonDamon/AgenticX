#!/usr/bin/env python3
"""In-process store for versioned structured choice panels.

Panels support ``clarification`` and ``comparison`` kinds. Comparison options
must include at least one http(s) source and at most three visible options.
Selections must match ``candidate_set_version``; stale or superseded panels
reject the write.

Author: Damon Li
"""

from __future__ import annotations

import re
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlparse

PanelType = Literal["clarification", "comparison"]

_HTTP_SCHEMES = frozenset({"http", "https"})
_MAX_COMPARISON_OPTIONS = 3
_MAX_CLARIFICATION_OPTIONS = 12
_MAX_DETAILS = 4
_MAX_SOURCES = 5


class ChoicePanelError(Exception):
    """Base error for choice panel operations."""


class ValidationError(ChoicePanelError):
    """Raised when panel create/update input is invalid."""


class StaleChoiceError(ChoicePanelError):
    """Raised when a selection targets a superseded or outdated panel version."""


@dataclass(frozen=True)
class ChoiceSource:
    title: str
    url: str

    def to_dict(self) -> Dict[str, str]:
        return {"title": self.title, "url": self.url}


@dataclass(frozen=True)
class ChoiceOption:
    id: str
    label: str
    details: List[str] = field(default_factory=list)
    sources: List[ChoiceSource] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "details": list(self.details),
            "sources": [s.to_dict() for s in self.sources],
        }


@dataclass
class ChoicePanel:
    panel_id: str
    session_id: str
    candidate_set_version: int
    panel_type: PanelType
    title: str
    options: List[ChoiceOption]
    selected_id: Optional[str] = None
    superseded: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "panel_id": self.panel_id,
            "session_id": self.session_id,
            "candidate_set_version": self.candidate_set_version,
            "panel_type": self.panel_type,
            "title": self.title,
            "options": [o.to_dict() for o in self.options],
            "selected_id": self.selected_id,
            "superseded": self.superseded,
        }


def _normalize_text(value: Any, *, field_name: str, max_len: int = 200) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValidationError(f"{field_name} must be a non-empty string")
    if len(text) > max_len:
        raise ValidationError(f"{field_name} exceeds max length {max_len}")
    return text


def _validate_http_url(url: str) -> str:
    text = str(url or "").strip()
    if not text or len(text) > 4096:
        raise ValidationError("source url must be a non-empty http(s) URL")
    parsed = urlparse(text)
    if parsed.scheme.lower() not in _HTTP_SCHEMES or not parsed.netloc:
        raise ValidationError(f"source url must use http(s): {text}")
    return text


def _parse_option(raw: Any, *, index: int) -> ChoiceOption:
    if not isinstance(raw, dict):
        raise ValidationError(f"options[{index}] must be an object")
    opt_id = _normalize_text(raw.get("id") or f"opt-{index + 1}", field_name="option.id")
    label = _normalize_text(raw.get("label"), field_name="option.label")
    raw_details = raw.get("details") or []
    if not isinstance(raw_details, list):
        raise ValidationError(f"options[{index}].details must be an array")
    details: List[str] = []
    for d in raw_details[:_MAX_DETAILS]:
        text = str(d or "").strip()
        if text:
            details.append(text[:600])
    raw_sources = raw.get("sources") or []
    if not isinstance(raw_sources, list):
        raise ValidationError(f"options[{index}].sources must be an array")
    sources: List[ChoiceSource] = []
    for s in raw_sources[:_MAX_SOURCES]:
        if not isinstance(s, dict):
            raise ValidationError(f"options[{index}].sources entries must be objects")
        title = _normalize_text(s.get("title"), field_name="source.title")
        url = _validate_http_url(str(s.get("url") or ""))
        sources.append(ChoiceSource(title=title, url=url))
    return ChoiceOption(id=opt_id, label=label, details=details, sources=sources)


def _score_option(option: ChoiceOption, query: str) -> int:
    """Local heuristic ranking — keyword overlap only, no external service."""
    haystack = f"{option.label} {' '.join(option.details)}".lower()
    score = 0
    for token in re.findall(r"[\w\u4e00-\u9fff]+", (query or "").lower()):
        if len(token) >= 2 and token in haystack:
            score += 1
    return score


def normalize_and_validate_options(
    panel_type: PanelType,
    raw_options: Any,
    *,
    title: str = "",
) -> List[ChoiceOption]:
    if not isinstance(raw_options, list) or not raw_options:
        raise ValidationError("options must be a non-empty array")
    max_opts = (
        _MAX_COMPARISON_OPTIONS if panel_type == "comparison" else _MAX_CLARIFICATION_OPTIONS
    )
    parsed: List[ChoiceOption] = []
    seen_ids: set[str] = set()
    for idx, item in enumerate(raw_options[:max_opts]):
        option = _parse_option(item, index=idx)
        if option.id in seen_ids:
            raise ValidationError(f"duplicate option id: {option.id}")
        seen_ids.add(option.id)
        if panel_type == "comparison" and not option.sources:
            raise ValidationError(
                f"comparison option '{option.label}' requires at least one http(s) source"
            )
        parsed.append(option)
    if panel_type == "comparison" and len(raw_options) > _MAX_COMPARISON_OPTIONS:
        # Cap visibility at 3 after local ranking; reject if caller sent more than 3
        # without ranking context — keep strict for create API.
        if len(parsed) > _MAX_COMPARISON_OPTIONS:
            raise ValidationError(
                f"comparison panel can show at most {_MAX_COMPARISON_OPTIONS} options"
            )
    # Rank by local heuristic (stable for equal scores).
    ranked = sorted(
        enumerate(parsed),
        key=lambda pair: (-_score_option(pair[1], title), pair[0]),
    )
    return [opt for _, opt in ranked]


class ChoicePanelStore:
    """Thread-safe in-process store keyed by session.

    Persistence across process restarts is intentionally out of scope for Wave A;
    version CAS within a live Studio session is what stale-select guards need.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._panels: Dict[str, ChoicePanel] = {}
        self._session_current: Dict[str, str] = {}
        self._session_version: Dict[str, int] = {}

    def create_panel(
        self,
        *,
        session_id: str,
        panel_type: str,
        title: str,
        options: Any,
        panel_id: Optional[str] = None,
    ) -> ChoicePanel:
        sid = str(session_id or "").strip()
        if not sid:
            raise ValidationError("session_id is required")
        kind = str(panel_type or "").strip()
        if kind not in ("clarification", "comparison"):
            raise ValidationError("panel_type must be clarification or comparison")
        clean_title = _normalize_text(title, field_name="title", max_len=200)
        clean_options = normalize_and_validate_options(
            kind,  # type: ignore[arg-type]
            options,
            title=clean_title,
        )
        with self._lock:
            # Supersede any prior active panel for this session.
            prev_id = self._session_current.get(sid)
            if prev_id and prev_id in self._panels:
                prev = self._panels[prev_id]
                prev.superseded = True
            next_version = int(self._session_version.get(sid, 0)) + 1
            self._session_version[sid] = next_version
            pid = str(panel_id or "").strip() or str(uuid.uuid4())
            panel = ChoicePanel(
                panel_id=pid,
                session_id=sid,
                candidate_set_version=next_version,
                panel_type=kind,  # type: ignore[arg-type]
                title=clean_title,
                options=clean_options,
            )
            self._panels[pid] = panel
            self._session_current[sid] = pid
            return panel

    def get_panel(self, panel_id: str) -> Optional[ChoicePanel]:
        with self._lock:
            return self._panels.get(str(panel_id or "").strip())

    def current_panel(self, session_id: str) -> Optional[ChoicePanel]:
        with self._lock:
            pid = self._session_current.get(str(session_id or "").strip())
            if not pid:
                return None
            return self._panels.get(pid)

    def resolve_option_id(self, panel_id: str, option_ref: str) -> Optional[str]:
        """Map an option id or visible label to the stored option id."""
        ref = str(option_ref or "").strip()
        if not ref:
            return None
        with self._lock:
            panel = self._panels.get(str(panel_id or "").strip())
            if panel is None:
                return None
            for opt in panel.options:
                if opt.id == ref or opt.label == ref:
                    return opt.id
        return None

    def select(
        self,
        *,
        session_id: str,
        panel_id: str,
        candidate_set_version: int,
        option_id: str,
    ) -> ChoicePanel:
        sid = str(session_id or "").strip()
        pid = str(panel_id or "").strip()
        oid = self.resolve_option_id(pid, option_id) or str(option_id or "").strip()
        if not sid or not pid or not oid:
            raise StaleChoiceError("choice selection is incomplete")
        try:
            version = int(candidate_set_version)
        except (TypeError, ValueError) as exc:
            raise StaleChoiceError("candidate_set_version must be a positive integer") from exc
        if version < 1:
            raise StaleChoiceError("candidate_set_version must be a positive integer")

        with self._lock:
            panel = self._panels.get(pid)
            if panel is None or panel.session_id != sid:
                raise StaleChoiceError("This choice is unavailable or out of date")
            if panel.superseded:
                raise StaleChoiceError("These choices have been superseded")
            if panel.candidate_set_version != version:
                raise StaleChoiceError("This choice is unavailable or out of date")
            current_id = self._session_current.get(sid)
            if current_id != pid:
                raise StaleChoiceError("These choices have been superseded")
            if not any(o.id == oid for o in panel.options):
                raise StaleChoiceError("This option is unavailable")
            if panel.selected_id and panel.selected_id != oid:
                raise StaleChoiceError("A different choice was already selected")
            panel.selected_id = oid
            return panel

    def clear(self) -> None:
        with self._lock:
            self._panels.clear()
            self._session_current.clear()
            self._session_version.clear()


_STORE: Optional[ChoicePanelStore] = None
_STORE_LOCK = threading.Lock()


def get_choice_panel_store() -> ChoicePanelStore:
    global _STORE
    with _STORE_LOCK:
        if _STORE is None:
            _STORE = ChoicePanelStore()
        return _STORE


def reset_choice_panel_store_for_tests() -> ChoicePanelStore:
    """Replace the process singleton — tests only."""
    global _STORE
    with _STORE_LOCK:
        _STORE = ChoicePanelStore()
        return _STORE


def panel_to_clarification_context(panel: ChoicePanel) -> Dict[str, Any]:
    """Embed choice-panel fields into clarification ``context`` for Desktop."""
    return {
        "kind": "choice_panel",
        "panel_id": panel.panel_id,
        "candidate_set_version": panel.candidate_set_version,
        "panel_type": panel.panel_type,
        "choice_options": [o.to_dict() for o in panel.options],
        "superseded": panel.superseded,
    }
