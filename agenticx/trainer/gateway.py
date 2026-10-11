# agenticx/trainer/gateway.py
"""⑥回灌层：别名 → 具体模型 的解析入口。

fail-open 设计：含 "/" 的具体模型名原样返回；无斜杠的短名可能是别名也可能是
裸模型名（如 gpt-4o）——注册表缺失/损坏/别名未注册时一律原样返回，
回灌网关故障不得阻断生产调用。仅"纯别名且注册表命中"时替换。
"""
from __future__ import annotations

from pathlib import Path

DEFAULT_REGISTRY_PATH = Path.home() / ".agenticx" / "registry" / "models.json"
REGISTRY_PATH = DEFAULT_REGISTRY_PATH

def resolve_model_alias(model: str) -> str:
    if not model or "/" in model:          # 具体模型名（provider/model）不是别名
        return model
    try:
        from .registry import ModelRegistry
        return ModelRegistry(REGISTRY_PATH).resolve(model)["model"]
    except Exception:
        return model                       # 未知别名/注册表缺失/损坏 → fail-open 原样返回
