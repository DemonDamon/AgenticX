# SP3: 回灌网关骨架 — Stable Model ID 注册表（⑥回灌层）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Stable Model ID 模式（飞书规划 3.2 节）：产品侧引用稳定别名（如 `agent-coding-v1`），注册表路由到具体权重版本，支持 candidate→promoted→rollback 生命周期。P0 骨架不含流量镜像。

**Architecture:** `agenticx/trainer/registry.py` — 注册表持久化于 `~/.agenticx/registry/models.json`，别名 → 版本列表（每版本含 model_spec + status）；`agenticx/trainer/gateway.py` — `resolve_model_alias()` 供 llm_factory 无侵入接入（别名不存在/注册表缺失时原样返回，零风险）。

**Tech Stack:** Python 3.12 stdlib, pytest。与 SP1/SP2 无依赖，可并行。

---

### Task 1: ModelRegistry 核心

**Files:**
- Create: `agenticx/trainer/registry.py`
- Test: `tests/trainer/test_registry.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trainer/test_registry.py
import pytest
from agenticx.trainer.registry import ModelRegistry, VersionStatus

def test_register_and_resolve(tmp_path):
    reg = ModelRegistry(tmp_path / "models.json")
    reg.register("agent-coding-v1", model_spec="openai/glm-5.3-flash",
                 backend="litellm", meta={"origin": "sft-v1"})
    spec = reg.resolve("agent-coding-v1")
    assert spec == {"model": "openai/glm-5.3-flash", "backend": "litellm",
                    "version_id": spec["version_id"], "status": "candidate"}

def test_register_persists_across_instances(tmp_path):
    p = tmp_path / "models.json"
    ModelRegistry(p).register("a-v1", model_spec="m1")
    reg2 = ModelRegistry(p)
    assert reg2.resolve("a-v1")["model"] == "m1"

def test_promote_and_rollback(tmp_path):
    reg = ModelRegistry(tmp_path / "models.json")
    reg.register("a-v1", model_spec="m1")
    reg.register("a-v1", model_spec="m2")
    reg.promote("a-v1")                     # 无版本号 → 提升最新 candidate
    assert reg.resolve("a-v1")["model"] == "m2"
    reg.rollback("a-v1")                    # 回滚到上一可用版本
    assert reg.resolve("a-v1")["model"] == "m1"

def test_rollback_single_version_clears_promoted(tmp_path):
    reg = ModelRegistry(tmp_path / "models.json")
    reg.register("a-v1", model_spec="m1")
    reg.promote("a-v1")
    reg.rollback("a-v1")
    with pytest.raises(LookupError):
        reg.resolve("a-v1")

def test_resolve_unknown_alias_raises(tmp_path):
    with pytest.raises(LookupError):
        ModelRegistry(tmp_path / "models.json").resolve("nope")

def test_list_returns_summary(tmp_path):
    reg = ModelRegistry(tmp_path / "models.json")
    reg.register("a-v1", model_spec="m1")
    listing = reg.list()
    assert listing["a-v1"][0]["model"] == "m1"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trainer/test_registry.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trainer/test_registry.py -v`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/trainer/registry.py tests/trainer/test_registry.py
git commit -m "feat(rsi): stable model ID registry with promote/rollback lifecycle"
```

---

### Task 2: llm_factory 别名接入（无侵入 hook）

**Files:**
- Create: `agenticx/trainer/gateway.py`
- Modify: `agenticx/llms/llm_factory.py`（`create_llm` 入口处加一行解析 hook）
- Test: `tests/trainer/test_gateway.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trainer/test_gateway.py
import json
from agenticx.trainer.gateway import resolve_model_alias, DEFAULT_REGISTRY_PATH

def test_plain_model_string_passthrough(monkeypatch, tmp_path):
    monkeypatch.setattr("agenticx.trainer.gateway.REGISTRY_PATH", tmp_path / "m.json")
    assert resolve_model_alias("openai/glm-5.3-flash") == "openai/glm-5.3-flash"

def test_alias_resolved_to_promoted(monkeypatch, tmp_path):
    monkeypatch.setattr("agenticx.trainer.gateway.REGISTRY_PATH", tmp_path / "m.json")
    from agenticx.trainer.registry import ModelRegistry
    reg = ModelRegistry(tmp_path / "m.json")
    reg.register("agent-coding-v1", model_spec="openai/glm-5.3-flash-tuned-r3")
    reg.promote("agent-coding-v1")
    assert resolve_model_alias("agent-coding-v1") == "openai/glm-5.3-flash-tuned-r3"

def test_corrupt_registry_fails_open(monkeypatch, tmp_path):
    p = tmp_path / "m.json"
    p.write_text("{broken json", encoding="utf-8")
    monkeypatch.setattr("agenticx.trainer.gateway.REGISTRY_PATH", p)
    assert resolve_model_alias("some-alias") == "some-alias"   # 注册表损坏不阻断
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trainer/test_gateway.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```python
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
```

**修改 llm_factory.py**（执行时先 Read 该文件，在 `create_llm` 方法体开头、provider 分支之前插入）：

```python
from agenticx.trainer.gateway import resolve_model_alias

# create_llm 内，解析模型名的第一行之后：
if getattr(config, "model", None):
    config.model = resolve_model_alias(config.model)
```

注意：若 `config` 的模型字段名不是 `model`（以实际代码为准），按实际字段名对接；若 llm_factory 不持有 model 字段而是透传 kwargs，则在透传处包一层 `resolve_model_alias`。执行者必须先读文件再定插入点，禁止盲改。

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trainer/test_gateway.py -v && python -m pytest tests/ -k "llm or factory" -v`
Expected: 新测试 3 PASS；现有 llm/factory 相关测试无回归

- [ ] **Step 5: Commit**

```bash
git add agenticx/trainer/gateway.py agenticx/llms/llm_factory.py tests/trainer/test_gateway.py
git commit -m "feat(rsi): fail-open model alias hook wired into llm_factory"
```

---

### Task 3: registry CLI

**Files:**
- Modify: `agenticx/trainer/__main__.py`（加 registry 子命令）
- Test: `tests/trainer/test_registry_cli.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trainer/test_registry_cli.py
import json
import subprocess
import sys
from pathlib import Path

def run_cli(*args, registry):
    return subprocess.run(
        [sys.executable, "-m", "agenticx.trainer", "registry", *args,
         "--registry", str(registry)],
        capture_output=True, text=True)

def test_registry_lifecycle(tmp_path):
    reg = tmp_path / "models.json"
    r = run_cli("register", "agent-coding-v1", "--model", "openai/glm-5.3-flash-tuned",
                "--backend", "litellm", registry=reg)
    assert r.returncode == 0, r.stderr
    p = run_cli("promote", "agent-coding-v1", registry=reg)
    assert p.returncode == 0, p.stderr
    v = run_cli("resolve", "agent-coding-v1", registry=reg)
    assert "glm-5.3-flash-tuned" in v.stdout
    l = run_cli("list", registry=reg)
    assert "agent-coding-v1" in l.stdout
    rb = run_cli("rollback", "agent-coding-v1", registry=reg)
    assert rb.returncode == 0
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trainer/test_registry_cli.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**（在 `agenticx/trainer/__main__.py` 追加）

```python
from .registry import ModelRegistry

def _make_reg(path: str) -> ModelRegistry:
    return ModelRegistry(Path(path))

def _cmd_registry(args) -> int:
    reg = _make_reg(args.registry)
    if args.action == "register":
        vid = reg.register(args.alias, model_spec=args.model, backend=args.backend)
        print(json.dumps({"registered": vid}))
    elif args.action == "promote":
        print(json.dumps({"promoted": reg.promote(args.alias)}))
    elif args.action == "rollback":
        print(json.dumps({"rollback_to": reg.rollback(args.alias)}))
    elif args.action == "resolve":
        print(json.dumps(reg.resolve(args.alias), ensure_ascii=False))
    elif args.action == "list":
        print(json.dumps(reg.list(), ensure_ascii=False, indent=2))
    return 0

# main() 的 subparsers 中追加:
r = sub.add_parser("registry")
r.add_argument("action", choices=["register", "promote", "rollback", "resolve", "list"])
r.add_argument("alias", nargs="?", default=None)
r.add_argument("--model", default="")
r.add_argument("--backend", default="")
r.add_argument("--registry", default=str(Path.home() / ".agenticx/registry/models.json"))
r.set_defaults(func=_cmd_registry)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trainer/ -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/trainer/__main__.py tests/trainer/test_registry_cli.py
git commit -m "feat(rsi): registry CLI — register/promote/rollback/resolve/list"
```
