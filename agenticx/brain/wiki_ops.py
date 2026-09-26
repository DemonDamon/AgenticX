#!/usr/bin/env python3
"""Wiki compile orchestration and maintenance helpers for docs brains.

Author: Damon Li
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.brain.wiki_compiler import WikiCompiler

logger = logging.getLogger(__name__)

_FM_BLOCK = re.compile(r"^---\n([\s\S]*?)\n---", re.MULTILINE)


def brain_storage_root(brain) -> Path:
    return Path(str(brain.storage_root)).expanduser()


def list_wiki_pages(brain_storage: Path) -> List[Dict[str, Any]]:
    wiki_root = brain_storage / "wiki"
    if not wiki_root.is_dir():
        return []
    pages: List[Dict[str, Any]] = []
    for path in sorted(wiki_root.rglob("*.md")):
        rel = str(path.relative_to(brain_storage)).replace("\\", "/")
        title = path.stem
        page_type = "page"
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            fm = _FM_BLOCK.match(text)
            if fm:
                block = fm.group(1)
                tm = re.search(r"^title:\s*[\"']?(.+?)[\"']?\s*$", block, re.MULTILINE)
                ty = re.search(r"^type:\s*[\"']?(.+?)[\"']?\s*$", block, re.MULTILINE)
                if tm:
                    title = tm.group(1).strip()
                if ty:
                    page_type = ty.group(1).strip()
        except OSError:
            pass
        pages.append({"path": rel, "title": title, "type": page_type})
    return pages


def read_wiki_page(brain_storage: Path, rel_path: str) -> Optional[str]:
    rel = rel_path.strip().lstrip("/").replace("\\", "/")
    if not rel.startswith("wiki/"):
        rel = f"wiki/{rel}"
    target = (brain_storage / rel).resolve()
    try:
        target.relative_to(brain_storage.resolve())
    except ValueError:
        return None
    if not target.is_file():
        return None
    return target.read_text(encoding="utf-8", errors="replace")


def purge_wiki_source(brain_storage: Path, source_name: str) -> List[str]:
    """Remove compiled wiki pages tied to a material source file."""
    wiki_root = brain_storage / "wiki"
    if not wiki_root.is_dir():
        return []
    removed: List[str] = []
    stem = Path(source_name).stem
    candidates = [
        wiki_root / "sources" / f"{stem}.md",
        wiki_root / "sources" / f"{source_name}.md",
    ]
    for path in candidates:
        if path.is_file():
            try:
                path.unlink()
                removed.append(str(path.relative_to(brain_storage)).replace("\\", "/"))
            except OSError as exc:
                logger.warning("failed to remove wiki page %s: %s", path, exc)

    for path in list(wiki_root.rglob("*.md")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        fm = _FM_BLOCK.match(text)
        if not fm:
            continue
        block = fm.group(1)
        if source_name in block or stem in block:
            if any(
                line.strip().endswith(source_name) or line.strip().endswith(stem)
                for line in block.splitlines()
                if line.strip().startswith("- ")
            ):
                try:
                    path.unlink()
                    rel = str(path.relative_to(brain_storage)).replace("\\", "/")
                    if rel not in removed:
                        removed.append(rel)
                except OSError as exc:
                    logger.warning("failed to remove wiki page %s: %s", path, exc)
    return removed


def draft_writing_brief(docs_rt, content: str = "") -> Dict[str, Any]:
    """Cold-start or polish the wiki writing brief from indexed file names."""
    cfg = docs_rt.read_config()
    wiki_cfg = getattr(cfg, "wiki_compiler", None)
    provider = str(getattr(wiki_cfg, "provider", "") or "").strip()
    model = str(getattr(wiki_cfg, "model", "") or "").strip()
    if not provider or not model:
        return {"ok": False, "error": "请先在知识库配置里选择写 Wiki 的供应商和模型，并保存"}
    names = []
    for doc in docs_rt.runtime.list_documents():
        name = str(getattr(doc, "source_name", "") or "").strip()
        if name and name not in names:
            names.append(name)
        if len(names) >= 40:
            break
    if not names and not content.strip():
        return {"ok": False, "error": "还没有已入库的资料，无法生成写作说明"}
    catalog = "\n".join(f"- {name}" for name in names) or "(无)"
    draft = content.strip()
    if draft:
        instruction = (
            "把下面的写作说明改写成更具体的 2 到 4 句中文，保留原意。"
            "说明 Wiki 应整理哪些主题、保留什么。不要标题，不要 Markdown。\n\n"
            f"## 已有资料\n{catalog}\n\n## 原说明\n{draft[:2000]}"
        )
    else:
        instruction = (
            "根据已入库文件名，写 2 到 4 句中文写作说明，告诉后续 Wiki 应整理哪些主题、保留什么。"
            "不要标题，不要 Markdown。\n\n"
            f"## 已有资料\n{catalog}"
        )
    from agenticx.brain.wiki_compiler import _invoke_llm

    text = _invoke_llm(
        [{"role": "user", "content": instruction}],
        provider_name=provider,
        model_name=model,
    ).strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("markdown"):
            text = text[8:].strip()
    if not text:
        return {"ok": False, "error": "模型没有写出说明"}
    return {"ok": True, "content": text}


def compile_document_wiki(
    docs_rt,
    doc_id: str,
    *,
    progress_cb=None,
    cancel_event=None,
) -> Dict[str, Any]:
    """Write wiki pages for one already indexed document. Caller runs off the ingest pool."""
    cfg = docs_rt.read_config()
    wiki_cfg = getattr(cfg, "wiki_compiler", None)
    if not getattr(wiki_cfg, "enabled", False):
        return {"ok": False, "skipped": True, "message": "Wiki 编译未打开", "written": []}
    provider = str(getattr(wiki_cfg, "provider", "") or "").strip()
    model = str(getattr(wiki_cfg, "model", "") or "").strip()
    if not provider or not model:
        return {
            "ok": False,
            "error": "请先在知识库配置里选择写 Wiki 的供应商和模型，并保存",
            "written": [],
        }
    doc = docs_rt.runtime.get_document(doc_id)
    if doc is None:
        return {"ok": False, "error": "document not found", "written": []}
    try:
        from agenticx.studio.kb.runtime import _read_document_text

        text = _read_document_text(doc.source_path)
    except Exception as exc:
        logger.warning("wiki compile skipped, cannot read source: %s", exc)
        return {"ok": False, "error": str(exc), "written": []}
    storage = brain_storage_root(docs_rt.brain)
    compiler = WikiCompiler(storage)
    result = compiler.compile_source(
        source_path=doc.source_path,
        source_text=text,
        provider_name=provider,
        model_name=model,
        progress_cb=progress_cb,
        cancel_event=cancel_event,
    )
    if result.error == "已取消":
        return {"ok": False, "cancelled": True, "error": "已取消", "written": []}
    if not result.ok:
        logger.warning("wiki compile failed for %s: %s", doc_id, result.error)
        return {"ok": False, "error": result.error or "编译失败", "written": []}
    logger.info("wiki compile wrote %d pages for %s", len(result.written), doc_id)
    try:
        docs_rt.refresh_brain_stats()
    except Exception:
        pass
    return {"ok": True, "written": list(result.written)}


def maybe_compile_wiki_after_ingest(docs_rt, job) -> None:
    """Ingest callback. Only queues wiki writing; it must return before the next ingest."""
    from agenticx.brain.wiki_compile_queue import schedule_wiki_after_ingest

    schedule_wiki_after_ingest(docs_rt, job)


_SAMPLE_PAGES = {
    "wiki/index.md": """---
title: 员工手册
type: summary
sources:
  - handbook.md
---

# 员工手册

这份示例 Wiki 用来验收浏览、搜索、关联和关系图。

- 年假规则见 [[concepts/annual-leave]]
- 报销规则见 [[concepts/expense]]
- 公司主体见 [[entities/company]]
""",
    "wiki/concepts/annual-leave.md": """---
title: 年假
type: concept
sources:
  - handbook.md
---

# 年假

按司龄发放的带薪休假。申请流程见 [[concepts/leave-requests]]。所属组织是 [[entities/company]]。

| 司龄 | 年假 |
| --- | --- |
| 未满 1 年 | 5 天 |
| 1–10 年 | 10 天 |
| 10 年以上 | 15 天 |
""",
    "wiki/concepts/leave-requests.md": """---
title: 请假申请
type: synthesis
sources:
  - handbook.md
---

# 请假申请

3 天以内由直属经理审批，3–7 天由部门负责人审批，超过 7 天通知人力资源。规则来自 [[concepts/annual-leave]]。
""",
    "wiki/concepts/expense.md": """---
title: 费用报销
type: concept
sources:
  - handbook.md
---

# 费用报销

差旅、培训和办公费用在发生后 30 天内提交。逾期需要经理和财务负责人补签。付款主体是 [[entities/company]]。
""",
    "wiki/entities/company.md": """---
title: 公司
type: entity
sources:
  - handbook.md
---

# 公司

示例里的雇主主体。年假见 [[concepts/annual-leave]]，报销见 [[concepts/expense]]。
""",
}

_SAMPLE_PURPOSE = "# 知识库目标\n\n把员工手册编译成可浏览的概念、实体和来源页。\n"


def _is_sample_purpose(text: str) -> bool:
    return text.replace("\r\n", "\n").strip() == _SAMPLE_PURPOSE.strip()


def seed_sample_wiki(brain_storage: Path) -> List[str]:
    """Write a small linked wiki so browse, search, and graph can be checked."""
    written: List[str] = []
    for rel, body in _SAMPLE_PAGES.items():
        target = (brain_storage / rel).resolve()
        target.relative_to(brain_storage.resolve())
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body.strip() + "\n", encoding="utf-8")
        written.append(rel)
    purpose = brain_storage / "purpose.md"
    if not purpose.is_file() or not purpose.read_text(encoding="utf-8").strip():
        purpose.write_text(_SAMPLE_PURPOSE, encoding="utf-8")
    return written


def clear_sample_wiki(brain_storage: Path) -> List[str]:
    """Remove only the bundled sample pages. Other wiki files stay."""
    removed: List[str] = []
    for rel in _SAMPLE_PAGES:
        target = (brain_storage / rel).resolve()
        try:
            target.relative_to(brain_storage.resolve())
        except ValueError:
            continue
        if not target.is_file():
            continue
        target.unlink()
        removed.append(rel)
        parent = target.parent
        if parent != brain_storage and parent.is_dir() and not any(parent.iterdir()):
            parent.rmdir()
    purpose = brain_storage / "purpose.md"
    if purpose.is_file() and _is_sample_purpose(purpose.read_text(encoding="utf-8")):
        purpose.write_text("", encoding="utf-8")
        removed.append("purpose.md")
    return removed


def run_brain_maintenance(docs_rt) -> Dict[str, Any]:
    """Lightweight maintenance: orphan wiki report + broken wikilink lint."""
    storage = brain_storage_root(docs_rt.brain)
    wiki_root = storage / "wiki"
    report: Dict[str, Any] = {
        "ok": True,
        "orphan_pages": [],
        "broken_wikilinks": [],
        "stale_embed_hint": False,
    }
    if not wiki_root.is_dir():
        return report

    from agenticx.brain.wiki_graph import build_wiki_graph

    graph = build_wiki_graph(storage)
    known = set(graph.nodes.keys())
    wikilink = re.compile(r"\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]")

    for path in wiki_root.rglob("*.md"):
        rel = str(path.relative_to(storage)).replace("\\", "/")
        node_id = rel.replace("wiki/", "").replace(".md", "").replace("\\", "/")
        if node_id not in known and rel != "wiki/index.md":
            report["orphan_pages"].append(rel)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in wikilink.finditer(text):
            target = m.group(1).strip().replace(" ", "-").lower()
            if target and target not in known:
                report["broken_wikilinks"].append({"page": rel, "link": m.group(1)})

    stats = docs_rt.stats()
    report["stale_embed_hint"] = bool(stats.get("rebuild_required"))
    return report
