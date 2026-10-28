from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Union

import yaml

STRATEGIES = frozenset({"full", "partial", "hash", "drop"})


@dataclass(frozen=True)
class FieldRule:
    field: str
    sensitivity: str
    strategies: Dict[str, str]
    default_strategy: str = "full"

    def strategy_for(self, role: str) -> str:
        return self.strategies.get(role, self.default_strategy)


@dataclass(frozen=True)
class MaskingPolicy:
    id: str
    rules: List[FieldRule]


def load_masking_policy(path: Union[str, Path]) -> MaskingPolicy:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    rules: List[FieldRule] = []
    for row in data.get("rules") or []:
        default = str(row.get("default_strategy") or "full")
        strategies = {str(k): str(v) for k, v in (row.get("strategies") or {}).items()}
        for name in [default, *strategies.values()]:
            if name not in STRATEGIES:
                raise ValueError(f"unknown mask strategy: {name}")
        rules.append(
            FieldRule(
                field=str(row["field"]),
                sensitivity=str(row.get("sensitivity") or "internal"),
                strategies=strategies,
                default_strategy=default,
            )
        )
    return MaskingPolicy(id=str(data.get("id") or ""), rules=rules)
