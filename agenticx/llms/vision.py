#!/usr/bin/env python3
"""Vision capability inference for LLM providers and models.

Author: Damon Li
"""

from __future__ import annotations

import re


def _minimax_m2_family_no_vision(model_name: str) -> bool:
    """MiniMax M2 chat line does not accept image/audio input (vendor docs)."""
    raw = str(model_name or "").strip().lower()
    if not raw:
        return False
    if "/" in raw:
        raw = raw.rsplit("/", 1)[-1]
    if "vl" in raw or "vision" in raw:
        return False
    if raw.startswith("minimax-m2"):
        return True
    return bool(re.match(r"^m2[.\-_]?\d", raw))


def _zhipu_glm5_family_no_vision(model_name: str) -> bool:
    """GLM-5 chat SKUs on BigModel v4 reject multimodal message parts (image_url)."""
    raw = str(model_name or "").strip().lower()
    if not raw:
        return False
    if "/" in raw:
        raw = raw.rsplit("/", 1)[-1]
    if "vl" in raw or "vision" in raw or "4v" in raw or "5v" in raw:
        return False
    return raw == "glm-5" or raw.startswith("glm-5-")


def is_vision_capable(provider_name: str, model_name: str) -> bool:
    """Return True when the provider/model pair should accept image_url inputs."""
    provider = str(provider_name or "").strip().lower()
    model = str(model_name or "").strip()
    if provider == "minimax" and _minimax_m2_family_no_vision(model):
        return False
    if provider == "zhipu" and _zhipu_glm5_family_no_vision(model):
        return False
    return True
