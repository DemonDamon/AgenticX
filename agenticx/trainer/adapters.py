# agenticx/trainer/adapters.py
"""⑥回灌层：Adapter 一等公民注册表（SP30 T6）。

对标 Macaron-V1 Mixture-of-LoRA：LoRA 从一次性微调产物变成经验积累的基本
单元——共享基座 + N 个按 skill/租户独立版本化的 adapter，各自
candidate→promoted→retired 生命周期。运营商私有化场景 = 共享基座 + 按租户
隔离的 adapter（与 server/tenant.py 多租户故事咬合）。

边界（本 SP）：只定契约 + 注册表 + manifest 信封。不接 llm_factory 推理路由、
不产生真实权重——P1 训练落地时消费 compose 指令与 manifest。
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

CANDIDATE, PROMOTED, RETIRED = "candidate", "promoted", "retired"


@dataclass
class AdapterRecord:
    alias: str
    version_id: str
    base_model: str
    adapter_uri: str
    skill_tags: list[str] = field(default_factory=list)
    tenant: str = ""                     # "" = 全局/基座侧
    lineage: dict = field(default_factory=dict)   # datasets/trajectories/heldout/…
    status: str = CANDIDATE
    registered_at: str = ""
    promoted_at: str | None = None


def _ns_key(tenant: str, alias: str) -> str:
    return f"{tenant}::{alias}" if tenant else alias


class AdapterRegistry:
    """与 ModelRegistry 平行的独立注册表：ModelRegistry 管「整模型」，
    AdapterRegistry 管「基座 + 增量」（不继承、不跨查，语义不混用）。"""

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
        json.dump(self._data, open(self.path, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)

    def _versions(self, alias: str, tenant: str = "") -> dict[str, dict]:
        """alias → {version_id: version_dict}（测试/调试用只读视图）。"""
        return {v["version_id"]: v
                for v in self._data.get(_ns_key(tenant, alias), [])}

    # ---------------------------------------------------------------- 生命周期

    def register(self, alias: str, *, base_model: str, adapter_uri: str,
                 skill_tags: list[str] | None = None, tenant: str = "",
                 lineage: dict | None = None) -> str:
        rec = AdapterRecord(
            alias=alias, version_id=uuid.uuid4().hex[:12],
            base_model=base_model, adapter_uri=adapter_uri,
            skill_tags=list(skill_tags or []), tenant=tenant,
            lineage=dict(lineage or {}),
            status=CANDIDATE, registered_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
        )
        self._data.setdefault(_ns_key(tenant, alias), []).append(asdict(rec))
        self._save()
        return rec.version_id

    def _promoted_version(self, versions: list[dict]) -> dict | None:
        return next((v for v in versions if v["status"] == PROMOTED), None)

    def promote(self, alias: str, version_id: str, *, tenant: str = "") -> str:
        versions = self._data.get(_ns_key(tenant, alias), [])
        target = next((v for v in versions if v["version_id"] == version_id), None)
        if target is None:
            raise LookupError(f"version '{version_id}' 不存在"
                              f"（alias='{alias}', tenant='{tenant}'）")
        current = self._promoted_version(versions)
        if current is not None:
            current["status"] = RETIRED
        target["status"] = PROMOTED
        target["promoted_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        self._save()
        return target["version_id"]

    def rollback(self, alias: str, *, tenant: str = "") -> str | None:
        versions = self._data.get(_ns_key(tenant, alias), [])
        current = self._promoted_version(versions)
        if current is None:
            raise LookupError(f"alias '{alias}'（tenant='{tenant}'）"
                              f"无 promoted 版本可回滚")
        current["status"] = RETIRED
        previous = next((v for v in reversed(versions)
                         if v["status"] == RETIRED and v is not current), None)
        if previous is None:
            cands = [v for v in versions if v["status"] == CANDIDATE]
            previous = cands[-1] if cands else None
        if previous is not None:
            previous["status"] = PROMOTED
        self._save()
        return previous["version_id"] if previous else None

    # ---------------------------------------------------------------- 解析

    def resolve(self, alias: str, *, tenant: str = "") -> dict:
        versions = self._data.get(_ns_key(tenant, alias))
        if not versions:
            raise LookupError(
                f"未知 adapter 别名 '{alias}'（tenant='{tenant}', "
                f"注册表: {self.path}）")
        v = self._promoted_version(versions)
        if v is None:
            cands = [x for x in versions if x["status"] == CANDIDATE]
            if not cands:
                raise LookupError(f"alias '{alias}' 无可用版本"
                                  f"（promoted/candidate 均无）")
            v = cands[-1]
        return {
            "model": v["base_model"],
            "adapter_uri": v["adapter_uri"],
            "compose": "base+adapter",       # P1 推理路由消费的组装指令
            "version_id": v["version_id"],
            "skill_tags": v["skill_tags"],
            "status": v["status"],
        }

    def list(self) -> dict[str, list[dict]]:
        return self._data
