#!/usr/bin/env python3
"""Compiled wiki compiler — two-step LLM ingest for docs brains.

SP31 upgrade: incremental compile. Source documents whose content hash is
unchanged skip the LLM entirely (the compile queue's `skipped` status branch
existed but nothing produced it); freshly generated pages MERGE into
structured existing pages instead of overwriting them, so a page that
aggregates two documents keeps both documents' claims and sources; LLM-surfaced
`## 矛盾` sections survive merges. Legacy (non-structured) pages not owned by
the compiling document are never touched.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from agenticx.brain.wiki import integrate_merge
from agenticx.brain.wiki.page import TYPE_DIR, WikiPage, slugify

logger = logging.getLogger(__name__)

_FILE_BLOCK = re.compile(
    r"^===FILE:\s*(?P<path>[^\s=]+)\s*===\s*\n(?P<body>[\s\S]*?)(?=^===FILE:|\Z)",
    re.MULTILINE,
)

# Per-brain compile state: {source_path: {"sha": ..., "pages": [rel paths]}}
# Records each document's content fingerprint and the pages it owns, backing
# the skip-unchanged and ownership rules of merge-on-write.
_STATE_FILENAME = ".compile_state.json"


@dataclass
class WikiCompileResult:
    ok: bool
    written: List[str] = field(default_factory=list)
    error: Optional[str] = None
    analysis: Optional[str] = None
    skipped: Optional[List[str]] = None       # unchanged-doc / preserved pages
    skipped_reason: Optional[str] = None       # human-readable skip reason


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
        "使用 [[wikilink]] 交叉引用。\n"
        "页面必须放在对应类型子目录下：实体→wiki/entities/、概念→wiki/concepts/、"
        "综合→wiki/synthesis/、源摘要→wiki/sources/；禁止把类型页放在 wiki 根目录。\n\n"
        "页面结构契约（SP31，编译器按此结构合并页面，不合规的页面无法增量合并）：\n"
        "1. YAML frontmatter：title / type（entity|concept|method|analysis|synthesis|source）/"
        " description / sources[]（本文档名必须列入 sources）。\n"
        "2. 正文：# 标题，一句话 description，然后 `## 要点` 列出事实要点；\n"
        "3. 每条要点一行一条，必须以（来源: 文档名）结尾，禁止无来源的断言。\n"
        "4. 当分析发现与已有 wiki 内容冲突时，在对应页面写 `## 矛盾` 段落："
        "双方结论各一行、各带（来源: 文档名），不要删除或掩盖任何一方。\n"
        "5. 已有页面内容（见 index/overview）与本文档新证据冲突时，优先保留并显性标记矛盾。\n\n"
        f"## schema\n{schema or '(默认)'}\n\n"
        f"## purpose\n{purpose or '(未设置)'}\n\n"
        f"## index\n{index or '(空)'}\n\n"
        f"## overview\n{overview or '(空)'}\n\n"
        f"## analysis\n{analysis_json}\n\n"
        f"## source_name\n{source_name}"
    )


class WikiCompileCancelled(Exception):
    """Raised when the user stops page writing. The in-flight model call is abandoned."""


def _raise_if_cancelled(cancel_event: Optional[threading.Event]) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise WikiCompileCancelled()


def _invoke_llm(messages: List[Dict[str, str]], *, provider_name: Optional[str], model_name: Optional[str]) -> str:
    from agenticx.llms.provider_resolver import ProviderResolver

    llm = ProviderResolver.resolve(provider_name=provider_name, model=model_name)
    if hasattr(llm, "invoke"):
        resp = llm.invoke(messages)
        if hasattr(resp, "content"):
            return str(resp.content or "")
        return str(resp)
    raise RuntimeError("LLM provider unavailable for wiki compile")


def _invoke_llm_cancellable(
    messages: List[Dict[str, str]],
    *,
    provider_name: Optional[str],
    model_name: Optional[str],
    cancel_event: Optional[threading.Event],
) -> str:
    _raise_if_cancelled(cancel_event)
    box: Dict[str, str] = {}
    err: Dict[str, BaseException] = {}

    def _run() -> None:
        try:
            box["value"] = _invoke_llm(messages, provider_name=provider_name, model_name=model_name)
        except BaseException as exc:  # noqa: BLE001 - surfaced to the waiter
            err["error"] = exc

    worker = threading.Thread(target=_run, name="agx-wiki-llm", daemon=True)
    worker.start()
    while worker.is_alive():
        if cancel_event is not None and cancel_event.is_set():
            raise WikiCompileCancelled()
        worker.join(0.25)
    if "error" in err:
        raise err["error"]
    return box.get("value", "")


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

    # ----- SP31 compile state -----

    def _load_state(self) -> Dict[str, Dict[str, Any]]:
        p = self._storage / "wiki" / _STATE_FILENAME
        if not p.is_file():
            return {}
        try:
            return json.loads(p.read_text(encoding="utf-8") or "{}")
        except (json.JSONDecodeError, OSError):
            return {}

    def _save_state(self, state: Dict[str, Dict[str, Any]]) -> None:
        p = self._storage / "wiki" / _STATE_FILENAME
        try:
            p.write_text(
                json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True),
                encoding="utf-8",
            )
        except OSError:
            logger.warning("wiki compile state save failed", exc_info=True)

    def _resolve_target(
        self,
        *,
        block_path: str,
        incoming: Optional[WikiPage],
    ) -> Optional[tuple]:
        """Resolve the actual write target for one generated block.

        Two deterministic corrections keep cross-document compiles colliding
        on the SAME page instead of scattering duplicates (observed live: the
        model emitted root-level paths for a concept that already existed
        under wiki/concepts/):

        1. Path normalization: a structured page whose block path sits at the
           wiki ROOT is moved into its type directory.
        2. Slug-collision resolution: when the (normalized) target does not
           exist but a page with the same stem exists elsewhere in the wiki,
           that existing page becomes the merge target.

        Returns (target_path, storage_rel_path) or None when unsafe."""
        target = _safe_wiki_path(self._storage, block_path)
        if target is None:
            return None
        rel = str(target.relative_to(self._storage))
        wiki_root = self._storage / "wiki"
        if incoming is not None and not target.exists():
            type_dir = TYPE_DIR.get(incoming.page_type, "")
            # 1. root-level -> type directory
            if type_dir and target.parent == wiki_root:
                slug = slugify(incoming.title) or target.stem
                norm_rel = f"wiki/{type_dir}/{slug}.md"
                norm_target = _safe_wiki_path(self._storage, norm_rel)
                if norm_target is not None:
                    target, rel = norm_target, norm_rel
            # 2. same-stem page elsewhere in the tree wins as merge target
            if not target.exists():
                stem = Path(rel).stem
                for existing in sorted(wiki_root.rglob(f"{stem}.md")):
                    ex_rel = str(existing.relative_to(self._storage))
                    if ex_rel != rel:
                        target, rel = existing, ex_rel
                        break
        return target, rel

    def _write_block(
        self,
        *,
        rel: str,
        target: Path,
        body: str,
        incoming: Optional[WikiPage],
        source_name: str,
        owned_pages: List[str],
        preserved: List[str],
    ) -> bool:
        """Merge-on-write for one generated page block.

        Returns True when the page was written. Pages this document owns may
        be freely rewritten; structured pages from OTHER documents are
        merge-appended (their claims survive); legacy pages from other
        documents are preserved untouched (recorded, never clobbered)."""
        structured_in = incoming is not None

        if target.exists():
            existing_text = target.read_text(encoding="utf-8")
            try:
                existing = WikiPage.parse(existing_text, source_path=rel)
                structured_ex = True
            except ValueError:
                existing = None
                structured_ex = False

            if rel in owned_pages:
                # This document's own page: rewriting is always allowed.
                if structured_ex and structured_in:
                    merged = integrate_merge(existing, incoming)
                    merged.page_type = incoming.page_type
                    merged.title = incoming.title or existing.title
                    target.write_text(merged.render(), encoding="utf-8")
                    return True
                target.write_text(body + "\n", encoding="utf-8")
                return True

            if structured_ex and structured_in:
                # Cross-document page: merge — the other document's claims,
                # sources and LLM-surfaced conflicts must all survive.
                merged = integrate_merge(existing, incoming)
                target.write_text(merged.render(), encoding="utf-8")
                return True

            if structured_ex and not structured_in:
                # Incoming legacy block vs structured page: merge what we can
                # (nothing provenance-tagged) — safest is to keep the page and
                # only record the miss, never destroy structured content.
                logger.info("wiki merge: legacy incoming block for structured page %s — preserved", rel)
                preserved.append(rel)
                return False

            # Existing legacy page, not owned by this document.
            logger.info("wiki merge: legacy page %s not owned by %s — preserved", rel, source_name)
            preserved.append(rel)
            return False

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body + "\n", encoding="utf-8")
        return True

    def compile_source(
        self,
        *,
        source_path: str,
        source_text: str,
        provider_name: Optional[str] = None,
        model_name: Optional[str] = None,
        progress_cb: Optional[Callable[[str, str], None]] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> WikiCompileResult:
        purpose = _read_optional(self._storage / "purpose.md")
        schema = _read_optional(self._storage / "schema.md")
        index = _read_optional(self._storage / "wiki" / "index.md")
        overview = _read_optional(self._storage / "wiki" / "overview.md")
        source_name = Path(source_path).name

        def _step(stage: str, message: str) -> None:
            _raise_if_cancelled(cancel_event)
            if progress_cb is not None:
                progress_cb(stage, message)

        # ---- SP31: skip unchanged documents (no LLM calls at all) ----
        sha = hashlib.sha1(source_text.encode("utf-8")).hexdigest()
        state = self._load_state()
        record = state.get(source_path) or {}
        if record.get("sha") == sha:
            _step("skipped", "源文档未变化，跳过编译")
            return WikiCompileResult(
                ok=True, written=[], analysis=None,
                skipped=list(record.get("pages") or []),
                skipped_reason="源文档未变化，跳过编译")
        owned_pages: List[str] = list(record.get("pages") or [])

        try:
            _step("reading", "正在读取正文")
            _step("analyzing", "正在抽出实体和概念")
            analysis = _invoke_llm_cancellable(
                [
                    {"role": "system", "content": build_analysis_prompt(
                        purpose=purpose, index=index, source_content=source_text
                    )},
                    {"role": "user", "content": "输出 JSON 分析。"},
                ],
                provider_name=provider_name,
                model_name=model_name,
                cancel_event=cancel_event,
            )
            _step("generating", "正在生成页面")
            generation = _invoke_llm_cancellable(
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
                cancel_event=cancel_event,
            )
            _step("writing", "正在保存页面")
        except WikiCompileCancelled:
            return WikiCompileResult(ok=False, error="已取消")
        except Exception as exc:
            logger.exception("wiki compile LLM failed")
            return WikiCompileResult(ok=False, error=str(exc))

        written: List[str] = []
        preserved: List[str] = []
        for block in parse_file_blocks(generation):
            try:
                incoming = WikiPage.parse(block["body"],
                                          source_path=block["path"])
            except ValueError:
                incoming = None
            resolved = self._resolve_target(block_path=block["path"],
                                            incoming=incoming)
            if resolved is None:
                continue
            target, rel = resolved
            if self._write_block(
                    rel=rel, target=target, body=block["body"],
                    incoming=incoming, source_name=source_name,
                    owned_pages=owned_pages, preserved=preserved):
                written.append(rel)

        if not written and not preserved:
            fallback = _wiki_root(self._storage) / "sources" / f"{Path(source_name).stem}.md"
            body = (
                f"---\ntitle: {source_name}\ntype: source\nsources:\n  - {source_name}\n---\n\n"
                f"# {source_name}\n\n{source_text[:4000]}\n"
            )
            fallback.write_text(body, encoding="utf-8")
            written.append(str(fallback.relative_to(self._storage)))

        # ---- SP31: record this document's fingerprint + owned pages ----
        all_owned = list(dict.fromkeys(owned_pages + written))
        state[source_path] = {"sha": sha, "pages": all_owned}
        self._save_state(state)

        return WikiCompileResult(ok=True, written=written, analysis=analysis,
                                 skipped=preserved or None)
