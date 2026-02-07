"""
Skill Bundle Loader (Anthropic SKILL.md 规范兼容)

提供兼容 Anthropic Agent Skills 规范的技能包加载能力：
- 扫描 .agent/skills 和 .claude/skills 目录
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
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from pydantic import BaseModel, Field  # type: ignore

from .base import BaseTool

if TYPE_CHECKING:
    from .tool_context import ToolContext, LlmRequest
    from ..core.discovery import DiscoveryBus

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
        gate: 门控规则（OpenClaw 风格）。空 gate 表示无限制。
    """
    name: str
    description: str
    base_dir: Path
    skill_md_path: Path
    location: str = "project"  # 'project' | 'global'
    gate: SkillGate = field(default_factory=SkillGate)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        return {
            "name": self.name,
            "description": self.description,
            "base_dir": str(self.base_dir),
            "skill_md_path": str(self.skill_md_path),
            "location": self.location,
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
    
    搜索路径优先级（从高到低）：
    1. ./.agent/skills (项目级 universal)
    2. ~/.agent/skills (全局 universal)
    3. ./.claude/skills (项目级)
    4. ~/.claude/skills (全局)
    
    Example:
        >>> loader = SkillBundleLoader()
        >>> skills = loader.scan()
        >>> for skill in skills:
        ...     print(f"{skill.name}: {skill.description}")
    """
    
    # 默认搜索路径（按优先级排序）
    DEFAULT_SEARCH_PATHS = [
        Path("./.agent/skills"),
        Path.home() / ".agent" / "skills",
        Path("./.claude/skills"),
        Path.home() / ".claude" / "skills",
    ]
    
    def __init__(
        self,
        search_paths: Optional[List[Path]] = None,
        discovery_bus: Optional["DiscoveryBus"] = None,
        execution_backend: Optional[Any] = None,
    ):
        """
        初始化技能加载器。
        
        Args:
            search_paths: 自定义搜索路径列表（None 使用默认路径）
            discovery_bus: DiscoveryBus 实例（用于发布技能发现事件）
            execution_backend: SkillExecutionBackend 实例（可选，用于控制技能执行方式）
        """
        self.search_paths = search_paths or self.DEFAULT_SEARCH_PATHS
        self.discovery_bus = discovery_bus
        self.execution_backend = execution_backend
        self._skills: Dict[str, SkillMetadata] = {}
        self._scanned = False
    
    def scan(self) -> List[SkillMetadata]:
        """
        扫描所有路径，发现 SKILL.md 并解析元数据。
        
        Returns:
            已发现的技能元数据列表
        """
        if self._scanned:
            return list(self._skills.values())
        
        seen_names: set = set()
        
        for path in self.search_paths:
            resolved_path = path.resolve() if not path.is_absolute() else path
            
            if not resolved_path.exists():
                logger.debug(f"Skill search path not found: {resolved_path}")
                continue
            
            if not resolved_path.is_dir():
                logger.debug(f"Skill search path is not a directory: {resolved_path}")
                continue
            
            # 判断是项目级还是全局级
            is_project = str(Path.cwd()) in str(resolved_path) or str(resolved_path).startswith(".")
            location = "project" if is_project else "global"
            
            # 遍历目录下的子目录
            try:
                for skill_dir in resolved_path.iterdir():
                    if not skill_dir.is_dir():
                        continue
                    
                    # 跳过隐藏目录
                    if skill_dir.name.startswith("."):
                        continue
                    
                    skill_md = skill_dir / "SKILL.md"
                    if not skill_md.exists():
                        continue
                    
                    # 解析技能元数据
                    meta = self._parse_skill_md(skill_md, skill_dir, location)
                    if meta is None:
                        logger.warning(f"Failed to parse SKILL.md: {skill_md}")
                        continue
                    
                    # 去重：同名技能只保留第一个（高优先级路径）
                    if meta.name in seen_names:
                        logger.debug(f"Skill '{meta.name}' already loaded, skipping: {skill_md}")
                        continue
                    
                    # Gate check (OpenClaw-inspired): skip ineligible skills
                    if not self._check_gate(meta.gate):
                        logger.warning(
                            "Skill '%s' failed gate check, skipping: %s",
                            meta.name, skill_md,
                        )
                        continue
                    
                    seen_names.add(meta.name)
                    self._skills[meta.name] = meta
                    
                    # 发布发现事件（P1-1）
                    self._publish_discovery(meta)
                    
                    logger.info(f"Discovered skill: {meta.name} at {skill_dir}")
                    
            except PermissionError as e:
                logger.warning(f"Permission denied accessing {resolved_path}: {e}")
                continue
        
        self._scanned = True
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
        
        name = name_match.group(1).strip()
        description = desc_match.group(1).strip() if desc_match else ""
        
        # --- Parse gate from metadata.agenticx.gate (OpenClaw-inspired) ---
        gate = self._parse_gate_from_frontmatter(content)
        
        return SkillMetadata(
            name=name,
            description=description,
            base_dir=base_dir,
            skill_md_path=skill_md,
            location=location,
            gate=gate,
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
        fm_match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
        if not fm_match:
            return gate
        fm_text = fm_match.group(1)

        def _parse_list(key: str) -> List[str]:
            """Parse ``key: ["a", "b"]`` or ``key: [a, b]`` from frontmatter."""
            m = re.search(rf"^\s*{key}\s*:\s*\[(.+?)\]", fm_text, re.MULTILINE)
            if not m:
                return []
            raw = m.group(1)
            return [v.strip().strip("\"'") for v in raw.split(",") if v.strip()]

        gate.os = _parse_list("os")
        gate.requires_bins = _parse_list("requires_bins")
        gate.requires_any_bins = _parse_list("requires_any_bins")
        gate.requires_env = _parse_list("requires_env")
        gate.requires_config = _parse_list("requires_config")

        always_match = re.search(r"^\s*always\s*:\s*(true|false)", fm_text, re.MULTILINE | re.IGNORECASE)
        if always_match:
            gate.always = always_match.group(1).lower() == "true"

        return gate

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
        self._scanned = False
        return self.scan()


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
                "  ./.agent/skills/ (project)\n"
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
                lines.append(f"  - {s.name}: {s.description}")
            lines.append("")
        
        if global_skills:
            lines.append("Global skills:")
            for s in global_skills:
                lines.append(f"  - {s.name}: {s.description}")
        
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

