"""Declarative, credential-safe generation plugin adapters for Studio."""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any


VIDEO_PLUGIN_ID = "video-generation"
VIDEO_DEFAULTS = {"resolution": "480p", "ratio": "16:9", "duration": 5, "watermark": False}
_HTTP_URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
_MARKDOWN_LINK_RE = re.compile(r"\[[^\]]*\]\((https?://[^\s)]+)\)", re.IGNORECASE)
_IMAGE_URL_RE = re.compile(r"\.(?:avif|bmp|gif|heic|jpe?g|png|svg|webp)(?:[?#].*)?$", re.IGNORECASE)


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


def _split_prompt_image_urls(prompt: str) -> tuple[str, list[str]]:
    """Treat pasted HTTP image URLs as reference images, not prompt prose."""
    extracted: list[str] = []

    def extract_url(raw_url: str) -> str:
        url = raw_url.rstrip(".,;:!?，。；：！？）)]}")
        if _IMAGE_URL_RE.search(url):
            extracted.append(url)
            return " "
        return raw_url

    # Rich-text paste may serialize a hyperlink as [label](url). Consume the
    # whole expression before looking for bare URLs, otherwise `](` becomes
    # part of the first matched URL.
    prompt = _MARKDOWN_LINK_RE.sub(lambda match: extract_url(match.group(1)), prompt)

    def replace(match: re.Match[str]) -> str:
        raw_url = match.group(0)
        return extract_url(raw_url)

    return " ".join(_HTTP_URL_RE.sub(replace, prompt).split()), extracted


def resolve_video_payload(plugin: GenerationPlugin, *, prompt: str, image_urls: list[str], params: dict[str, Any] | None = None) -> dict[str, Any]:
    prompt, pasted_image_urls = _split_prompt_image_urls(str(prompt or "").strip())
    if not prompt:
        raise ValueError("提示词不能为空")
    supplied = params or {}
    merged = {**VIDEO_DEFAULTS, **plugin.defaults, **{k: v for k, v in supplied.items() if v is not None}}
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    seen_urls: set[str] = set()
    for image in [*pasted_image_urls, *image_urls]:
        if image and image not in seen_urls:
            # Video-generation reference images use an image_url object.
            content.append({"type": "image_url", "image_url": {"url": image}})
            seen_urls.add(image)
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
    def first(*paths: str) -> Any:
        for path in paths:
            value = _mapping_value(payload, path)
            if value is not None:
                return value
        return None

    return {
        "task_id": first(mapping.get("task_id", "task_id"), "id"),
        "status": first(mapping.get("status", "status")),
        "progress": first(mapping.get("progress", "progress")),
        "result_url": first(mapping.get("result_url", "content.video_url"), "result_url"),
        "error": first(mapping.get("error", "error")),
    }


def _generation_task_context_text(task: dict[str, Any], prompt: str) -> str:
    """Return a provider-safe summary of a generation task for later chat turns."""
    task_id = str(task.get("task_id") or "").strip()
    status = str(task.get("status") or "submitted").strip() or "submitted"
    params = task.get("params") if isinstance(task.get("params"), dict) else {}
    content = params.get("content") if isinstance(params, dict) else []
    reference_count = sum(
        1
        for item in content
        if isinstance(item, dict) and str(item.get("type") or "").strip() == "image_url"
    )
    lines = [
        "[视频生成任务]",
        f"任务 ID: {task_id}",
        f"状态: {status}",
        f"提示词: {str(prompt or '').strip()}",
    ]
    if reference_count:
        lines.append(f"参考图: {reference_count} 张")
    result_url = str(task.get("result_url") or "").strip()
    if result_url:
        lines.append(f"视频链接: {result_url}")
    error = str(task.get("error") or "").strip()
    if error:
        lines.append(f"任务错误: {error}")
    return "\n".join(lines)


def sync_generation_task_agent_messages(
    agent_messages: list[dict[str, Any]],
    task: dict[str, Any],
    *,
    prompt: str,
) -> None:
    """Mirror a generation task into model context and update it in place on polling.

    ``chat_history`` is only the UI transcript; normal chat requests use
    ``agent_messages``.  This deliberately stores only a concise task summary,
    never a base64 reference image, so later follow-up questions can refer to
    the generated video without consuming the model context with binary data.
    """
    task_id = str(task.get("task_id") or "").strip()
    if not task_id:
        return
    marker = f"任务 ID: {task_id}"
    context_text = _generation_task_context_text(task, prompt)
    for item in reversed(agent_messages):
        if (
            isinstance(item, dict)
            and str(item.get("role") or "").strip() == "assistant"
            and marker in str(item.get("content") or "")
        ):
            item["content"] = context_text
            return
    agent_messages.append({"role": "user", "content": str(prompt or "").strip()})
    agent_messages.append({"role": "assistant", "content": context_text})


def sync_generation_tasks_from_history(
    agent_messages: list[dict[str, Any]],
    chat_history: list[dict[str, Any]],
) -> None:
    """Backfill prior generation tasks before a normal chat request begins."""
    latest_prompt = ""
    for row in chat_history:
        if not isinstance(row, dict):
            continue
        if str(row.get("role") or "").strip() == "user":
            latest_prompt = str(row.get("content") or "")
            continue
        metadata = row.get("metadata")
        task = metadata.get("generation_task") if isinstance(metadata, dict) else None
        if isinstance(task, dict):
            sync_generation_task_agent_messages(agent_messages, task, prompt=latest_prompt)
