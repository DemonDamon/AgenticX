#!/usr/bin/env python3
"""Vision capability inference for LLM providers and models.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Sequence


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


def _zhipu_text_only_family(model_name: str) -> bool:
    """GLM chat SKUs that reject multimodal image_url parts on BigModel v4.

    Zhipu vision SKUs always carry a digit+"v" marker (glm-4v, glm-4.1v,
    glm-4.5v, glm-4.6v, ...). Anything on the known GLM text families without
    that marker rejects image_url and must have images stripped. Unknown model
    names are left vision-capable to avoid wrongly stripping images from a
    future vision SKU.
    """
    raw = str(model_name or "").strip().lower()
    if not raw:
        return False
    if "/" in raw:
        raw = raw.rsplit("/", 1)[-1]
    # Vision marker -> treat as vision-capable (do not strip).
    if re.search(r"\dv|vision|vl", raw):
        return False
    return raw.startswith(("glm-5", "glm-4.6", "glm-4.5", "glm-4", "glm-z1", "glm-zero"))


# Backward-compatible alias for studio.server thin wrapper (do not remove).
_zhipu_glm5_family_no_vision = _zhipu_text_only_family


def _bailian_qwen_text_no_vision(model_name: str) -> bool:
    """Bailian/DashScope text Qwen SKUs reject OpenAI-style image_url content blocks."""
    raw = str(model_name or "").strip().lower()
    if not raw:
        return False
    if "/" in raw:
        raw = raw.rsplit("/", 1)[-1]
    if "vl" in raw or "vision" in raw or "omni" in raw:
        return False
    return raw.startswith("qwen")


def is_vision_capable(provider_name: str, model_name: str) -> bool:
    """Return True when the provider/model pair should accept image_url inputs.

    Known text-only families are detected by model slug regardless of provider,
    so OpenAI-compatible gateways (custom_openai_*) serving glm-5.x / qwen text
    SKUs are also treated as text-only. Unknown slugs stay vision-permissive.
    ``provider_name`` is kept for API compatibility and logging only.
    """
    model = str(model_name or "").strip()
    if _minimax_m2_family_no_vision(model):
        return False
    if _zhipu_text_only_family(model):
        return False
    if _bailian_qwen_text_no_vision(model):
        return False
    return True


def strip_nonvision_multimodal_messages(
    messages: Sequence[Dict[str, Any]],
    provider_name: str,
    model_name: str,
) -> List[Dict[str, Any]]:
    """Flatten image_url blocks to text when the target model is text-only."""
    if is_vision_capable(provider_name, model_name):
        return [dict(m) for m in messages if isinstance(m, dict)]

    stripped: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        copy = dict(msg)
        content = copy.get("content")
        if not isinstance(content, list):
            stripped.append(copy)
            continue

        text_parts: List[str] = []
        image_count = 0
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = str(block.get("type", "")).strip()
            if block_type == "text":
                text = str(block.get("text", "")).strip()
                if text:
                    text_parts.append(text)
            elif block_type == "image_url":
                image_count += 1

        merged = "\n".join(text_parts).strip()
        if image_count:
            suffix = (
                f"\n[{image_count} image attachment(s) omitted — "
                f"{provider_name}/{model_name} does not support vision input]"
            )
            merged = (merged + suffix).strip()
        copy["content"] = merged or " "
        stripped.append(copy)
    return stripped
