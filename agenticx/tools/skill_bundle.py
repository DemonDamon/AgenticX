"""
Skill Bundle Loader (Anthropic SKILL.md 规范兼容)

提供兼容 Anthropic Agent Skills 规范的技能包加载能力：
- 扫描 .agents/.agent/.claude 体系的 skills 目录
- 解析 SKILL.md 文件的 YAML Frontmatter
- 将技能封装为 BaseTool，支持 list/read 操作
- 支持渐进式披露（Progressive Disclosure）

设计参考：
- openskills (https://github.com/numman-ali/openskills) 的核心机制
- AgenticX shell_bundle.py 的设计模式

版权声明：内化自 openskills 项目（Apache-2.0 License），做了适配以融入 AgenticX。
"""

from __future__ import annotations

import logging
import os
import platform
import re
import shutil
import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, TYPE_CHECKING

from pydantic import BaseModel, Field  # type: ignore

from .base import BaseTool

if TYPE_CHECKING:
    from .tool_context import ToolContext, LlmRequest
    from ..core.discovery import DiscoveryBus
    from agenticx.core.config_watcher import ConfigWatcher

logger = logging.getLogger(__name__)


# =============================================================================
# Skill Gate — eligibility check (inspired by OpenClaw metadata.openclaw)
# =============================================================================

@dataclass
class SkillGate:
    """Eligibility gate for a skill.

    When specified in the SKILL.md frontmatter under
    ``metadata.agenticx.gate``, the gate is evaluated at scan time to decide
    whether the skill should be loaded.

    Inspired by OpenClaw's ``metadata.openclaw`` gate fields.

    Attributes:
        os: Allowed operating systems (e.g. ``["linux", "darwin"]``).
            Matched against ``platform.system().lower()``.  Empty = any OS.
        requires_bins: All listed binaries must be on ``$PATH``.
        requires_any_bins: At least one of the listed binaries must exist.
        requires_env: All listed environment variables must be set (non-empty).
        requires_config: Reserved for future config-key checks.
        always: If ``True``, the skill always passes gating.
    """

    os: List[str] = field(default_factory=list)
    requires_bins: List[str] = field(default_factory=list)
    requires_any_bins: List[str] = field(default_factory=list)
    requires_env: List[str] = field(default_factory=list)
    requires_config: List[str] = field(default_factory=list)
    always: bool = False


def check_skill_gate(gate: SkillGate) -> bool:
    """Evaluate a :class:`SkillGate` against the current environment.

    Returns ``True`` if the skill is eligible (all conditions met or gate
    is empty / ``always=True``).
    """
    if gate.always:
        return True
    if gate.os and platform.system().lower() not in [o.lower() for o in gate.os]:
        return False
    if gate.requires_bins and not all(shutil.which(b) for b in gate.requires_bins):
        return False
    if gate.requires_any_bins and not any(shutil.which(b) for b in gate.requires_any_bins):
        return False
    if gate.requires_env and not all(os.environ.get(e) for e in gate.requires_env):
        return False
    # requires_config: reserved — always passes for now
    return True


# =============================================================================
# SkillMetadata 数据结构
# =============================================================================

@dataclass
class SkillMetadata:
    """
    技能元数据。
    
    对应 openskills 的 Skill 接口，包含技能的核心描述信息。
    
    Attributes:
        name: 技能唯一标识符（来自 SKILL.md 的 YAML frontmatter）
        description: 技能描述（用于在技能列表中显示）
        base_dir: 技能根目录（包含 SKILL.md 和资源文件）
        skill_md_path: SKILL.md 文件的完整路径
        location: 技能位置类型（'project' 或 'global'）
        source: 技能来源标签（builtin/registry/bundle/cursor/claude/agents/agent_global/
            project_agents/project_agent/custom 等）
        gate: 门控规则（OpenClaw 风格）。空 gate 表示无限制。
    """
    name: str
    description: str
    base_dir: Path
    skill_md_path: Path
    location: str = "project"  # 'project' | 'global'
    source: str = "unknown"
    gate: SkillGate = field(default_factory=SkillGate)
    tag: Optional[str] = None
    icon: Optional[str] = None
    examples: List[str] = field(default_factory=list)
    requires: Dict[str, Any] = field(default_factory=dict)
    content_hash: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        skill_id = f"{self.source}:{self.name}" if self.source else self.name
        return {
            "skill_id": skill_id,
            "name": self.name,
            "description": self.description,
            "base_dir": str(self.base_dir),
            "skill_md_path": str(self.skill_md_path),
            "location": self.location,
            "source": self.source,
            "tag": self.tag,
            "icon": self.icon,
            "examples": list(self.examples),
            "requires": dict(self.requires),
            "content_hash": self.content_hash,
            "gate": {
                "os": self.gate.os,
                "requires_bins": self.gate.requires_bins,
                "requires_any_bins": self.gate.requires_any_bins,
                "requires_env": self.gate.requires_env,
                "requires_config": self.gate.requires_config,
                "always": self.gate.always,
            },
        }


# =============================================================================
# Skill scan paths & source inference (Desktop settings + provenance)
# =============================================================================

_SKILL_BUNDLE_FILE = Path(__file__).resolve()
_SKILL_PACKAGE_SKILLS_DIR = _SKILL_BUNDLE_FILE.parent.parent / "skills"

# Presets shown in Desktop (third-party roots); toggled via skills.preset_paths in config.
SKILL_SCAN_PRESET_DEFAULTS: List[Dict[str, Any]] = [
    {
        "id": "cursor_skills",
        "label": "Cursor Skills",
        "path": "~/.cursor/skills",
        "enabled": True,
    },
    {
        "id": "claude_skills_home",
        "label": "Claude Skills",
        "path": "~/.claude/skills",
        "enabled": True,
    },
    {
        "id": "agents_home",
        "label": "Agents Global",
        "path": "~/.agents/skills",
        "enabled": False,
    },
]

# Higher wins when duplicated skill names appear across roots.
# This ensures explicit preset sources (e.g. Cursor/Claude) can override
# earlier scanned mirror copies with the same `name`.
_SKILL_SOURCE_PRIORITY: Dict[str, int] = {
    "cursor": 100,
    "claude": 95,
    "agents": 90,
    "agent_global": 80,
    "project_agents": 70,
    "project_agent": 65,
    "agenticx": 60,
    "registry": 55,
    "bundle": 50,
    "agent_created": 45,
    "builtin": 40,
    "custom": 10,
    "unknown": 0,
}

# Substrings in normalized path (posix, lower); first match wins. More specific first.
# Note: ``~/.agents/skills`` vs project ``./.agents/skills`` are distinguished in
# :func:`infer_skill_source` — disabling the "Agents Global" preset only stops the
# home directory; project ``.agents/skills`` remains a core scan root.
_SKILL_SOURCE_FRAGMENTS: List[tuple[str, str]] = [
    (".agenticx/skills/registry", "registry"),
    (".agenticx/skills/bundles", "bundle"),
    (".agenticx/skills/agent-created", "agent_created"),
    (".agenticx/skills", "agenticx"),
    ("/.cursor/skills", "cursor"),
    ("/.cursor/plugins", "cursor"),
    ("/.claude/skills", "claude"),
    ("/.claude/plugins", "claude"),
]


def infer_skill_source(base_dir: Path, builtin_root: Optional[Path] = None) -> str:
    """Derive a stable ``source`` label from the skill package directory.

    Checks **both** the original (possibly symlinked) path and the resolved
    real path so that symlinks like ``~/.claude/skills/foo -> ~/mySkills/foo``
    are still recognised as ``claude``.
    """
    root = builtin_root or _SKILL_PACKAGE_SKILLS_DIR
    try:
        bd = base_dir.resolve()
        br = root.resolve()
        bd.relative_to(br)
        return "builtin"
    except (ValueError, OSError):
        pass

    try:
        bd = base_dir.resolve()
    except Exception:
        bd = base_dir

    # Build two normalised path strings: original (symlink) + resolved (real).
    orig_norm = str(base_dir).replace("\\", "/").lower()
    try:
        resolved_norm = str(bd).replace("\\", "/").lower()
    except Exception:
        resolved_norm = orig_norm
    norms = {orig_norm, resolved_norm}

    # Preset ``~/.agents/skills`` only — not repo ``./.agents/skills``.
    try:
        bd.relative_to((Path.home() / ".agents" / "skills").resolve())
        return "agents"
    except (ValueError, OSError):
        pass
    if any("/.agents/skills" in n and str(Path.home()).replace("\\", "/").lower() in n
           for n in norms if "/.agents/skills" in n):
        for n in norms:
            home_prefix = str(Path.home()).replace("\\", "/").lower()
            if n.startswith(home_prefix) and "/.agents/skills" in n:
                return "agents"

    # Core path ``~/.agent/skills`` (always scanned; separate from ``.agents``).
    try:
        bd.relative_to((Path.home() / ".agent" / "skills").resolve())
        return "agent_global"
    except (ValueError, OSError):
        pass

    # Fragment matching — match against EITHER original or resolved path.
    for fragment, src in _SKILL_SOURCE_FRAGMENTS:
        for n in norms:
            if fragment in n:
                return src

    for n in norms:
        if "/.agents/skills" in n:
            return "project_agents"
        if "/.agent/skills" in n:
            return "project_agent"

    return "custom"


def _expand_skill_path(path_str: str) -> Path:
    s = str(path_str).strip()
    if not s:
        return Path()
    return Path(os.path.expanduser(s))


def _normalize_preset_paths_from_config(raw: Any) -> Optional[List[Dict[str, Any]]]:
    """Return merged preset list or None if config key is unset (use code defaults)."""
    if raw is None:
        return None
    if not isinstance(raw, list):
        return None
    enabled_by_id: Dict[str, bool] = {}
    for item in raw:
        if isinstance(item, dict) and str(item.get("id", "")).strip():
            enabled_by_id[str(item["id"]).strip()] = bool(item.get("enabled", True))
    return [
        {
            "id": d["id"],
            "label": d["label"],
            "path": d["path"],
            "enabled": enabled_by_id.get(d["id"], d["enabled"]),
        }
        for d in SKILL_SCAN_PRESET_DEFAULTS
    ]


def _normalize_custom_paths_from_config(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, str) and raw.strip():
        return [raw.strip()]
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    for x in raw:
        s = str(x).strip()
        if s:
            out.append(s)
    return out


def _normalize_preferred_sources_from_config(raw: Any) -> Dict[str, str]:
    if raw is None or not isinstance(raw, dict):
        return {}
    out: Dict[str, str] = {}
    for key, value in raw.items():
        name = str(key).strip()
        source = str(value).strip()
        if not name or not source:
            continue
        out[name] = source
    return out


def _normalize_disabled_skills_from_config(raw: Any) -> List[str]:
    """Normalize ``skills.disabled`` to a sorted unique list of skill names."""
    if raw is None:
        return []
    if isinstance(raw, str) and raw.strip():
        return [raw.strip()]
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    out: List[str] = []
    for x in raw:
        name = str(x).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return sorted(out)


def get_skill_scan_settings_from_config() -> tuple[
    List[Dict[str, Any]], List[str], Dict[str, str], List[str]
]:
    """Read skill scan settings and ``skills.disabled`` from merged YAML."""
    try:
        from agenticx.cli.config_manager import ConfigManager
    except Exception:
        return [dict(p) for p in SKILL_SCAN_PRESET_DEFAULTS], [], {}, []

    merged_presets = _normalize_preset_paths_from_config(
        ConfigManager.get_value("skills.preset_paths")
    )
    if merged_presets is None:
        presets = [dict(p) for p in SKILL_SCAN_PRESET_DEFAULTS]
    else:
        presets = merged_presets
    custom = _normalize_custom_paths_from_config(ConfigManager.get_value("skills.custom_paths"))
    preferred = _normalize_preferred_sources_from_config(
        ConfigManager.get_value("skills.preferred_sources")
    )
    disabled = _normalize_disabled_skills_from_config(
        ConfigManager.get_value("skills.disabled")
    )
    return presets, custom, preferred, disabled


def get_disabled_skill_names_set() -> Set[str]:
    """Return the set of globally disabled skill names (from config)."""
    try:
        _, _, _, disabled_list = get_skill_scan_settings_from_config()
    except Exception:
        return set()
    return set(disabled_list)


def filter_skills_by_enablement(
    skills: List[SkillMetadata],
    *,
    disabled_names: Optional[Set[str]] = None,
    avatar_skills_enabled: Optional[Dict[str, bool]] = None,
) -> List[SkillMetadata]:
    """Apply global disabled list and optional per-avatar overrides."""
    dn = disabled_names if disabled_names is not None else get_disabled_skill_names_set()
    out: List[SkillMetadata] = []
    for s in skills:
        if s.name in dn:
            continue
        if avatar_skills_enabled:
            if s.name in avatar_skills_enabled and not avatar_skills_enabled[s.name]:
                continue
        out.append(s)
    return out


def build_skill_search_paths() -> List[Path]:
    """Core paths + enabled presets + custom paths (Desktop / API default)."""
    core: List[Path] = [
        Path("./.agents/skills"),
        Path("./.agent/skills"),
        Path("./.claude/skills"),
        Path.home() / ".agenticx" / "skills",
        Path.home() / ".agent" / "skills",
        _SKILL_PACKAGE_SKILLS_DIR,
    ]
    presets, custom_strs, _preferred, _ = get_skill_scan_settings_from_config()
    extra: List[Path] = []
    agents_home_enabled = True
    for p in presets:
        if p.get("id") == "agents_home":
            agents_home_enabled = bool(p.get("enabled", True))
        if not p.get("enabled", True):
            continue
        path_str = str(p.get("path", "")).strip()
        if not path_str:
            continue
        extra.append(_expand_skill_path(path_str))
    for s in custom_strs:
        extra.append(_expand_skill_path(s))

    # If "~/.agent/skills" resolves to "~/.agents/skills", and the user disabled
    # "Agents Global", avoid accidentally re-introducing the same directory via core.
    if not agents_home_enabled:
        try:
            agents_root = (Path.home() / ".agents" / "skills").resolve()
            core = [
                p
                for p in core
                if not (
                    p.is_absolute()
                    and str(p).replace("\\", "/").endswith("/.agent/skills")
                    and p.resolve() == agents_root
                )
            ]
        except Exception:
            pass

    # Keep ordering, but dedupe by resolved path.
    out: List[Path] = []
    seen: set[str] = set()
    for p in core + extra:
        try:
            key = str(p.resolve(strict=False))
        except Exception:
            key = str(p.expanduser())
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def persist_skill_scan_settings(
    preset_paths: List[Dict[str, Any]],
    custom_paths: List[str],
    preferred_sources: Optional[Dict[str, str]] = None,
    disabled_skills: Optional[List[str]] = None,
) -> None:
    """Write skill scan settings to global config.

    When ``disabled_skills`` is None, the existing ``skills.disabled`` value is kept.
    """
    from agenticx.cli.config_manager import ConfigManager

    enabled_by_id: Dict[str, bool] = {}
    for item in preset_paths:
        if isinstance(item, dict) and str(item.get("id", "")).strip():
            enabled_by_id[str(item["id"]).strip()] = bool(item.get("enabled", True))
    cleaned_presets = [
        {
            "id": d["id"],
            "label": d["label"],
            "path": d["path"],
            "enabled": enabled_by_id.get(d["id"], d["enabled"]),
        }
        for d in SKILL_SCAN_PRESET_DEFAULTS
    ]
    custom_clean: List[str] = []
    seen: set[str] = set()
    for s in custom_paths:
        t = str(s).strip()
        if not t or t in seen:
            continue
        seen.add(t)
        custom_clean.append(t)
    preferred_clean = _normalize_preferred_sources_from_config(preferred_sources or {})
    ConfigManager.set_value("skills.preset_paths", cleaned_presets)
    ConfigManager.set_value("skills.custom_paths", custom_clean)
    ConfigManager.set_value("skills.preferred_sources", preferred_clean)
    if disabled_skills is not None:
        disabled_clean = _normalize_disabled_skills_from_config(disabled_skills)
        ConfigManager.set_value("skills.disabled", disabled_clean)


def skill_scan_settings_payload() -> Dict[str, Any]:
    """API payload for GET /api/skills/settings."""
    presets, custom, preferred, disabled = get_skill_scan_settings_from_config()
    return {
        "preset_paths": presets,
        "custom_paths": custom,
        "preferred_sources": preferred,
        "disabled_skills": disabled,
    }


# =============================================================================
# P0-2: SkillBundleLoader 扫描与解析
# =============================================================================

class SkillBundleLoader:
    """
    兼容 Anthropic SKILL.md 规范的技能包加载器。
    
    参考 ShellBundleLoader 的设计模式，提供：
    - 多路径扫描（项目级 + 全局级）
    - YAML Frontmatter 解析
    - 技能去重（同名技能按优先级保留第一个）
    - DiscoveryBus 集成（可选）
    
    默认扫描路径由 :func:`build_skill_search_paths` 生成：核心路径（项目 .agents/.agent/.claude、
    ``~/.agent/skills``、AgenticX bundles/registry、内置包内 skills）始终启用；第三方根目录
    （Cursor / Claude / ``~/.agents/skills`` 等）由 ``~/.agenticx/config.yaml`` 中
    ``skills.preset_paths`` 逐条开关；另支持 ``skills.custom_paths``。

    Example:
        >>> loader = SkillBundleLoader()
        >>> skills = loader.scan()
        >>> for skill in skills:
        ...     print(f"{skill.name}: {skill.description}")
    """
    
    # Built-in skills shipped with the agenticx package (lowest scan priority in core list)
    _BUILTIN_SKILLS_DIR = _SKILL_PACKAGE_SKILLS_DIR

    def __init__(
        self,
        search_paths: Optional[List[Path]] = None,
        discovery_bus: Optional["DiscoveryBus"] = None,
        execution_backend: Optional[Any] = None,
        registry_url: Optional[str] = None,
        config_watcher: Optional["ConfigWatcher"] = None,
        preferred_sources: Optional[Dict[str, str]] = None,
    ):
        """
        初始化技能加载器。
        
        Args:
            search_paths: 自定义搜索路径列表（None 使用 :func:`build_skill_search_paths`）
            discovery_bus: DiscoveryBus 实例（用于发布技能发现事件）
            execution_backend: SkillExecutionBackend 实例（可选，用于控制技能执行方式）
        """
        self.search_paths = (
            search_paths if search_paths is not None else build_skill_search_paths()
        )
        self.discovery_bus = discovery_bus
        self.execution_backend = execution_backend
        self.registry_url = registry_url
        self.config_watcher = config_watcher
        self.preferred_sources = dict(preferred_sources or {})
        self._skills: Dict[str, SkillMetadata] = {}
        self._skill_variants: Dict[str, List[SkillMetadata]] = {}
        self._scanned = False
        self._watcher_hook_registered = False

        if self.config_watcher:
            self._register_config_watcher()
    
    def scan(self) -> List[SkillMetadata]:
        """
        扫描所有路径，发现 SKILL.md 并解析元数据。
        
        Returns:
            已发现的技能元数据列表
        """
        if self._scanned:
            return list(self._skills.values())
        
        presets, _custom_paths, config_preferred_sources, _ = (
            get_skill_scan_settings_from_config()
        )
        preferred_sources = self.preferred_sources or config_preferred_sources
        self._skill_variants.clear()
        disabled_roots: List[Path] = []
        disabled_sources: set[str] = set()
        preset_source_map: Dict[str, str] = {
            "cursor_skills": "cursor",
            "claude_skills_home": "claude",
            "agents_home": "agents",
        }
        for p in presets:
            if bool(p.get("enabled", True)):
                continue
            sid = str(p.get("id", "")).strip()
            mapped_source = preset_source_map.get(sid)
            if mapped_source:
                disabled_sources.add(mapped_source)
            raw_path = str(p.get("path", "")).strip()
            if not raw_path:
                continue
            try:
                disabled_roots.append(Path(os.path.expanduser(raw_path)).resolve(strict=False))
            except Exception:
                disabled_roots.append(Path(os.path.expanduser(raw_path)))
        
        for path in self.search_paths:
            resolved_path = path.resolve() if not path.is_absolute() else path
            
            if not resolved_path.exists():
                logger.debug(f"Skill search path not found: {resolved_path}")
                continue
            
            if not resolved_path.is_dir():
                logger.debug(f"Skill search path is not a directory: {resolved_path}")
                continue
            
            # 判断是项目级还是全局级（按“配置路径是相对/绝对”判定，避免 cwd 影响）
            is_project = not path.is_absolute()
            location = "project" if is_project else "global"
            
            # 遍历目录下的子目录
            try:
                for skill_dir in resolved_path.iterdir():
                    if not skill_dir.is_dir():
                        continue

                    # Hard-filter disabled preset roots by resolved path. This prevents
                    # symlink/alias reintroduction (e.g. ~/.agent/skills/* -> ~/.agents/skills/*).
                    if disabled_roots:
                        try:
                            resolved_skill_dir = skill_dir.resolve(strict=False)
                        except Exception:
                            resolved_skill_dir = skill_dir
                        blocked = False
                        for root in disabled_roots:
                            try:
                                resolved_skill_dir.relative_to(root)
                                blocked = True
                                break
                            except Exception:
                                continue
                        if blocked:
                            logger.debug("Skip skill under disabled preset root: %s", skill_dir)
                            continue
                    
                    # 跳过隐藏目录
                    if skill_dir.name.startswith("."):
                        continue

                    # Collect candidate (skill_dir, skill_md) pairs.
                    # If the first-level dir has SKILL.md, use it directly;
                    # otherwise scan one level deeper (for grouping dirs like
                    # agent-created/, registry/, bundles/).
                    candidates: List[tuple[Path, Path]] = []
                    first_level_md = skill_dir / "SKILL.md"
                    if first_level_md.exists():
                        candidates.append((skill_dir, first_level_md))
                    else:
                        try:
                            for sub in skill_dir.iterdir():
                                if not sub.is_dir() or sub.name.startswith("."):
                                    continue
                                sub_md = sub / "SKILL.md"
                                if sub_md.exists():
                                    candidates.append((sub, sub_md))
                        except OSError:
                            pass

                    for cand_dir, cand_md in candidates:

                        # Hard-filter disabled roots for nested candidates
                        if disabled_roots:
                            try:
                                resolved_cand = cand_dir.resolve(strict=False)
                            except Exception:
                                resolved_cand = cand_dir
                            blocked_inner = False
                            for root in disabled_roots:
                                try:
                                    resolved_cand.relative_to(root)
                                    blocked_inner = True
                                    break
                                except Exception:
                                    continue
                            if blocked_inner:
                                continue

                        # 解析技能元数据
                        meta = self._parse_skill_md(cand_md, cand_dir, location)
                        if meta is None:
                            logger.warning(f"Failed to parse SKILL.md: {cand_md}")
                            continue

                        # Source-level guard
                        if meta.source in disabled_sources:
                            logger.debug(
                                "Skip skill from disabled source '%s': %s",
                                meta.source,
                                cand_dir,
                            )
                            continue

                        variants = self._skill_variants.setdefault(meta.name, [])
                        if not any(
                            v.source == meta.source and str(v.base_dir) == str(meta.base_dir)
                            for v in variants
                        ):
                            variants.append(meta)

                        existing = self._skills.get(meta.name)
                        if existing is not None:
                            preferred_source = str(preferred_sources.get(meta.name, "")).strip()
                            existing_is_preferred = bool(preferred_source) and existing.source == preferred_source
                            incoming_is_preferred = bool(preferred_source) and meta.source == preferred_source
                            if existing_is_preferred and not incoming_is_preferred:
                                continue
                            if incoming_is_preferred and not existing_is_preferred:
                                logger.info(
                                    "Skill '%s' duplicate replaced by preferred source=%s",
                                    meta.name,
                                    meta.source,
                                )
                            else:
                                existing_pri = _SKILL_SOURCE_PRIORITY.get(
                                    getattr(existing, "source", "unknown"),
                                    0,
                                )
                                incoming_pri = _SKILL_SOURCE_PRIORITY.get(meta.source, 0)
                                if incoming_pri <= existing_pri:
                                    logger.debug(
                                        "Skill '%s' duplicate kept existing source=%s (pri=%s), skip incoming source=%s (pri=%s): %s",
                                        meta.name,
                                        getattr(existing, "source", "unknown"),
                                        existing_pri,
                                        meta.source,
                                        incoming_pri,
                                        cand_md,
                                    )
                                    continue
                                logger.info(
                                    "Skill '%s' duplicate replaced source=%s -> %s",
                                    meta.name,
                                    getattr(existing, "source", "unknown"),
                                    meta.source,
                                )

                        # Gate check
                        if not self._check_gate(meta.gate):
                            logger.warning(
                                "Skill '%s' failed gate check, skipping: %s",
                                meta.name, cand_md,
                            )
                            continue

                        self._skills[meta.name] = meta

                        self._publish_discovery(meta)
                        logger.info(f"Discovered skill: {meta.name} at {cand_dir}")
                    
            except PermissionError as e:
                logger.warning(f"Permission denied accessing {resolved_path}: {e}")
                continue
        
        self._scanned = True
        self._merge_remote_skills()
        return list(self._skills.values())
    
    def _parse_skill_md(
        self,
        skill_md: Path,
        base_dir: Path,
        location: str,
    ) -> Optional[SkillMetadata]:
        """
        解析 SKILL.md 的 YAML Frontmatter。
        
        SKILL.md 格式要求：
        ```
        ---
        name: skill-name
        description: Skill description here
        ---
        
        # Skill Instructions
        ...
        ```
        
        Args:
            skill_md: SKILL.md 文件路径
            base_dir: 技能根目录
            location: 位置类型 ('project' | 'global')
            
        Returns:
            SkillMetadata 或 None（解析失败时）
        """
        try:
            content = skill_md.read_text(encoding="utf-8")
        except Exception as e:
            logger.error(f"Failed to read {skill_md}: {e}")
            return None
        
        # 检查是否有 YAML frontmatter
        if not content.strip().startswith("---"):
            logger.warning(f"SKILL.md missing YAML frontmatter: {skill_md}")
            return None
        
        # 使用正则提取字段（简单实现，兼容 openskills 的做法）
        name_match = re.search(r"^name:\s*(.+?)$", content, re.MULTILINE)
        desc_match = re.search(r"^description:\s*(.+?)$", content, re.MULTILINE)
        
        if not name_match:
            logger.warning(f"SKILL.md missing 'name' field: {skill_md}")
            return None
        
        fm_text = self._extract_frontmatter(content)
        name = name_match.group(1).strip()
        description = desc_match.group(1).strip() if desc_match else ""
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        tag = self._parse_frontmatter_scalar(fm_text, "tag") or None
        icon = self._parse_frontmatter_scalar(fm_text, "icon") or None
        examples = self._parse_frontmatter_list(fm_text, "examples")
        requires = self._parse_requires_from_frontmatter(fm_text)
        
        # --- Parse gate from metadata.agenticx.gate (OpenClaw-inspired) ---
        gate = self._parse_gate_from_frontmatter(content)
        
        return SkillMetadata(
            name=name,
            description=description,
            base_dir=base_dir,
            skill_md_path=skill_md,
            location=location,
            source=infer_skill_source(base_dir),
            gate=gate,
            tag=tag,
            icon=icon,
            examples=examples,
            requires=requires,
            content_hash=content_hash,
        )
    
    # -----------------------------------------------------------------
    # Gate helpers (OpenClaw-inspired)
    # -----------------------------------------------------------------

    @staticmethod
    def _parse_gate_from_frontmatter(content: str) -> SkillGate:
        """Extract ``SkillGate`` fields from SKILL.md YAML frontmatter.

        Looks for lines like ``requires_env: ["KEY"]`` inside the ``---``
        delimited block.  Uses simple regex so we don't require a YAML
        library.  Unrecognised fields are silently ignored.
        """
        gate = SkillGate()

        # Extract the frontmatter block
        fm_text = SkillBundleLoader._extract_frontmatter(content)
        if not fm_text:
            return gate

        gate.os = SkillBundleLoader._parse_frontmatter_list(fm_text, "os")
        gate.requires_bins = SkillBundleLoader._parse_frontmatter_list(fm_text, "requires_bins")
        gate.requires_any_bins = SkillBundleLoader._parse_frontmatter_list(
            fm_text,
            "requires_any_bins",
        )
        gate.requires_env = SkillBundleLoader._parse_frontmatter_list(fm_text, "requires_env")
        gate.requires_config = SkillBundleLoader._parse_frontmatter_list(fm_text, "requires_config")

        always_match = re.search(r"^\s*always\s*:\s*(true|false)", fm_text, re.MULTILINE | re.IGNORECASE)
        if always_match:
            gate.always = always_match.group(1).lower() == "true"

        return gate

    @staticmethod
    def _extract_frontmatter(content: str) -> str:
        """Return frontmatter body text (without delimiters)."""
        fm_match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
        if not fm_match:
            return ""
        return fm_match.group(1)

    @staticmethod
    def _parse_frontmatter_list(frontmatter: str, key: str) -> List[str]:
        """Parse ``key: [a, b]`` style list from frontmatter."""
        if not frontmatter:
            return []
        match = re.search(rf"^\s*{key}\s*:\s*\[(.+?)\]", frontmatter, re.MULTILINE)
        if not match:
            return []
        raw = match.group(1)
        return [item.strip().strip("\"'") for item in raw.split(",") if item.strip()]

    @staticmethod
    def _parse_frontmatter_scalar(frontmatter: str, key: str) -> str:
        """Parse ``key: value`` scalar from frontmatter."""
        if not frontmatter:
            return ""
        match = re.search(rf"^\s*{key}\s*:\s*(.+?)$", frontmatter, re.MULTILINE)
        if not match:
            return ""
        return match.group(1).strip()

    @staticmethod
    def _parse_requires_from_frontmatter(frontmatter: str) -> Dict[str, Any]:
        """Parse simple nested requires block from frontmatter."""
        if not frontmatter:
            return {}
        match = re.search(
            r"^\s*requires\s*:\s*\n((?:[ \t]+.+\n?)*)",
            frontmatter,
            re.MULTILINE,
        )
        if not match:
            return {}
        block = match.group(1)
        tools = SkillBundleLoader._parse_frontmatter_list(block, "tools")
        plugins = SkillBundleLoader._parse_frontmatter_list(block, "plugins")
        out: Dict[str, Any] = {}
        if tools:
            out["tools"] = tools
        if plugins:
            out["plugins"] = plugins
        return out

    @staticmethod
    def _check_gate(gate: SkillGate) -> bool:
        """Evaluate a gate against the current environment.

        Convenience wrapper around the module-level :func:`check_skill_gate`.
        """
        return check_skill_gate(gate)

    def _publish_discovery(self, meta: SkillMetadata) -> None:
        """
        向 DiscoveryBus 发布技能发现事件（P1-1）。
        
        Args:
            meta: 技能元数据
        """
        if not self.discovery_bus:
            return
        
        try:
            from ..core.discovery import Discovery, DiscoveryType
            
            discovery = Discovery(
                type=DiscoveryType.CAPABILITY,
                name=f"skill:{meta.name}",
                description=meta.description,
                source_worker_id="skill_bundle_loader",
                data={
                    "base_dir": str(meta.base_dir),
                    "location": meta.location,
                },
                action_suggestions=[
                    f"使用 skill_manager 工具读取 '{meta.name}' 技能获取详细指令",
                ],
            )
            
            self.discovery_bus.publish_sync(discovery)
            logger.debug(f"Published discovery for skill: {meta.name}")
            
        except Exception as e:
            logger.warning(f"Failed to publish discovery for skill {meta.name}: {e}")

    def _register_config_watcher(self) -> None:
        """Register watcher callback once for auto-refresh on skill changes."""
        if self._watcher_hook_registered or not self.config_watcher:
            return

        def _on_change(path: Path) -> None:
            if self._is_skill_related_path(path):
                logger.info("Skill path changed (%s), refreshing skill bundle", path)
                self.refresh()

        self.config_watcher.on_change(_on_change)
        self._watcher_hook_registered = True

    def _is_skill_related_path(self, path: Path) -> bool:
        """Return True when a changed path is under any skill search path."""
        try:
            abs_path = path.resolve()
        except Exception:
            return False
        for search_path in self.search_paths:
            try:
                root = search_path.resolve() if not search_path.is_absolute() else search_path
                abs_path.relative_to(root)
                return True
            except ValueError:
                continue
            except Exception:
                continue
        return False

    def _merge_remote_skills(self) -> None:
        """Merge remote registry index into in-memory skills.

        Local skills always win for duplicate names.
        """
        if not self.registry_url:
            return
        try:
            from agenticx.skills.registry import SkillRegistryClient

            client = SkillRegistryClient(registry_url=self.registry_url)
            remote_entries = client.search()
            for entry in remote_entries:
                if entry.name in self._skills:
                    continue
                remote_base = Path.home() / ".agenticx" / "skills" / "registry" / entry.name
                remote_md = remote_base / "SKILL.md"
                self._skills[entry.name] = SkillMetadata(
                    name=entry.name,
                    description=entry.description,
                    base_dir=remote_base,
                    skill_md_path=remote_md,
                    location="global",
                    source="registry",
                    gate=SkillGate(),
                )
        except Exception as exc:
            logger.warning(
                "Failed to fetch remote skills from registry '%s': %s",
                self.registry_url,
                exc,
            )
    
    def get_skill(self, name: str) -> Optional[SkillMetadata]:
        """
        根据名称获取技能元数据。
        
        Args:
            name: 技能名称
            
        Returns:
            SkillMetadata 或 None
        """
        if not self._scanned:
            self.scan()
        return self._skills.get(name)
    
    def get_skill_content(self, name: str) -> Optional[str]:
        """
        读取技能的完整 SKILL.md 内容（渐进式披露）。
        
        返回格式与 openskills 的 `openskills read` 输出一致：
        ```
        Reading: skill-name
        Base directory: /path/to/skill
        
        [SKILL.md 完整内容]
        
        Skill read: skill-name
        ```
        
        Args:
            name: 技能名称
            
        Returns:
            格式化的技能内容，或 None（技能不存在时）
        """
        meta = self.get_skill(name)
        if not meta:
            return None
        
        try:
            content = meta.skill_md_path.read_text(encoding="utf-8")
            return (
                f"Reading: {name}\n"
                f"Base directory: {meta.base_dir}\n"
                f"\n"
                f"{content}\n"
                f"\n"
                f"Skill read: {name}"
            )
        except Exception as e:
            logger.error(f"Failed to read skill content for {name}: {e}")
            return None
    
    def list_skills(self) -> List[SkillMetadata]:
        """
        列出所有已发现的技能。
        
        Returns:
            技能元数据列表
        """
        if not self._scanned:
            self.scan()
        return list(self._skills.values())
    
    def refresh(self) -> List[SkillMetadata]:
        """
        强制重新扫描技能目录。
        
        Returns:
            已发现的技能元数据列表
        """
        self._skills.clear()
        self._skill_variants.clear()
        self._scanned = False
        return self.scan()

    def get_skill_variants(self, name: str) -> List[SkillMetadata]:
        """Return all discovered variants for a skill name."""
        if not self._scanned:
            self.scan()
        return list(self._skill_variants.get(name, []))


# =============================================================================
# P0-3: SkillTool 工具封装
# =============================================================================

class SkillToolArgs(BaseModel):
    """SkillTool 的参数模型。"""
    
    action: str = Field(
        description="操作类型：'list' 列出所有技能，'read' 读取指定技能内容"
    )
    skill_name: Optional[str] = Field(
        default=None,
        description="技能名称（action='read' 时必填）"
    )


class SkillTool(BaseTool):
    """
    智能体使用的技能管理工具。
    
    提供技能的发现和读取能力，实现 Anthropic Agent Skills 规范的渐进式披露：
    - list: 列出所有可用技能及其描述
    - read: 读取指定技能的完整指令
    
    通过 process_llm_request 实现渐进式 Prompt 注入（P1-2）。
    
    Example:
        >>> tool = SkillTool()
        >>> # 列出技能
        >>> result = tool.run(action="list")
        >>> # 读取技能
        >>> result = tool.run(action="read", skill_name="pdf")
    """
    
    def __init__(
        self,
        loader: Optional[SkillBundleLoader] = None,
        auto_scan: bool = True,
        **kwargs,
    ):
        """
        初始化技能管理工具。
        
        Args:
            loader: SkillBundleLoader 实例（None 则自动创建）
            auto_scan: 是否在初始化时自动扫描技能
            **kwargs: BaseTool 的其他参数
        """
        super().__init__(
            name="skill_manager",
            description=(
                "用于列出和读取高级技能指令。当你需要处理特定领域任务"
                "（如 PDF 处理、Excel 自动化、文档生成等）时，请先列出技能，"
                "然后读取相关技能获取详细操作指南。"
            ),
            args_schema=SkillToolArgs,
            **kwargs,
        )
        self.loader = loader or SkillBundleLoader()
        
        if auto_scan:
            self.loader.scan()
    
    def _run(self, **kwargs) -> str:
        """
        执行技能管理操作。
        
        Args:
            action: 操作类型 ('list' | 'read')
            skill_name: 技能名称（read 时必填）
            
        Returns:
            操作结果字符串
        """
        args = SkillToolArgs(**kwargs)
        
        if args.action == "list":
            return self._handle_list()
        elif args.action == "read":
            return self._handle_read(args.skill_name)
        else:
            return f"Invalid action: '{args.action}'. Use 'list' or 'read'."
    
    def _handle_list(self) -> str:
        """处理 list 操作。"""
        skills = self.loader.list_skills()
        
        if not skills:
            return (
                "No skills installed.\n"
                "Skills can be installed to:\n"
                "  ./.agents/skills/ (project)\n"
                "  ./.agent/skills/ (project)\n"
                "  ~/.agents/skills/ (global)\n"
                "  ~/.agent/skills/ (global)\n"
                "  ./.claude/skills/ (project)\n"
                "  ~/.claude/skills/ (global)"
            )
        
        # 按位置分组
        project_skills = [s for s in skills if s.location == "project"]
        global_skills = [s for s in skills if s.location == "global"]
        
        lines = ["Available skills:\n"]
        
        if project_skills:
            lines.append("Project skills:")
            for s in project_skills:
                extra = []
                if s.tag:
                    extra.append(f"tag={s.tag}")
                if s.icon:
                    extra.append(f"icon={s.icon}")
                suffix = f" ({', '.join(extra)})" if extra else ""
                lines.append(f"  - {s.name}: {s.description}{suffix}")
            lines.append("")
        
        if global_skills:
            lines.append("Global skills:")
            for s in global_skills:
                extra = []
                if s.tag:
                    extra.append(f"tag={s.tag}")
                if s.icon:
                    extra.append(f"icon={s.icon}")
                suffix = f" ({', '.join(extra)})" if extra else ""
                lines.append(f"  - {s.name}: {s.description}{suffix}")
        
        lines.append(f"\nTotal: {len(skills)} skill(s)")
        lines.append("Use action='read' with skill_name to load skill instructions.")
        
        return "\n".join(lines)
    
    def _handle_read(self, skill_name: Optional[str]) -> str:
        """处理 read 操作。"""
        if not skill_name:
            return "Error: skill_name is required for 'read' action."
        
        content = self.loader.get_skill_content(skill_name)
        
        if content is None:
            # 提供友好的错误提示
            available = [s.name for s in self.loader.list_skills()]
            if available:
                return (
                    f"Error: Skill '{skill_name}' not found.\n"
                    f"Available skills: {', '.join(available)}\n"
                    f"Use action='list' to see all skills."
                )
            else:
                return (
                    f"Error: Skill '{skill_name}' not found.\n"
                    "No skills are currently installed."
                )
        
        return content
    
    async def process_llm_request(
        self,
        tool_context: Optional["ToolContext"] = None,
        llm_request: Optional["LlmRequest"] = None,
    ) -> None:
        """
        在 LLM 调用前处理请求（P1-2 渐进式注入）。
        
        如果 tool_context.metadata 中存在 active_skill，
        则将该技能的完整指令注入到 LLM 请求的系统提示中。
        
        这实现了 Anthropic 的"渐进式披露"设计：
        技能指令只在 Agent 决定使用时才加载到上下文。
        
        Args:
            tool_context: 工具执行上下文
            llm_request: LLM 请求对象
        """
        if tool_context is None or llm_request is None:
            return
        
        # 检查是否有活跃技能
        active_skill = tool_context.metadata.get("active_skill")
        if not active_skill:
            return
        
        # 获取技能内容
        skill_content = self.loader.get_skill_content(active_skill)
        if not skill_content:
            logger.warning(f"Active skill '{active_skill}' not found")
            return
        
        # 注入技能指令到系统提示
        skill_block = (
            f"<skill_instructions skill=\"{active_skill}\">\n"
            f"{skill_content}\n"
            f"</skill_instructions>"
        )
        
        if hasattr(llm_request, 'append_system_prompt'):
            llm_request.append_system_prompt(skill_block)
            logger.debug(f"Injected skill instructions for: {active_skill}")
        elif hasattr(llm_request, 'system_prompt'):
            # 备选：直接修改 system_prompt
            if llm_request.system_prompt:
                llm_request.system_prompt = f"{llm_request.system_prompt}\n\n{skill_block}"
            else:
                llm_request.system_prompt = skill_block
            logger.debug(f"Injected skill instructions for: {active_skill}")

