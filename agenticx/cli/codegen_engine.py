#!/usr/bin/env python3
"""AI-powered code generation engine for AGX CLI.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
import ast
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

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
        prompt_parts: List[str] = [
            "Generate code from this requirement:",
            description,
        ]
        if context:
            previous_code = context.get("previous_code")
            if isinstance(previous_code, str) and previous_code.strip():
                prompt_parts.extend(
                    [
                        "",
                        "以下是已有代码，请根据新需求修改：",
                        "```",
                        previous_code,
                        "```",
                    ]
                )
            reference_files = context.get("reference_files")
            if isinstance(reference_files, dict) and reference_files:
                prompt_parts.append("\nUser-referenced files:")
                for fpath, content in reference_files.items():
                    prompt_parts.append(f"\n--- {fpath} ---\n{content}")
            extra_context = {
                key: value
                for key, value in context.items()
                if key not in {"previous_code", "image_b64", "reference_files"}
            }
            if extra_context:
                prompt_parts.extend(["", "## Context", str(extra_context)])
        return "\n".join(prompt_parts)

    def supports_vision(self) -> bool:
        """Return whether current provider/model likely supports vision input."""
        model_name = (self.provider.model or "").lower()
        if "gpt-4o" in model_name:
            return True
        if model_name.startswith("anthropic/claude-") or "claude" in model_name:
            return True
        if "doubao-vision" in model_name:
            return True
        if "doubao" in model_name and "vision" in model_name:
            return True
        return False

    def _normalize_image_b64(self, value: Any) -> List[Dict[str, str]]:
        def normalize_entry(entry: Any) -> Optional[Dict[str, str]]:
            if isinstance(entry, str):
                text = entry.strip()
                if text:
                    return {"data": text, "mime": "image/png"}
                return None
            if isinstance(entry, dict):
                data_value = entry.get("data")
                if not isinstance(data_value, str):
                    return None
                data = data_value.strip()
                if not data:
                    return None
                mime_value = entry.get("mime")
                mime = mime_value if isinstance(mime_value, str) and mime_value.startswith("image/") else "image/png"
                return {"data": data, "mime": mime}
            return None

        if isinstance(value, str):
            normalized = normalize_entry(value)
            return [normalized] if normalized else []
        if isinstance(value, dict):
            normalized = normalize_entry(value)
            return [normalized] if normalized else []
        if isinstance(value, list):
            images: List[Dict[str, str]] = []
            for item in value:
                normalized = normalize_entry(item)
                if normalized:
                    images.append(normalized)
            return images
        return []

    def _to_data_url(self, image: Union[str, Dict[str, str]]) -> str:
        if isinstance(image, dict):
            image_b64 = image.get("data", "").strip()
            if not image_b64:
                return ""
            mime_value = image.get("mime", "")
            mime = mime_value if mime_value.startswith("image/") else "image/png"
            if image_b64.startswith("data:"):
                return image_b64
            return f"data:{mime};base64,{image_b64}"

        image_b64 = image.strip()
        if not image_b64:
            return ""
        if image_b64.startswith("data:"):
            return image_b64
        return f"data:image/png;base64,{image_b64}"

    def _build_user_message(self, description: str, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        prompt = self._build_user_prompt(description, context)
        if not context:
            return {"role": "user", "content": prompt}

        image_values = self._normalize_image_b64(context.get("image_b64"))
        if not image_values:
            return {"role": "user", "content": prompt}
        if not self.supports_vision():
            raise ValueError("当前模型不支持图片输入，请切换到支持视觉的模型（如 gpt-4o、Claude、doubao-vision）。")

        content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
        for image in image_values:
            image_url = self._to_data_url(image)
            if not image_url:
                continue
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": image_url},
                }
            )
        return {"role": "user", "content": content}

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

        messages = [
            {"role": "system", "content": system_prompt},
            self._build_user_message(description, context),
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
