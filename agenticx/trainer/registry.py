# agenticx/trainer/registry.py
"""⑥回灌层骨架：Stable Model ID 注册表。

模式（飞书规划 3.2 节）：产品引用别名（agent-carrier-v1），别名背后按版本路由，
candidate→promoted→rollback 生命周期记录。P0 无流量镜像；P2 在 Enterprise
Gateway 落地灰度切流时复用本注册表数据结构。
"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

CANDIDATE, PROMOTED, RETIRED = "candidate", "promoted", "retired"

class ModelRegistry:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._data: dict[str, list[dict]] = self._load()

    def _load(self) -> dict:
        try:
            return json.load(open(self.path))
        except (OSError, json.JSONDecodeError):
            return {}

    def _save(self) -> None:
        json.dump(self._data, open(self.path, "w"), ensure_ascii=False, indent=2)

    def register(self, alias: str, *, model_spec: str, backend: str = "",
                 meta: dict | None = None) -> str:
        version = {
            "version_id": uuid.uuid4().hex[:12],
            "model": model_spec,
            "backend": backend,
            "status": CANDIDATE,
            "registered_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "promoted_at": None,
            "meta": meta or {},
        }
        self._data.setdefault(alias, []).append(version)
        self._save()
        return version["version_id"]

    def _promoted_version(self, alias: str) -> dict | None:
        for v in self._data.get(alias, []):
            if v["status"] == PROMOTED:
                return v
        return None

    def promote(self, alias: str, version_id: str | None = None) -> str:
        versions = self._data.get(alias, [])
        target = None
        if version_id is None:
            cands = [v for v in versions if v["status"] == CANDIDATE]
            if not cands:
                raise LookupError(f"alias '{alias}' 无 candidate 可提升")
            target = cands[-1]
        else:
            target = next((v for v in versions if v["version_id"] == version_id), None)
            if target is None:
                raise LookupError(f"version '{version_id}' 不存在")
        current = self._promoted_version(alias)
        if current is not None:
            current["status"] = RETIRED
        target["status"] = PROMOTED
        target["promoted_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        self._save()
        return target["version_id"]

    def rollback(self, alias: str) -> str | None:
        """回滚：当前 promoted → retired；优先提升最近的 retired，否则提升最新 candidate。"""
        current = self._promoted_version(alias)
        if current is None:
            raise LookupError(f"alias '{alias}' 无 promoted 版本可回滚")
        current["status"] = RETIRED
        versions = self._data[alias]
        previous = next((v for v in reversed(versions)
                         if v["status"] == RETIRED and v is not current), None)
        if previous is None:
            cands = [v for v in versions if v["status"] == CANDIDATE]
            previous = cands[-1] if cands else None
        if previous is not None:
            previous["status"] = PROMOTED
        self._save()
        return previous["version_id"] if previous else None

    def resolve(self, alias: str) -> dict:
        """解析别名 → promoted 版本；无 promoted 则取最新 candidate；两者皆无则报错。"""
        versions = self._data.get(alias)
        if not versions:
            raise LookupError(f"未知模型别名 '{alias}'（注册表: {self.path}）")
        v = self._promoted_version(alias)
        if v is None:
            cands = [x for x in versions if x["status"] == CANDIDATE]
            if not cands:
                raise LookupError(f"alias '{alias}' 无可用版本（promoted/candidate 均无）")
            v = cands[-1]
        return {"model": v["model"], "backend": v["backend"],
                "version_id": v["version_id"], "status": v["status"]}

    def list(self) -> dict[str, list[dict]]:
        return self._data
