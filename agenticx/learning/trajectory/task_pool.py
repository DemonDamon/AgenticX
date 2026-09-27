# agenticx/learning/trajectory/task_pool.py
"""多域任务池适配层（SP23）：MiMo-V2.6-RL-oss → 统一任务清单。

三域接入:
- code   (2698): SWE 任务, test_command + test_patch 可执行 verifier, docker 全隔离
- cyber  (1000): 漏洞复现, 规则 verifier（镜像内预置）, docker 全隔离
- general (925): 知识工作, 双容器(main+sidecar) rubric verifier —— 仅收
  deterministic rubric 子集(VERIFY_DETERMINISTIC=1 路径), LLM-judge 拒收

统一契约（与 harbor_reward 的 TaskSpec 对齐）:
  task_id / domain / docker_image / cwd / instruction /
  verifier_type / verifier_ref / difficulty

纪律（SP18/SP21 同源）:
- MiMo 任务全部进训练池; TB4.0 的 12 个 held-out 与 MiMo 任务 ID 空间天然
  无交集（前缀 code-/cyber-/general- vs TB 裸名）, 守卫语义不受影响
- 全量解析后按 verifier_type 过滤: rule/executable 收, judge 型拒
- 入库前过匿名化管道的钩子在 normalize()（SP23 仅对 general 域开 PII 扫描）
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

VERIFIER_EXECUTABLE = "executable"   # code: test_command 可执行
VERIFIER_RULE = "rule"               # cyber/general: 规则判定
VERIFIER_JUDGE = "judge"             # 拒收: LLM/rubric judge

_MIMO_PREFIX = {"code": "code-", "cyber": "cyber-", "general": "general-"}
# general 域环境目录名里直接嵌了真实企业软件名——入库前替换
_ANON_MAP = [
    (re.compile(r"kpmg", re.I), "consulting-firm-a"),
    (re.compile(r"sharepoint", re.I), "collab-platform-a"),
    (re.compile(r"dealcloud", re.I), "deal-desk-a"),
    (re.compile(r"yardi", re.I), "property-reg-a"),
    (re.compile(r"dynamics365|dynamics 365", re.I), "erp-suite-a"),
    (re.compile(r"salesforce", re.I), "crm-suite-a"),
]


@dataclass
class PooledTask:
    """统一任务条目: harbor 侧按 docker_image+verifier_ref 消费。"""
    task_id: str
    domain: str                      # terminal | code | cyber | general
    docker_image: str
    cwd: str
    instruction: str
    verifier_type: str               # executable | rule
    verifier_ref: str                # code: test_command; 其余: 镜像内预置说明
    difficulty: str = "unknown"      # L1-L4, MiMo 侧未标注时 unknown
    source: str = "mimo-rl-oss"
    extras: dict = field(default_factory=dict)

    def to_row(self) -> dict:
        return asdict(self)


def _sanitize(text: str) -> str:
    out = text
    for pat, rep in _ANON_MAP:
        out = pat.sub(rep, out)
    return out


def parse_code_parquet(path: Path) -> list[PooledTask]:
    """code 域: instance_json 带 test_command/test_patch → executable verifier。"""
    import pandas as pd

    df = pd.read_parquet(path)
    tasks: list[PooledTask] = []
    for _, row in df.iterrows():
        info = row["extra_info"]
        if isinstance(info, str):
            info = json.loads(info)
        raw = info["instance_json"]
        ij = json.loads(raw) if isinstance(raw, str) else raw
        tid = f"{_MIMO_PREFIX['code']}{ij['instance_id']}"
        prompt = ""
        for msg in row["prompt"]:
            if msg.get("role") == "user":
                prompt = msg["content"]
                break
        tasks.append(PooledTask(
            task_id=tid,
            domain="code",
            docker_image=ij["docker_image"],
            cwd=ij.get("cwd", "/testbed"),
            instruction=prompt,
            verifier_type=VERIFIER_EXECUTABLE,
            verifier_ref=ij["test_command"],
            extras={
                "timeout_sec": ij.get("verifier_timeout_sec", 900),
                "has_test_patch": bool(ij.get("test_patch")),
            },
        ))
    return tasks


def parse_cyber_parquet(path: Path) -> list[PooledTask]:
    """cyber 域: arvo 漏洞复现, verifier 预置镜像内（规则型）。"""
    import pandas as pd

    df = pd.read_parquet(path)
    tasks: list[PooledTask] = []
    for _, row in df.iterrows():
        info = row["extra_info"]
        if isinstance(info, str):
            info = json.loads(info)
        raw = info.get("instance_json")
        ij = json.loads(raw) if isinstance(raw, str) else (raw or info)
        tid = f"{_MIMO_PREFIX['cyber']}{ij['instance_id']}"
        prompt = ""
        for msg in row["prompt"]:
            if msg.get("role") == "user":
                prompt = msg["content"]
                break
        tasks.append(PooledTask(
            task_id=tid,
            domain="cyber",
            docker_image=ij["docker_image"],
            cwd=ij.get("cwd", "/home/agent"),
            instruction=prompt,
            verifier_type=VERIFIER_RULE,
            verifier_ref="builtin: arvo rule check",
            extras={"description": _sanitize(str(ij.get("description", "")))[:500]},
        ))
    return tasks


def parse_general_manifest(manifest_path: Path, env_dir_name: str) -> PooledTask | None:
    """general 域单环境: manifest.json + run_verify.py → 仅收 deterministic 子集。

    判定: run_verify.py 若含 agent_judge 主路径（VERIFY_AGENT_JUDGE 默认开）
    则拒收; 只收 deterministic rubric 可独立评分的环境。S3K 类环境的
    state.db 比对属于 deterministic, 予以保留。
    """
    manifest = json.loads(manifest_path.read_text())
    verify_py = manifest_path.parent / "run_verify.py"
    if verify_py.exists():
        src = verify_py.read_text()
        # 双开关默认: deterministic=1, judge=0 → deterministic 独立可用
        if "VERIFY_AGENT_JUDGE" in src and 'VERIFY_AGENT_JUDGE=0' not in src:
            return None  # judge 为主路径, 拒收
    tid = f"{_MIMO_PREFIX['general']}{env_dir_name}"
    instruction_file = manifest_path.parent / "instruction.md"
    instruction = instruction_file.read_text() if instruction_file.exists() else ""
    return PooledTask(
        task_id=tid,
        domain="general",
        docker_image="xiaomimimo/mimo-v2.6-rl-oss:general-sidecar",  # 双容器由 manifest 描述
        cwd=manifest.get("cwd", "/work/workspace"),
        instruction=_sanitize(instruction),
        verifier_type=VERIFIER_RULE,
        verifier_ref="run_verify.py (deterministic rubrics)",
        extras={"env_dir": env_dir_name, "containers": "main+sidecar"},
    )


def write_pool_manifest(tasks: list[PooledTask], out_path: Path) -> dict:
    """落盘任务池清单 + 分布统计。"""
    by_domain: dict[str, int] = {}
    by_verifier: dict[str, int] = {}
    for t in tasks:
        by_domain[t.domain] = by_domain.get(t.domain, 0) + 1
        by_verifier[t.verifier_type] = by_verifier.get(t.verifier_type, 0) + 1
    summary = {
        "total": len(tasks),
        "by_domain": by_domain,
        "by_verifier": by_verifier,
        "judge_rejected": sum(1 for t in tasks if t.verifier_type == VERIFIER_JUDGE),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"summary": summary, "tasks": [t.to_row() for t in tasks]}
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    return summary
