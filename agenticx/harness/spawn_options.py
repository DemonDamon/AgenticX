#!/usr/bin/env python3
"""Filter internal harness_options stamps out of adapter spawn kwargs.

Near persists a few bookkeeping keys on ``session.harness_options``
(today: Codex ``model_provider``, used to skip ``exec resume`` across
vendors). Those keys are not CLI/spawn flags. Forwarding them makes
``CodexAdapter._validate_options`` raise::

    unknown spawn options for codex: ['model_provider']

after a mid-session model/provider switch (the live surface is stopped
and re-spawned) or a cold start of an already-stamped session.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

# Stamps that must stay on the session binding but never reach adapter.spawn.
INTERNAL_HARNESS_OPTION_KEYS = frozenset({"model_provider"})


def adapter_spawn_options(
    options: Optional[Mapping[str, Any]],
) -> Dict[str, Any]:
    """Copy ``harness_options`` minus internal stamps for ``adapter.spawn()``."""
    if not isinstance(options, Mapping):
        return {}
    return {
        key: value
        for key, value in options.items()
        if key not in INTERNAL_HARNESS_OPTION_KEYS
    }


__all__ = ["INTERNAL_HARNESS_OPTION_KEYS", "adapter_spawn_options"]
