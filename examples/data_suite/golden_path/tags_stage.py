"""Stage 3b: tag compute + audience select on golden-path rows."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Union

import yaml

from agenticx.data_suite.audience.dsl import select_audience
from agenticx.data_suite.tags.compute import TagComputeEngine

ROOT = Path(__file__).resolve().parent
SEED = ROOT / "seed"


def run_tags_stage(
    rows: List[Dict[str, Any]],
    *,
    tags_yaml: Union[str, Path, None] = None,
    audience_yaml: Union[str, Path, None] = None,
) -> Dict[str, Any]:
    tags_path = Path(tags_yaml) if tags_yaml is not None else SEED / "tags.yaml"
    audience_path = Path(audience_yaml) if audience_yaml is not None else SEED / "audience.yaml"

    eng = TagComputeEngine()
    eng.load(tags_path)
    result = eng.compute(rows)

    spec = yaml.safe_load(audience_path.read_text(encoding="utf-8")) or {}
    ids = select_audience(
        result.rows,
        spec["query"],
        id_field=spec.get("id_field") or "member_id",
    )
    return {
        "tagged": len(result.rows),
        "computed": list(result.computed),
        "audience_size": len(ids),
        "audience_ids": list(ids),
        "rows": result.rows,
    }
