#!/usr/bin/env python3
"""GEPA-style N-candidate proposer for skill self-evolution.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.learning.gepa")


def proposals_root() -> Path:
    root = Path.home() / ".agenticx" / "skills" / ".proposals"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_proposal(
    *,
    base_skill: str,
    action: str,
    skill_md_text: str,
    session_id: str = "",
    review_model: str = "",
    diff_summary: str = "",
    candidate_index: int = 1,
    total_candidates: int = 1,
    scores: dict[str, float] | None = None,
    proposal_id: str | None = None,
) -> Path:
    """Write one candidate to ``.proposals/<id>/`` and return the proposal dir."""
    from agenticx.learning.skill_quality_gate import check_size_limits
    from agenticx.learning.config import get_learning_config
    from agenticx.skills.frontmatter import get_description_from_frontmatter

    cfg = get_learning_config()
    desc = get_description_from_frontmatter(skill_md_text) or ""
    size_check = check_size_limits(
        skill_md_text,
        desc,
        max_bytes=int(cfg.get("max_skill_bytes", 15360)),
        max_desc_chars=int(cfg.get("max_description_chars", 500)),
    )
    if not size_check["ok"]:
        raise ValueError(f"{size_check['error']}. {size_check['hint']}")

    pid = proposal_id or uuid.uuid4().hex
    pdir = proposals_root() / pid
    pdir.mkdir(parents=True, exist_ok=True)
    (pdir / "SKILL.md").write_text(skill_md_text, encoding="utf-8")
    meta = {
        "proposal_id": pid,
        "base_skill": base_skill,
        "action": action,
        "author_session_id": session_id,
        "author_model": review_model,
        "created_at": _now_iso(),
        "candidate_index": candidate_index,
        "total_candidates": total_candidates,
        "diff_summary": diff_summary,
        "scores": scores,
        "status": "pending",
    }
    (pdir / "proposal.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return pdir


def _parse_candidates_json(text: str) -> list[dict[str, str]]:
    text = text.strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return []
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return []
    raw = data.get("candidates") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        skill_md = str(item.get("skill_md", "") or "").strip()
        if not skill_md:
            continue
        out.append(
            {
                "skill_md": skill_md,
                "diff_summary": str(item.get("diff_summary", "") or ""),
            }
        )
    return out


async def generate_candidates(
    *,
    base_skill_name: str,
    action: str,
    session_id: str,
    review_model: str,
    provider_name: str,
    base_skill_md: str | None,
    review_context: str,
    n: int = 3,
) -> list[Path]:
    """Generate N candidate SKILL.md variants under ``.proposals/``."""
    from agenticx.learning.drift_detector import apply_pareto_pruning, find_benchmark_for

    litellm_model = f"{provider_name}/{review_model}" if provider_name else review_model
    prompt = (
        "You are a skill author. Based on the session review context below, "
        f"produce exactly {n} distinct SKILL.md variants as JSON.\n"
        "Each variant should change ONE aspect among description, procedure, or pitfalls.\n"
        "Return ONLY valid JSON:\n"
        '{"candidates":[{"skill_md":"---\\nname: ...\\n---\\n\\n...","diff_summary":"..."}]}\n\n'
        f"Action: {action}\n"
        f"Skill name: {base_skill_name}\n"
    )
    if base_skill_md:
        prompt += f"\nExisting SKILL.md:\n{base_skill_md[:4000]}\n"
    prompt += f"\nSession context:\n{review_context[:8000]}\n"

    candidates: list[dict[str, str]] = []
    try:
        import litellm

        response = await litellm.acompletion(
            model=litellm_model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096,
            temperature=0.4,
        )
        text = str(response.choices[0].message.content or "")
        candidates = _parse_candidates_json(text)
    except Exception:
        logger.warning("GEPA candidate generation failed", exc_info=True)

    if not candidates and base_skill_md and action == "patch":
        candidates = [{"skill_md": base_skill_md, "diff_summary": "fallback single candidate"}]
    elif not candidates:
        logger.warning("GEPA returned no candidates for %s", base_skill_name)
        return []

    paths: list[Path] = []
    total = min(n, len(candidates))
    for idx, cand in enumerate(candidates[:n], start=1):
        try:
            pdir = write_proposal(
                base_skill=base_skill_name,
                action=action,
                skill_md_text=cand["skill_md"],
                session_id=session_id,
                review_model=review_model,
                diff_summary=cand.get("diff_summary", ""),
                candidate_index=idx,
                total_candidates=total,
            )
            paths.append(pdir)
        except ValueError as exc:
            logger.warning("Skipped oversized GEPA candidate %d: %s", idx, exc)

    bm = find_benchmark_for(base_skill_name)
    if bm is not None and paths:
        paths = apply_pareto_pruning(
            paths,
            base_skill_md=base_skill_md,
            benchmark_path=bm,
        )
    return paths
