#!/usr/bin/env python3
"""User-facing provider/model labels aligned with Desktop model service settings.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Mapping

BUILTIN_PROVIDER_DISPLAY_NAMES: dict[str, str] = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "volcengine": "火山引擎",
    "bailian": "阿里云百炼",
    "zhipu": "智谱开放平台",
    "qianfan": "百度千帆",
    "minimax": "MiniMax",
    "kimi": "月之暗面",
    "deepseek": "DeepSeek",
    "ollama": "Ollama",
}

OFFICIAL_OPENAI_BASES = frozenset(
    {
        "https://api.openai.com",
        "https://api.openai.com/v1",
    }
)


def normalize_bare_model_id(model: str) -> str:
    """Strip LiteLLM / gateway routing prefixes such as ZHIPU/glm-5.2."""
    trimmed = str(model or "").strip()
    if not trimmed:
        return ""
    slash = trimmed.find("/")
    if slash > 0:
        return trimmed[slash + 1 :].strip()
    return trimmed


def _normalize_base_url(base_url: str) -> str:
    return str(base_url or "").strip().rstrip("/").lower()


def is_official_openai_base(base_url: str) -> bool:
    base = _normalize_base_url(base_url)
    if not base:
        return True
    return base in OFFICIAL_OPENAI_BASES


def get_provider_display_name(
    provider_id: str,
    provider_cfg: Mapping[str, Any] | None = None,
) -> str:
    """Resolve the user-facing vendor label from settings display_name."""
    pid = str(provider_id or "").strip()
    if not pid or pid == "(unknown)":
        return "未知厂商"
    cfg = provider_cfg if isinstance(provider_cfg, Mapping) else {}
    custom = str(cfg.get("display_name") or cfg.get("displayName") or "").strip()
    if custom:
        return custom
    if pid == "openai":
        base_url = str(cfg.get("base_url") or cfg.get("baseUrl") or "").strip()
        if base_url and not is_official_openai_base(base_url):
            return "OpenAI 兼容"
    if pid in BUILTIN_PROVIDER_DISPLAY_NAMES:
        return BUILTIN_PROVIDER_DISPLAY_NAMES[pid]
    if pid.startswith("custom_openai_") or pid.startswith("custom_ollama_"):
        return "历史厂商"
    return pid


def format_model_option_label(
    provider_id: str,
    model: str,
    provider_cfg: Mapping[str, Any] | None = None,
    *,
    separator: str = "/",
) -> str:
    """User-facing label: configured vendor + bare model id."""
    bare = normalize_bare_model_id(model)
    if not bare:
        return "未选模型"
    prov_label = get_provider_display_name(provider_id, provider_cfg)
    return f"{prov_label}{separator}{bare}"


def load_provider_configs() -> dict[str, dict[str, Any]]:
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg = ConfigManager.load()
        raw = cfg.providers if isinstance(cfg.providers, dict) else {}
        out: dict[str, dict[str, Any]] = {}
        for key, value in raw.items():
            if isinstance(value, dict):
                out[str(key).strip()] = dict(value)
        return out
    except Exception:
        return {}


def resolve_provider_config(
    provider_id: str,
    providers: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, Any] | None:
    pid = str(provider_id or "").strip()
    if not pid:
        return None
    catalog = providers if providers is not None else load_provider_configs()
    direct = catalog.get(pid)
    if isinstance(direct, dict):
        return dict(direct)
    lower = pid.lower()
    for key, value in catalog.items():
        if str(key).lower() == lower and isinstance(value, dict):
            return dict(value)
    return None


def provider_breakdown_label(provider_id: str) -> str:
    cfg = resolve_provider_config(provider_id)
    return get_provider_display_name(provider_id, cfg)


def build_provider_catalog_block() -> str:
    """Inject configured model services so Meta-Agent uses display names with users.

    这个块**必须保持稳定**：它在 system prompt 里，不受 include_volatile 门控，所以
    任何随会话变化的值放进来都会让 messages[0] 变字节、整段前缀缓存作废。provider
    列表本身只在用户增删 provider 时才变，够稳；曾经在这里的「当前会话模型」那行不是——
    它每次切模型都变，而附件路由一检测到文档就会切到私有化 Qwen，等于在最该命中缓存
    的时刻把缓存打穿。同样的信息已经在 <session-context> 的 model_service / provider /
    model 三个字段里（见 meta_agent.build_meta_agent_volatile_sections），那里是易变区，
    放在历史之后，不碰前缀。
    """
    providers = load_provider_configs()
    if not providers:
        return ""

    lines = [
        "## 模型服务（用户可见名称）",
        "- 向用户展示、`request_clarification` 提问、推荐模型时，只能使用「厂商展示名/模型短名」格式。",
        "- 禁止向用户暴露 `custom_openai_*`、`custom_ollama_*` 等内部配置 id；工具调用仍使用内部 provider/model 参数。",
    ]
    for provider_id, cfg in sorted(providers.items(), key=lambda item: item[0]):
        if not isinstance(cfg, dict):
            continue
        if cfg.get("enabled") is False:
            continue
        display = get_provider_display_name(provider_id, cfg)
        models_raw = cfg.get("models")
        models: list[str] = []
        if isinstance(models_raw, list):
            models = [normalize_bare_model_id(str(m)) for m in models_raw if str(m).strip()]
        elif str(cfg.get("model") or "").strip():
            models = [normalize_bare_model_id(str(cfg.get("model")))]
        models = [m for m in models if m]
        if not models:
            continue
        visible = ", ".join(format_model_option_label(provider_id, m, cfg) for m in models[:8])
        lines.append(
            f"- {display}: {visible} "
            f"(spawn 参数 provider={provider_id}, model=<模型 id>)"
        )

    return "\n".join(lines) + "\n\n"
