#!/usr/bin/env python3
"""Text-to-image tool: write a local PNG and return a structured JSON result.

Author: Damon Li
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Mapping, Optional, Protocol, runtime_checkable

from agenticx.cli.config_manager import ConfigManager

# 1x1 PNG used by FakeImageGenProvider in tests (not sent over SSE).
MINIMAL_PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)

ALLOWED_SIZES = ("1024x1024", "1024x1792", "1792x1024")
UNCONFIGURED_ERROR = "image_generation is not configured"
UNCONFIGURED_TOOL_TEXT = f"ERROR: {UNCONFIGURED_ERROR}"


@runtime_checkable
class ImageGenProvider(Protocol):
    """Vendor-agnostic image generator. P0 adapters are injectable (tests use Fake)."""

    def generate(self, prompt: str, size: str, dest_path: Path) -> Mapping[str, Any]:
        """Write an image file to dest_path and return metadata (mime/width/height)."""


class FakeImageGenProvider:
    """Writes a 1x1 PNG. Used by unit tests; not a production vendor."""

    def generate(self, prompt: str, size: str, dest_path: Path) -> Mapping[str, Any]:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(MINIMAL_PNG_BYTES)
        width, height = _parse_size(size)
        return {"mime": "image/png", "width": width, "height": height}


def load_image_generation_config() -> dict[str, Any]:
    raw = ConfigManager.get_value("image_generation")
    if not isinstance(raw, dict):
        return {}
    return {
        "provider": str(raw.get("provider") or "").strip(),
        "api_key": str(raw.get("api_key") or "").strip(),
        "api_base": str(raw.get("api_base") or "").strip(),
        "model": str(raw.get("model") or "").strip(),
    }


def is_image_generation_configured(config: Optional[Mapping[str, Any]] = None) -> bool:
    data = dict(config) if isinstance(config, Mapping) else load_image_generation_config()
    return bool(
        str(data.get("api_key") or "").strip()
        or str(data.get("api_base") or "").strip()
        or str(data.get("provider") or "").strip()
    )


def _parse_size(size: str) -> tuple[int, int]:
    raw = str(size or "").strip() or "1024x1024"
    if raw not in ALLOWED_SIZES:
        raw = "1024x1024"
    parts = raw.split("x", 1)
    try:
        return int(parts[0]), int(parts[1])
    except (TypeError, ValueError, IndexError):
        return 1024, 1024


def _session_workspace_dir(session: Any) -> Path:
    raw = str(getattr(session, "workspace_dir", "") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path.home() / ".agenticx" / "tmp-image-gen"


def generate_image(
    prompt: str,
    *,
    size: str = "1024x1024",
    session: Any = None,
    provider: Optional[ImageGenProvider] = None,
    config: Optional[Mapping[str, Any]] = None,
) -> str:
    """Generate an image and return a JSON string with type==image (or ERROR: text)."""
    text = str(prompt or "").strip()
    if not text:
        return "ERROR: generate_image requires a non-empty prompt"

    cfg = dict(config) if isinstance(config, Mapping) else load_image_generation_config()
    impl = provider
    if impl is None and not is_image_generation_configured(cfg):
        return UNCONFIGURED_TOOL_TEXT
    if impl is None:
        # P0 does not lock a cloud vendor SDK. Config present but no injectable
        # adapter still fails closed with the same unconfigured contract.
        return UNCONFIGURED_TOOL_TEXT

    width, height = _parse_size(size)
    dest_dir = _session_workspace_dir(session) / "generated"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{uuid.uuid4().hex}.png"
    try:
        meta = impl.generate(text, f"{width}x{height}", dest)
    except Exception as exc:
        return f"ERROR: image_generation failed: {exc}"

    path = dest.resolve()
    if not path.is_file():
        return "ERROR: image_generation did not write an image file"

    payload = {
        "type": "image",
        "path": str(path),
        "mime": str((meta or {}).get("mime") or "image/png"),
        "alt": text,
        "width": int((meta or {}).get("width") or width),
        "height": int((meta or {}).get("height") or height),
    }
    return json.dumps(payload, ensure_ascii=False)
