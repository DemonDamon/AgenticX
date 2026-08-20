#!/usr/bin/env python3
"""Unified AGX CLI configuration manager.

Author: Damon Li
"""

from __future__ import annotations

import copy
from dataclasses import asdict, dataclass, field
import os
from pathlib import Path
import threading
from typing import Any, Dict, Optional, Tuple

import yaml


SUPPORTED_PROVIDERS: Dict[str, Dict[str, Any]] = {
    "openai": {"required": ["api_key"], "default_model": "gpt-4o"},
    "anthropic": {
        "required": ["api_key"],
        "default_model": "anthropic/claude-sonnet-4-20250514",
    },
    "zhipu": {"required": ["api_key"], "default_model": "glm-4-plus"},
    "volcengine": {
        "required": ["api_key"],
        "optional": ["endpoint_id"],
        "default_model": "doubao-seed-1-6",
    },
    "bailian": {"required": ["api_key"], "default_model": "qwen-plus"},
    "qianfan": {
        "required": ["api_key"],
        "optional": ["secret_key"],
        "default_model": "ernie-4.0-8k",
    },
    "kimi": {"required": ["api_key"], "default_model": "kimi-k2-0711-preview"},
    "minimax": {
        "required": ["api_key"],
        "optional": ["group_id"],
        "default_model": "abab6.5s-chat",
    },
    "deepseek": {"required": ["api_key"], "default_model": "deepseek-v4-pro"},
    "ollama": {"required": ["base_url"], "default_model": "llama3"},
}

ENV_PROVIDER_MAP = {
    "openai": ("OPENAI_API_KEY", "gpt-4o"),
    "anthropic": ("ANTHROPIC_API_KEY", "anthropic/claude-sonnet-4-20250514"),
    "zhipu": ("ZHIPU_API_KEY", "glm-4-plus"),
    "volcengine": ("ARK_API_KEY", "doubao-seed-1-6"),
    "bailian": ("DASHSCOPE_API_KEY", "qwen-plus"),
    "qianfan": ("QIANFAN_ACCESS_KEY", "ernie-4.0-8k"),
    "kimi": ("MOONSHOT_API_KEY", "kimi-k2-0711-preview"),
    "minimax": ("MINIMAX_API_KEY", "abab6.5s-chat"),
    "deepseek": ("DEEPSEEK_API_KEY", "deepseek-v4-pro"),
}


@dataclass
class ProviderConfig:
    """Provider configuration."""

    name: str
    api_key: Optional[str] = None
    model: str = ""
    base_url: Optional[str] = None
    endpoint_id: Optional[str] = None
    secret_key: Optional[str] = None
    group_id: Optional[str] = None
    drop_params: Optional[bool] = None
    extra_body: Optional[Dict[str, Any]] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CodegenConfig:
    """Code generation preferences."""

    language: str = "zh"
    style: str = "functional"
    include_tests: bool = True


@dataclass
class SandboxSettings:
    """Sandbox execution mode (Local / Docker / remote K8s)."""

    mode: str = "auto"
    remote_url: str = ""
    audit_log_dir: str = ""


@dataclass
class ComputerUseSettings:
    """Computer Use capability settings (inspired by Claude Computer Use)."""

    enabled: bool = False
    max_fallback_level: str = "computer_use"
    desktop_backend: str = "pyautogui"
    denied_categories: list = field(default_factory=lambda: ["financial", "credentials"])
    require_first_access_approval: bool = True
    scheduler_enabled: bool = True
    scheduler_max_concurrent: int = 5


@dataclass
class ExtensionRegistryConfig:
    """Configuration for a single extension registry source."""

    name: str = ""
    url: str = ""
    type: str = "agx"


@dataclass
class ExtensionsConfig:
    """Extensions ecosystem configuration.

    Attributes:
        registries: List of registry sources to search and install from.
        scan_dirs: Extra directories to scan for bundles (path strings, ~ supported).
    """

    registries: list = field(default_factory=list)
    scan_dirs: list = field(default_factory=list)


@dataclass
class LongRunSettings:
    """Optional Symphony-style long-running task orchestration."""

    enabled: bool = False
    workspace_root: str = "~/.agenticx/task-workspaces"
    stall_threshold_sec: float = 300.0
    poll_interval_sec: float = 30.0
    worker_session_id: str = "__longrun_worker__"
    linear_api_key: str = ""
    linear_team_ids: str = ""


@dataclass
class PermissionsConfig:
    """Tool execution permission settings.

    Attributes:
        mode: Permission mode — ``default`` (ask for writes), ``plan`` (read-only),
              ``full_auto`` (allow everything).
        path_rules: List of ``{pattern, allow}`` dicts for file-path-level rules.
        denied_commands: fnmatch patterns for blocked shell commands.
        denied_tools: Explicit tool deny list.
        allowed_tools: Explicit tool allow list.
    """

    mode: str = "default"
    path_rules: list = field(default_factory=list)
    denied_commands: list = field(default_factory=list)
    denied_tools: list = field(default_factory=list)
    allowed_tools: list = field(default_factory=list)


@dataclass
class AgxConfig:
    """Top-level AGX config model."""

    version: str = "1"
    default_provider: str = "openai"
    providers: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    codegen: CodegenConfig = field(default_factory=CodegenConfig)
    sandbox: SandboxSettings = field(default_factory=SandboxSettings)
    workspace_dir: str = "~/.agenticx/workspace"
    extensions: ExtensionsConfig = field(default_factory=ExtensionsConfig)
    computer_use: ComputerUseSettings = field(default_factory=ComputerUseSettings)
    permissions: PermissionsConfig = field(default_factory=PermissionsConfig)
    longrun: LongRunSettings = field(default_factory=LongRunSettings)
    # Built-in web search (duckduckgo + optional API providers); see studio web_search routes.
    web_search: Dict[str, Any] = field(default_factory=dict)

    def get_provider(self, name: Optional[str] = None) -> ProviderConfig:
        """Get provider config by name or default provider."""
        provider_name = (name or self.default_provider or "openai").lower()
        raw = dict(self.providers.get(provider_name, {}))
        return ProviderConfig(
            name=provider_name,
            api_key=raw.pop("api_key", None),
            model=raw.pop(
                "model",
                SUPPORTED_PROVIDERS.get(provider_name, {}).get("default_model", ""),
            ),
            base_url=raw.pop("base_url", None),
            endpoint_id=raw.pop("endpoint_id", None),
            secret_key=raw.pop("secret_key", None),
            group_id=raw.pop("group_id", None),
            drop_params=raw.pop("drop_params", None),
            extra_body=raw.pop("extra_body", None) or None,
            extra=raw,
        )


class _ConfigManagerMeta(type):
    """让 GLOBAL_CONFIG_PATH 在**读取时**解析，而不是 import 时。

    原来它是类属性 ``Path.home() / ".agenticx" / "config.yaml"``，import 那一刻就定死了。
    tests/conftest.py 把 HOME 指到沙箱是用例开始时才生效的，拦不住它——于是测试读的是
    开发者真实的 config.yaml，**里面有各家 provider 的 API key**。后果不只是脏数据：
    测试会拿真实凭证去打真实端点，之前有一条用例就卡在对内网网关的连接上不动。

    元类的 __getattr__ 只在正常查找失败时才走，所以
    ``monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp)`` 这类既有写法照常
    生效（它往类字典里塞值），撤销后又回落到这里。
    """

    def __getattr__(cls, name: str):
        if name == "GLOBAL_CONFIG_PATH":
            return Path.home() / ".agenticx" / "config.yaml"
        raise AttributeError(
            f"type object {cls.__name__!r} has no attribute {name!r}"
        )


class ConfigManager(metaclass=_ConfigManagerMeta):
    """Manager for AGX user/project configuration."""

    PROJECT_CONFIG_PATH = Path(".agenticx/config.yaml")

    #: 解析结果缓存：path -> (stat 指纹, 解析出来的 dict)。
    #:
    #: get_value() 每次都会把全局 + 项目两份配置**重新从磁盘解析一遍**，而它在读路径上
    #: 被调用得非常频繁：实测一次上下文用量估算触发 36 次 get_value / 57 次
    #: yaml.safe_load，占掉那一次请求 584ms 里的 558ms（96%）。配置文件几乎不变，
    #: 反复解析纯属浪费。
    #:
    #: 指纹用 (mtime_ns, size, inode)：任一变化就重新解析。写入方向由 _dump_yaml 主动
    #: 失效，不依赖时间戳精度。
    _yaml_cache: Dict[Path, Tuple[Tuple[int, int, int], Dict[str, Any]]] = {}
    _yaml_cache_lock = threading.Lock()

    @classmethod
    def _load_yaml(cls, path: Path) -> Dict[str, Any]:
        try:
            st = path.stat()
        except OSError:
            # 文件不存在（或读不到 stat）：和原来一样当作空配置，并清掉可能的旧缓存。
            cls._invalidate_yaml_cache(path)
            return {}
        fingerprint = (st.st_mtime_ns, st.st_size, st.st_ino)
        with cls._yaml_cache_lock:
            cached = cls._yaml_cache.get(path)
        if cached is not None and cached[0] == fingerprint:
            # 返回深拷贝：调用方（_deep_merge 等）会就地改这个 dict，不能让它污染缓存。
            return copy.deepcopy(cached[1])

        with path.open("r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
        if not isinstance(loaded, dict):
            raise ValueError(f"Config at {path} must be a YAML object")
        with cls._yaml_cache_lock:
            cls._yaml_cache[path] = (fingerprint, copy.deepcopy(loaded))
        return loaded

    @classmethod
    def _invalidate_yaml_cache(cls, path: Optional[Path] = None) -> None:
        """写入后主动失效。``None`` 清空全部（测试换 GLOBAL_CONFIG_PATH 时用得上）。"""
        with cls._yaml_cache_lock:
            if path is None:
                cls._yaml_cache.clear()
            else:
                cls._yaml_cache.pop(path, None)

    @classmethod
    def _dump_yaml(cls, path: Path, data: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)
        # 不靠 mtime 兜底：同一纳秒内先写后读理论上会读到陈旧值。
        cls._invalidate_yaml_cache(path)

    @classmethod
    def _deep_merge(cls, base: Dict[str, Any], overlay: Dict[str, Any]) -> Dict[str, Any]:
        merged = dict(base)
        for key, value in overlay.items():
            if (
                key in merged
                and isinstance(merged[key], dict)
                and isinstance(value, dict)
            ):
                merged[key] = cls._deep_merge(merged[key], value)
            else:
                merged[key] = value
        return merged

    @classmethod
    def _env_fallback(cls, config: AgxConfig) -> AgxConfig:
        providers = dict(config.providers)
        for provider_name, (env_key, default_model) in ENV_PROVIDER_MAP.items():
            value = os.getenv(env_key)
            if not value:
                continue
            provider_cfg = dict(providers.get(provider_name, {}))
            provider_cfg.setdefault("api_key", value)
            provider_cfg.setdefault("model", default_model)
            providers[provider_name] = provider_cfg
            if config.default_provider == "openai" and provider_name != "openai":
                # Keep explicit config precedence. This only affects empty configs.
                if not config.providers:
                    config.default_provider = provider_name
        if os.getenv("OPENAI_API_KEY") and not providers.get("openai", {}).get("api_key"):
            providers.setdefault("openai", {})["api_key"] = os.getenv("OPENAI_API_KEY")
            providers["openai"].setdefault("model", "gpt-4o")

        config.providers = providers
        return config

    @classmethod
    def load(cls) -> AgxConfig:
        """Load merged config (global + project + env fallback)."""
        global_data = cls._load_yaml(cls.GLOBAL_CONFIG_PATH)
        project_data = cls._load_yaml(cls.PROJECT_CONFIG_PATH)
        merged = cls._deep_merge(global_data, project_data)
        return cls._from_raw_dict(merged)

    @classmethod
    def load_scope(cls, scope: str = "global") -> AgxConfig:
        """Load config from a single scope without cross-scope merging."""
        if scope not in {"global", "project"}:
            raise ValueError("scope must be 'global' or 'project'")
        raw = cls._load_yaml(cls.GLOBAL_CONFIG_PATH if scope == "global" else cls.PROJECT_CONFIG_PATH)
        return cls._from_raw_dict(raw)

    @classmethod
    def _from_raw_dict(cls, merged: Dict[str, Any]) -> AgxConfig:
        """Build AgxConfig object from raw dict and apply env fallback."""
        codegen_raw = merged.get("codegen", {}) or {}
        if not isinstance(codegen_raw, dict):
            codegen_raw = {}
        workspace_raw = merged.get("workspace_dir")
        workspace_dir = "~/.agenticx/workspace"
        if isinstance(workspace_raw, str) and workspace_raw.strip():
            workspace_dir = workspace_raw.strip()

        sandbox_raw = merged.get("sandbox", {}) or {}
        if not isinstance(sandbox_raw, dict):
            sandbox_raw = {}

        cu_raw = merged.get("computer_use", {}) or {}
        if not isinstance(cu_raw, dict):
            cu_raw = {}

        longrun_raw = merged.get("longrun", {}) or {}
        if not isinstance(longrun_raw, dict):
            longrun_raw = {}

        web_search_raw = merged.get("web_search", {}) or {}
        if not isinstance(web_search_raw, dict):
            web_search_raw = {}

        config = AgxConfig(
            version=str(merged.get("version", "1")),
            default_provider=str(merged.get("default_provider", "openai")).lower(),
            providers=dict(merged.get("providers", {}) or {}),
            codegen=CodegenConfig(
                language=str(codegen_raw.get("language", "zh")),
                style=str(codegen_raw.get("style", "functional")),
                include_tests=bool(codegen_raw.get("include_tests", True)),
            ),
            sandbox=SandboxSettings(
                mode=str(sandbox_raw.get("mode", "auto")).lower(),
                remote_url=str(sandbox_raw.get("remote_url", "") or ""),
                audit_log_dir=str(sandbox_raw.get("audit_log_dir", "") or ""),
            ),
            workspace_dir=workspace_dir,
            computer_use=ComputerUseSettings(
                enabled=bool(cu_raw.get("enabled", False)),
                max_fallback_level=str(cu_raw.get("max_fallback_level", "computer_use")),
                desktop_backend=str(cu_raw.get("desktop_backend", "pyautogui")),
                denied_categories=list(cu_raw.get("denied_categories", ["financial", "credentials"])),
                require_first_access_approval=bool(cu_raw.get("require_first_access_approval", True)),
                scheduler_enabled=bool(cu_raw.get("scheduler_enabled", True)),
                scheduler_max_concurrent=int(cu_raw.get("scheduler_max_concurrent", 5)),
            ),
            longrun=LongRunSettings(
                enabled=bool(longrun_raw.get("enabled", False)),
                workspace_root=str(longrun_raw.get("workspace_root", "~/.agenticx/task-workspaces") or "").strip()
                or "~/.agenticx/task-workspaces",
                stall_threshold_sec=float(longrun_raw.get("stall_threshold_sec", 300.0) or 300.0),
                poll_interval_sec=float(longrun_raw.get("poll_interval_sec", 30.0) or 30.0),
                worker_session_id=str(
                    longrun_raw.get("worker_session_id", "__longrun_worker__") or "__longrun_worker__"
                ).strip()
                or "__longrun_worker__",
                linear_api_key=str(longrun_raw.get("linear_api_key", "") or "").strip(),
                linear_team_ids=str(longrun_raw.get("linear_team_ids", "") or "").strip(),
            ),
            web_search=dict(web_search_raw),
        )
        return cls._env_fallback(config)

    @classmethod
    def save(cls, config: AgxConfig, scope: str = "global") -> Path:
        """Save config to global or project scope."""
        path = cls.GLOBAL_CONFIG_PATH if scope == "global" else cls.PROJECT_CONFIG_PATH
        payload = asdict(config)
        cls._dump_yaml(path, payload)
        return path

    @classmethod
    def _get_nested(cls, data: Dict[str, Any], key: str) -> Any:
        current: Any = data
        for part in key.split("."):
            if not isinstance(current, dict) or part not in current:
                return None
            current = current[part]
        return current

    @classmethod
    def _set_nested(cls, data: Dict[str, Any], key: str, value: Any) -> Dict[str, Any]:
        current = data
        parts = key.split(".")
        for part in parts[:-1]:
            child = current.get(part)
            if not isinstance(child, dict):
                child = {}
                current[part] = child
            current = child
        current[parts[-1]] = value
        return data

    @classmethod
    def set_value(cls, key: str, value: Any, scope: str = "global") -> Path:
        """Set a dotted key and save."""
        path = cls.GLOBAL_CONFIG_PATH if scope == "global" else cls.PROJECT_CONFIG_PATH
        data = cls._load_yaml(path)
        cls._set_nested(data, key, value)
        cls._dump_yaml(path, data)
        return path

    @classmethod
    def update_section(
        cls,
        section: str,
        key: str,
        patch: Dict[str, Any],
        scope: str = "global",
    ) -> Path:
        """Deep-merge ``patch`` into ``section.key`` and persist."""
        path = cls.GLOBAL_CONFIG_PATH if scope == "global" else cls.PROJECT_CONFIG_PATH
        data = cls._load_yaml(path)
        section_data = data.get(section)
        if not isinstance(section_data, dict):
            section_data = {}
        entry = section_data.get(key)
        if not isinstance(entry, dict):
            entry = {}
        section_data[key] = cls._deep_merge(entry, patch if isinstance(patch, dict) else {})
        data[section] = section_data
        cls._dump_yaml(path, data)
        return path

    @classmethod
    def set_cc_bridge_field(cls, field: str, value: Any) -> Path:
        """Write ``cc_bridge.<field>`` to global config.

        Merged config is global deep-merged with ``.agenticx/config.yaml``. If the
        project file also defines the same dotted key, update it so Studio saves
        match what ``ConfigManager.get_value`` returns (avoids project overlay
        silently overriding UI changes).
        """
        dotted = f"cc_bridge.{field}"
        global_data = cls._load_yaml(cls.GLOBAL_CONFIG_PATH)
        cls._set_nested(global_data, dotted, value)
        cls._dump_yaml(cls.GLOBAL_CONFIG_PATH, global_data)

        project_data = cls._load_yaml(cls.PROJECT_CONFIG_PATH)
        if cls._get_nested(project_data, dotted) is not None:
            cls._set_nested(project_data, dotted, value)
            cls._dump_yaml(cls.PROJECT_CONFIG_PATH, project_data)
        return cls.GLOBAL_CONFIG_PATH

    @classmethod
    def get_value(cls, key: str) -> Any:
        """Get a dotted key from merged global+project YAML.

        Uses raw YAML merge so keys not modeled on ``AgxConfig`` (e.g. ``mcp.*``,
        ``runtime.*``, ``notifications.*``) are still readable.
        """
        global_data = cls._load_yaml(cls.GLOBAL_CONFIG_PATH)
        project_data = cls._load_yaml(cls.PROJECT_CONFIG_PATH)
        merged_raw = cls._deep_merge(global_data, project_data)
        return cls._get_nested(merged_raw, key)

    @classmethod
    def masked_config(cls) -> Dict[str, Any]:
        """Return merged config with secret fields masked."""
        merged = asdict(cls.load())
        providers = merged.get("providers", {}) or {}
        for _, cfg in providers.items():
            if not isinstance(cfg, dict):
                continue
            for secret_field in ("api_key", "secret_key"):
                value = cfg.get(secret_field)
                if isinstance(value, str) and value:
                    cfg[secret_field] = cls._mask(value)
        ws = merged.get("web_search")
        if isinstance(ws, dict):
            prov = ws.get("providers")
            if isinstance(prov, dict):
                for _, pcfg in prov.items():
                    if not isinstance(pcfg, dict):
                        continue
                    for secret_field in ("api_key", "cx"):
                        value = pcfg.get(secret_field)
                        if isinstance(value, str) and value and secret_field == "api_key":
                            pcfg[secret_field] = cls._mask(value)
        return merged

    @staticmethod
    def _mask(value: str) -> str:
        if len(value) <= 8:
            return "****"
        return f"{value[:4]}...{value[-4:]}"

    @classmethod
    def list_provider_specs(cls) -> Dict[str, Dict[str, Any]]:
        """List supported provider requirements and defaults."""
        return SUPPORTED_PROVIDERS
