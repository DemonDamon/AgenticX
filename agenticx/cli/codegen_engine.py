#!/usr/bin/env python3
"""AI-powered code generation engine for AGX CLI.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
import ast
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

from agenticx.llms.base import BaseLLMProvider
from agenticx.tools.skill_bundle import SkillBundleLoader


@dataclass
class GeneratedCode:
    """Generated code artifact."""

    code: str
    target: str
    description: str
    skill_name: str


class CodeGenEngine:
    """Generate AGX code artifacts from natural language requirements."""

    TARGET_SKILL_MAP = {
        "agent": "agenticx-agent-builder",
        "workflow": "agenticx-workflow-designer",
        "skill": "agenticx-skill-manager",
        "tool": "agenticx-tool-creator",
    }

    def __init__(self, provider: BaseLLMProvider):
        self.provider = provider
        self.skill_loader = SkillBundleLoader()

    def _select_meta_skill(self, target: str) -> str:
        key = target.lower()
        if key not in self.TARGET_SKILL_MAP:
            raise ValueError(f"Unsupported generation target: {target}")
        return self.TARGET_SKILL_MAP[key]

    def _build_system_prompt(self, skill_content: str, target: str, provider_info: str) -> str:
        return (
            "You are the AgenticX code generator. Produce runnable code only.\n\n"
            f"## Target\n{target}\n\n"
            "## AgenticX Reference\n"
            f"{skill_content}\n\n"
            "## Requirements\n"
            "- Use complete imports (from agenticx ...)\n"
            "- Include type hints and concise docstrings\n"
            "- Include an executable entrypoint when target is Python module\n"
            f"- Provider context: {provider_info}\n"
            "- Never include placeholder ellipsis\n"
            "- Return a single code block"
        )

    def _build_user_prompt(self, description: str, context: Optional[Dict[str, Any]]) -> str:
        context_text = ""
        if context:
            context_text = f"\n\n## Context\n{context}"
        return (
            "Generate code from this requirement:\n"
            f"{description}"
            f"{context_text}"
        )

    def _extract_code(self, content: str) -> str:
        if not content:
            raise ValueError("Empty model response")
        match = re.search(r"```(?:python|markdown)?\n(.*?)```", content, re.DOTALL)
        if match:
            return match.group(1).strip() + "\n"
        return content.strip() + "\n"

    def _fix_imports(self, code: str) -> str:
        fixed = code.replace("from agentix", "from agenticx")
        fixed = fixed.replace("import agentix", "import agenticx")
        return fixed

    def _inject_provider(self, code: str) -> str:
        if "ProviderResolver" in code:
            return code
        if "OpenAIProvider(" in code and "provider_resolver" not in code:
            injection = (
                "from agenticx.llms.provider_resolver import ProviderResolver\n"
                "llm = ProviderResolver.resolve()\n"
            )
            code = code.replace(
                "llm = OpenAIProvider(",
                "# Use user-configured provider\n" + injection + "# llm = OpenAIProvider(",
                1,
            )
        return code

    def _security_check(self, code: str) -> str:
        if "api_key=" in code and "os.getenv(" not in code:
            code = "# NOTE: review API key handling before production use.\n" + code
        return code

    def _post_process(self, code: str, target: str) -> str:
        processed = self._fix_imports(code)
        processed = self._inject_provider(processed)
        processed = self._security_check(processed)
        if target in {"agent", "workflow", "tool"}:
            try:
                ast.parse(processed)
            except SyntaxError as exc:
                raise ValueError(f"Generated code has syntax error: {exc}") from exc
        return processed

    def generate(
        self,
        target: str,
        description: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> GeneratedCode:
        """Generate target artifact code from description."""
        skill_name = self._select_meta_skill(target)
        skill_content = self.skill_loader.get_skill_content(skill_name)
        if not skill_content:
            raise ValueError(f"Meta skill not found: {skill_name}")

        provider_info = f"provider_class={self.provider.__class__.__name__}, model={self.provider.model}"
        system_prompt = self._build_system_prompt(skill_content, target, provider_info)
        user_prompt = self._build_user_prompt(description, context)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        response = self.provider.invoke(messages, temperature=0.2, max_tokens=4096)
        code = self._extract_code(response.content)
        code = self._post_process(code, target)
        return GeneratedCode(
            code=code,
            target=target,
            description=description,
            skill_name=skill_name,
        )


def infer_output_path(target: str, description: str, explicit_output: Optional[str] = None) -> Path:
    """Infer output path for generated artifact."""
    if explicit_output:
        return Path(explicit_output)
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", description).strip("_").lower()[:40] or target
    if target == "agent":
        return Path("agents") / f"{slug}.py"
    if target == "workflow":
        return Path("workflows") / f"{slug}.py"
    if target == "tool":
        return Path("tools") / f"{slug}.py"
    if target == "skill":
        return Path(".agents/skills") / slug / "SKILL.md"
    return Path(f"{slug}.txt")


def write_generated_file(path: Path, content: str) -> None:
    """Persist generated code to disk."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
