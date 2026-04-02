#!/usr/bin/env python3
"""Skill helpers for AGX Studio.

Author: Damon Li
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from rich.console import Console
from rich.syntax import Syntax
from rich.table import Table


console = Console()


def skill_list(registry_url: Optional[str] = None) -> None:
    """List available local and remote skills."""
    from agenticx.tools.skill_bundle import SkillBundleLoader

    loader = SkillBundleLoader(registry_url=registry_url)
    skills = loader.scan()

    if not skills:
        console.print("[yellow]未发现任何 skill。[/yellow]")
        return

    table = Table(title="可用 Skills")
    table.add_column("名称", style="cyan")
    table.add_column("描述")
    table.add_column("位置", style="dim")
    for skill in skills:
        desc = skill.description[:60] + ("..." if len(skill.description) > 60 else "")
        table.add_row(skill.name, desc, skill.location)
    console.print(table)
    console.print(f"[dim]共 {len(skills)} 个 skill[/dim]")


def skill_search(query: str, registry_url: str = "http://127.0.0.1:8321") -> None:
    """Search skills from the remote registry."""
    try:
        from agenticx.skills.registry import SkillRegistryClient

        client = SkillRegistryClient(registry_url=registry_url)
        results = client.search(query)
    except Exception as exc:
        console.print(f"[red]搜索失败（注册中心可能未启动）:[/red] {exc}")
        console.print("[dim]提示: 先运行 agx skills serve 启动注册中心[/dim]")
        return

    if not results:
        console.print(f"[yellow]未找到匹配 '{query}' 的 skill。[/yellow]")
        return

    table = Table(title=f"搜索结果: {query}")
    table.add_column("名称", style="cyan")
    table.add_column("版本")
    table.add_column("描述")
    for entry in results:
        table.add_row(entry.name, entry.version, entry.description[:60])
    console.print(table)


def skill_is_allowed_for_session(
    name: str,
    *,
    bound_avatar_id: Optional[str] = None,
) -> Tuple[bool, str]:
    """Return (allowed, error_message). Empty error_message when allowed."""
    from agenticx.avatar.registry import AvatarRegistry
    from agenticx.tools.skill_bundle import get_disabled_skill_names_set

    if name in get_disabled_skill_names_set():
        return False, f"Skill '{name}' is disabled globally in Settings."
    if bound_avatar_id:
        av = AvatarRegistry().get_avatar(bound_avatar_id)
        if (
            av is not None
            and av.skills_enabled
            and name in av.skills_enabled
            and not av.skills_enabled[name]
        ):
            return False, f"Skill '{name}' is disabled for this avatar."
    return True, ""


def skill_use(
    context_files: Dict[str, str],
    name: str,
    registry_url: Optional[str] = None,
    *,
    bound_avatar_id: Optional[str] = None,
    quiet: bool = False,
) -> bool:
    """Load a skill's SKILL.md content into session context_files.

    Returns True on success.
    """
    from agenticx.tools.skill_bundle import SkillBundleLoader

    allowed, err = skill_is_allowed_for_session(name, bound_avatar_id=bound_avatar_id)
    if not allowed:
        if not quiet:
            console.print(f"[red]{err}[/red]")
        return False

    loader = SkillBundleLoader(registry_url=registry_url)
    content = loader.get_skill_content(name)
    if not content:
        console.print(f"[red]Skill '{name}' 未找到或内容为空。[/red]")
        console.print("[dim]使用 /skill list 查看可用 skills[/dim]")
        return False

    key = f"skill:{name}"
    context_files[key] = content
    console.print(f"[green]已激活 skill:[/green] {name} ({len(content)} chars)")
    return True


def skill_info(name: str, registry_url: Optional[str] = None) -> None:
    """Display full SKILL.md content for a skill."""
    from agenticx.tools.skill_bundle import SkillBundleLoader

    loader = SkillBundleLoader(registry_url=registry_url)
    content = loader.get_skill_content(name)
    if not content:
        console.print(f"[red]Skill '{name}' 未找到。[/red]")
        return

    console.print(f"\n[bold cyan]{name}[/bold cyan]")
    console.print(Syntax(content, "markdown", line_numbers=False))


def get_all_skill_summaries(
    registry_url: Optional[str] = None,
    *,
    bound_avatar_id: Optional[str] = None,
) -> List[Dict[str, str]]:
    """Get name+description for skills allowed for the session (global + avatar filters)."""
    from agenticx.avatar.registry import AvatarRegistry
    from agenticx.tools.skill_bundle import (
        SkillBundleLoader,
        filter_skills_by_enablement,
        get_disabled_skill_names_set,
    )

    loader = SkillBundleLoader(registry_url=registry_url)
    skills = loader.scan()
    disabled = get_disabled_skill_names_set()
    avatar_map: Optional[Dict[str, bool]] = None
    if bound_avatar_id:
        av = AvatarRegistry().get_avatar(bound_avatar_id)
        if av is not None and av.skills_enabled:
            avatar_map = dict(av.skills_enabled)
    filtered = filter_skills_by_enablement(
        list(skills),
        disabled_names=disabled,
        avatar_skills_enabled=avatar_map,
    )
    return [{"name": s.name, "description": s.description} for s in filtered]
