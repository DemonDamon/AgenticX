"""Declarative, credential-safe generation plugin adapters for Studio."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


VIDEO_PLUGIN_ID = "video-generation"
VIDEO_DEFAULTS = {"resolution": "480p", "ratio": "16:9", "duration": 5, "watermark": False}


@dataclass(frozen=True)
class GenerationPlugin:
    plugin_id: str
    display_name: str
    provider: str
    model: str
    submit_url: str
    status_url_template: str = ""
    cancel_url_template: str = ""
    enabled: bool = True
    defaults: dict[str, Any] = field(default_factory=dict)
    response_mapping: dict[str, str] = field(default_factory=dict)

    @property
    def is_video(self) -> bool:
        return self.plugin_id == VIDEO_PLUGIN_ID


def _mapping_value(data: Any, path: str) -> Any:
    current = data
    for part in str(path or "").strip(".").split("."):
        if not part:
            continue
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def load_generation_plugins(config: Any) -> list[GenerationPlugin]:
    raw_plugins = getattr(config, "generation_plugins", None)
    if raw_plugins is None and isinstance(config, dict):
        raw_plugins = config.get("generation_plugins")
    if not isinstance(raw_plugins, dict):
        return []
    result: list[GenerationPlugin] = []
    for plugin_id, raw in raw_plugins.items():
        if not isinstance(raw, dict):
            continue
        provider = str(raw.get("provider") or "").strip()
        model = str(raw.get("model") or "").strip()
        submit_url = str(raw.get("submit_url") or "").strip()
        if not provider or not model or not submit_url:
            continue
        result.append(GenerationPlugin(
            plugin_id=str(plugin_id).strip(),
            display_name=str(raw.get("display_name") or "视频生成").strip(),
            provider=provider,
            model=model,
            submit_url=submit_url,
            status_url_template=str(raw.get("status_url_template") or "").strip(),
            cancel_url_template=str(raw.get("cancel_url_template") or "").strip(),
            enabled=bool(raw.get("enabled", True)),
            defaults=dict(raw.get("defaults") or {}),
            response_mapping=dict(raw.get("response_mapping") or {}),
        ))
    return result


def resolve_video_payload(plugin: GenerationPlugin, *, prompt: str, image_urls: list[str], params: dict[str, Any] | None = None) -> dict[str, Any]:
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("提示词不能为空")
    supplied = params or {}
    merged = {**VIDEO_DEFAULTS, **plugin.defaults, **{k: v for k, v in supplied.items() if v is not None}}
    content: list[dict[str, str]] = [{"type": "text", "text": prompt}]
    content.extend({"type": "image_url", "url": image} for image in image_urls)
    return {
        "model": plugin.model,
        "content": content,
        "resolution": str(merged["resolution"]),
        "ratio": str(merged["ratio"]),
        "duration": int(merged["duration"]),
        "watermark": bool(merged["watermark"]),
    }


def mapped_task_response(plugin: GenerationPlugin, payload: Any) -> dict[str, Any]:
    mapping = plugin.response_mapping
    return {
        "task_id": _mapping_value(payload, mapping.get("task_id", "task_id")),
        "status": _mapping_value(payload, mapping.get("status", "status")),
        "progress": _mapping_value(payload, mapping.get("progress", "progress")),
        "result_url": _mapping_value(payload, mapping.get("result_url", "result_url")),
        "error": _mapping_value(payload, mapping.get("error", "error")),
    }
