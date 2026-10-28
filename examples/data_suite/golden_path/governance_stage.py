"""Stage 3a: dictionary + quality rollup on golden-path rows."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Union

from agenticx.data_suite.governance.dictionary import DictionaryCatalog
from agenticx.data_suite.governance.quality import QualityRollup

ROOT = Path(__file__).resolve().parent
SEED = ROOT / "seed"


def run_governance_stage(
    rows: List[Dict[str, Any]],
    *,
    dictionary_yaml: Union[str, Path, None] = None,
    quality_yaml: Union[str, Path, None] = None,
    day: str = "2026-10-28",
    quarantine: Optional[List[Mapping[str, Any]]] = None,
) -> Dict[str, Any]:
    dict_path = Path(dictionary_yaml) if dictionary_yaml is not None else SEED / "dictionary.yaml"
    quality_path = Path(quality_yaml) if quality_yaml is not None else SEED / "quality.yaml"

    catalog = DictionaryCatalog()
    catalog.load(dict_path)
    fields = catalog.list_fields()

    rollup = QualityRollup()
    rollup.load_metrics(quality_path)
    snap = rollup.compute_day(day, rows, quarantine=list(quarantine or []))
    return {
        "catalog_fields": len(fields),
        "field_names": [f.name for f in fields],
        "quality": {"day": snap.day, "metrics": dict(snap.metrics)},
    }
