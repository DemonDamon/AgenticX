#!/usr/bin/env python3
"""BRS-lite 自探索驱动器（SP16）：RSIAgent 广域自探索的最小等价物。

闭环: 每轮 冻结记忆→hints 注入模型服务系统提示 → harbor trial（真实容器）
      → 轨迹入库(TrialForest 底座) + 经验提取入库 → 轮末 freeze → 下一轮复用。
      --evolve 时每轮末在 train 区跑策略演化（SP8 纪律: heldout 不参与选择）。

用法:
  CPU 冒烟（零 Docker/零模型, 全流程逻辑验证）:
    python3 scripts/rsi_explore.py --dry --rounds 2 --task /tmp/fake-taskA
  真跑（本机 MPS 0.6B 或 GPU 机）:
    python3 scripts/rsi_explore.py --model Qwen/Qwen3-0.6B \
        --task /path/to/tb40-taskA --task /path/to/tb40-taskB --rounds 3 --evolve
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.trajectory.evolution import (   # noqa: E402
    SEED_POLICY_SOURCE, PolicyRegistry, compile_policy, evolve_loop,
    mutate_policy_source,
)
from agenticx.learning.trajectory.forest import TrialForest      # noqa: E402
from agenticx.learning.trajectory.memory import (     # noqa: E402
    ExperienceMemory, extract_lessons, format_hints,
)
from agenticx.learning.trajectory.replay import evaluate_policy, forest_score  # noqa: E402
from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord    # noqa: E402
from agenticx.learning.trajectory.store import TrajectoryStore  # noqa: E402
from agenticx.trainer.heldout import heldout_split    # noqa: E402

_FAKE_ERROR_MSGS = [
    {"role": "user", "content": "solve the task"},
    {"role": "assistant", "content": "", "tool_calls": [{"id": "1"}]},
    {"role": "tool", "content": "error: FileNotFoundError: config.yaml not found"},
    {"role": "assistant", "content": "final answer"},
]


def _fake_trial(trials_dir: Path, task_path: str, round_no: int) -> tuple[float, Path]:
    """dry 模式: 伪造 harbor trial 产物（result.json + agent 轨迹）。"""
    name = f"{Path(task_path).name}__dry{round_no}_{abs(hash(task_path)) % 9973}"
    d = trials_dir / name
    (d / "agent").mkdir(parents=True, exist_ok=True)
    (d / "result.json").write_text(json.dumps(
        {"verifier_result": {"rewards": {"reward": 0.0}}}))
    (d / "agent" / "agenticx.trajectory.json").write_text(json.dumps(
        {"messages": _FAKE_ERROR_MSGS}))
    return 0.0, d


def _parse_trial(trial_dir: Path, task_name: str, reward: float, model: str,
                 source: str) -> RSITrajectory:
    data = json.loads((trial_dir / "agent" / "agenticx.trajectory.json").read_text())
    return RSITrajectory(
        source=source, task_id=task_name, session_id=trial_dir.name,
        model=model, status="pass" if reward >= 1.0 else "fail",
        reward=RewardRecord(label=float(reward)),
        messages=data.get("messages", []))


def _evolve(store: TrajectoryStore, out_dir: Path, iters: int = 3):
    """SP8 同款纪律: 只用 train 区评分; 种子未注册先注册并 promote。"""
    forest = TrialForest.from_trajectories(store.iter_trajectories())
    if not forest.trees:
        return None
    split = heldout_split(sorted(forest.trees), seed="v1")

    def evaluate_fn(policy) -> float:
        return forest_score(evaluate_policy(policy, forest,
                                            task_ids=list(split.train)))

    reg = PolicyRegistry(out_dir / "policies.json")
    if reg.current() is None:
        v = reg.register(SEED_POLICY_SOURCE,
                         score=evaluate_fn(compile_policy(SEED_POLICY_SOURCE)),
                         lineage="seed")
        reg.promote(v)
    return evolve_loop(reg, evaluate_fn=evaluate_fn,
                       propose_fn=lambda cur, fb: mutate_policy_source(cur),
                       n_iters=iters)


def run_round(round_no: int, tasks: list[str], memory: ExperienceMemory,
              store: TrajectoryStore, *, trials_root: Path, dry: bool = False,
              evolve: bool = False, lm=None, tokenizer=None,
              model_name: str = "dry-model", timeout: float = 1800.0) -> dict:
    """跑一轮自探索。返回 {"results": [...], "evolution": ...} 形报告。

    记忆语义（对齐 RSIAgent frozen memory）: 本轮注入的是【上一轮冻结】的
    经验; 本轮新经验提取后写入独立轮次文件, 轮末 freeze 供下一轮读。
    """
    trials_root = Path(trials_root)
    prev = trials_root.parent / "experience" / f"round_{round_no - 1}.json"
    hints = ""
    if round_no > 1 and prev.exists():
        hints = format_hints(ExperienceMemory(prev).all_lessons(k=8))

    if memory.path.exists() and (memory.is_frozen or memory.all_lessons()):
        # 真跑踩坑修复: 既往运行的冻结记忆会让本轮 add() 被静默跳过,
        # 真实经验无声丢失——宁可响亮失败, 不许静默污染。
        raise RuntimeError(
            f"{memory.path} 残留既往运行状态（frozen={memory.is_frozen}, "
            f"lessons={len(memory.all_lessons())}）——换新 --out 目录或清理后重跑")

    srv = None
    base_url = None
    if not dry:
        from agenticx.rl.model_server import serve_model
        srv = serve_model(lm, tokenizer, model_id="agenticx-rl",
                          system_extra=hints or None)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base_url = f"http://host.docker.internal:{srv.server_address[1]}/v1"

    results = []
    for task_path in tasks:
        task_name = Path(task_path).name
        tdir = trials_root / f"round_{round_no}"
        if dry:
            reward, trial_dir = _fake_trial(tdir, task_path, round_no)
        else:
            from agenticx.rl.harbor_reward import run_harbor_trial
            reward, trial_dir = run_harbor_trial(
                task_path, "openai/agenticx-rl", base_url,
                trials_dir=tdir, timeout=timeout)
        store.append(_parse_trial(trial_dir, task_name, reward,
                                  model_name, "harbor-explore"
                                  if not dry else "dry-explore"))
        lessons = extract_lessons(task_name, reward >= 1.0,
                                  json.loads((trial_dir / "agent" /
                                              "agenticx.trajectory.json")
                                             .read_text())["messages"])
        if not memory.is_frozen:
            memory.add(lessons, round_no)
        results.append({"task": task_name, "reward": float(reward),
                        "hints": hints})
    if srv is not None:
        srv.shutdown()

    memory.freeze()
    report = {"round": round_no, "results": results, "evolution": None}
    if evolve:
        from dataclasses import asdict
        evo = _evolve(store, trials_root.parent / "policies")
        report["evolution"] = asdict(evo) if evo is not None else None
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", action="append", required=True,
                    help="任务目录（可多次）")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--evolve", action="store_true")
    ap.add_argument("--model", default="Qwen/Qwen3-0.6B")
    ap.add_argument("--out", default="datasets/explore")
    args = ap.parse_args()

    out = Path(args.out)
    lm = tokenizer = None
    if not args.dry:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        device = ("cuda" if torch.cuda.is_available()
                  else "mps" if torch.backends.mps.is_available() else "cpu")
        tokenizer = AutoTokenizer.from_pretrained(args.model)
        lm = AutoModelForCausalLM.from_pretrained(args.model).to(device)

    summary = []
    for r in range(1, args.rounds + 1):
        memory = ExperienceMemory(out / "experience" / f"round_{r}.json")
        store = TrajectoryStore(out / "store")
        t0 = time.time()
        rep = run_round(r, args.task, memory, store, trials_root=out / "trials",
                        dry=args.dry, evolve=args.evolve, lm=lm,
                        tokenizer=tokenizer, model_name=args.model)
        rep["seconds"] = round(time.time() - t0, 1)
        summary.append(rep)
        print(json.dumps(rep, ensure_ascii=False))
    print(json.dumps({"rounds": len(summary)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
