#!/usr/bin/env python3
"""Compiled wiki compiler — two-step LLM ingest for docs brains.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_FILE_BLOCK = re.compile(
    r"^===FILE:\s*(?P<path>[^\s=]+)\s*===\s*\n(?P<body>[\s\S]*?)(?=^===FILE:|\Z)",
    re.MULTILINE,
)


@dataclass
class WikiCompileResult:
    ok: bool
    written: List[str] = field(default_factory=list)
    error: Optional[str] = None
    analysis: Optional[str] = None


def _wiki_root(brain_storage: Path) -> Path:
    root = brain_storage / "wiki"
    root.mkdir(parents=True, exist_ok=True)
    for sub in ("entities", "concepts", "sources", "synthesis"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def _read_optional(path: Path) -> str:
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def _safe_wiki_path(brain_storage: Path, rel: str) -> Optional[Path]:
    rel = rel.strip().lstrip("/").replace("\\", "/")
    if not rel.startswith("wiki/"):
        rel = f"wiki/{rel}"
    if ".." in rel.split("/"):
        return None
    target = (brain_storage / rel).resolve()
    try:
        target.relative_to(brain_storage.resolve())
    except ValueError:
        return None
    if not str(target).endswith(".md"):
        target = target.with_suffix(".md")
    return target


def parse_file_blocks(llm_output: str) -> List[Dict[str, str]]:
    blocks: List[Dict[str, str]] = []
    for m in _FILE_BLOCK.finditer(llm_output or ""):
        blocks.append({"path": m.group("path").strip(), "body": m.group("body").strip()})
    return blocks


def build_analysis_prompt(*, purpose: str, index: str, source_content: str) -> str:
    return (
        "你是知识库编译助手。先分析源文档，输出结构化 JSON（不要写 wiki 文件）。\n"
        "字段：entities[], concepts[], key_points[], links_to_existing[], contradictions[], recommendations[]\n\n"
        f"## purpose\n{purpose or '(未设置)'}\n\n"
        f"## index\n{index or '(空)'}\n\n"
        f"## source\n{source_content[:12000]}"
    )


def build_generation_prompt(
    *,
    schema: str,
    purpose: str,
    index: str,
    overview: str,
    analysis_json: str,
    source_name: str,
) -> str:
    return (
        "基于分析结果生成 wiki Markdown 文件。每个文件用块格式输出：\n"
        "===FILE: wiki/相对路径.md ===\n<markdown with YAML frontmatter>\n\n"
        "必须包含：wiki/sources 下源摘要页；必要时更新 wiki/index.md、wiki/overview.md。\n"
        "使用 [[wikilink]] 交叉引用；frontmatter 含 title, type, sources[]。\n\n"
        f"## schema\n{schema or '(默认)'}\n\n"
        f"## purpose\n{purpose or '(未设置)'}\n\n"
        f"## index\n{index or '(空)'}\n\n"
        f"## overview\n{overview or '(空)'}\n\n"
        f"## analysis\n{analysis_json}\n\n"
        f"## source_name\n{source_name}"
    )


def _invoke_llm(messages: List[Dict[str, str]], *, provider_name: Optional[str], model_name: Optional[str]) -> str:
    from agenticx.llms.provider_resolver import ProviderResolver

    llm = ProviderResolver.resolve(provider_name=provider_name, model_name=model_name)
    if hasattr(llm, "invoke"):
        resp = llm.invoke(messages)
        if hasattr(resp, "content"):
            return str(resp.content or "")
        return str(resp)
    raise RuntimeError("LLM provider unavailable for wiki compile")


class WikiCompiler:
    def __init__(self, brain_storage: Path) -> None:
        self._storage = brain_storage
        _wiki_root(brain_storage)
        for name in ("schema.md", "purpose.md"):
            p = brain_storage / name
            if not p.is_file():
                p.write_text(
                    "# 默认结构\n\n实体、概念、源摘要。\n" if name == "schema.md" else "# 知识库目标\n\n",
                    encoding="utf-8",
                )

    def compile_source(
        self,
        *,
        source_path: str,
        source_text: str,
        provider_name: Optional[str] = None,
        model_name: Optional[str] = None,
    ) -> WikiCompileResult:
        purpose = _read_optional(self._storage / "purpose.md")
        schema = _read_optional(self._storage / "schema.md")
        index = _read_optional(self._storage / "wiki" / "index.md")
        overview = _read_optional(self._storage / "wiki" / "overview.md")
        source_name = Path(source_path).name

        try:
            analysis = _invoke_llm(
                [
                    {"role": "system", "content": build_analysis_prompt(
                        purpose=purpose, index=index, source_content=source_text
                    )},
                    {"role": "user", "content": "输出 JSON 分析。"},
                ],
                provider_name=provider_name,
                model_name=model_name,
            )
            generation = _invoke_llm(
                [
                    {"role": "system", "content": build_generation_prompt(
                        schema=schema,
                        purpose=purpose,
                        index=index,
                        overview=overview,
                        analysis_json=analysis,
                        source_name=source_name,
                    )},
                    {"role": "user", "content": "生成 wiki 文件块。"},
                ],
                provider_name=provider_name,
                model_name=model_name,
            )
        except Exception as exc:
            logger.exception("wiki compile LLM failed")
            return WikiCompileResult(ok=False, error=str(exc))

        written: List[str] = []
        for block in parse_file_blocks(generation):
            target = _safe_wiki_path(self._storage, block["path"])
            if target is None:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(block["body"] + "\n", encoding="utf-8")
            written.append(str(target.relative_to(self._storage)))

        if not written:
            fallback = _wiki_root(self._storage) / "sources" / f"{Path(source_name).stem}.md"
            body = (
                f"---\ntitle: {source_name}\ntype: source\nsources:\n  - {source_name}\n---\n\n"
                f"# {source_name}\n\n{source_text[:4000]}\n"
            )
            fallback.write_text(body, encoding="utf-8")
            written.append(str(fallback.relative_to(self._storage)))

        return WikiCompileResult(ok=True, written=written, analysis=analysis)
