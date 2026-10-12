#!/usr/bin/env python
"""回放侧 gating A/B（SP27 T3）：决策头 continue/abort vs 启发式基线。

TrialForest 回放（零 live LLM、零额外执行成本）：4 个基线策略 +
DecisionHeadPolicy（多 tau），≥3 seeds × train/held-out 双区，汇总
成功率 / 平均成本（est tokens）/ 放弃率。

用法:
  # mock 冒烟（无网全链路，数字无结论意义）
  python scripts/eval_gating_ab.py --jobs-dir harness-lab/jobs \
      --job-pattern '*tb21mix*' --scorer mock

  # StartLux-Decision 4B 本地服务（scripts/serve_decision_model.sh 先起服务）
  python scripts/eval_gating_ab.py --jobs-dir harness-lab/jobs \
      --job-pattern '*tb21mix*' --scorer startlux --taus 0.5 0.6 0.7

调用量控制：scorer 是 (state, question) 的确定性纯函数，按 state 做跨
tau/seed 的 memo 缓存——首个 attempt 的 state 对所有策略完全一致，命中
率高；后续 attempt 的 spent_so_far 依策略行为分化，各自独立成键。
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agenticx.learning.trajectory.decision_policy import (  # noqa: E402
    DecisionHeadPolicy,
    render_step_state,
)
from agenticx.learning.trajectory.forest import TrialForest  # noqa: E402
from agenticx.learning.trajectory.harbor_collector import collect_jobs  # noqa: E402
from agenticx.learning.trajectory.policy import baseline_policies, policy_report  # noqa: E402
from agenticx.learning.trajectory.replay import (  # noqa: E402
    AttemptContext,
    evaluate_policy_on_tree,
    summarize,
)
from agenticx.rl.decision import DecisionQuestion, DecisionRecord  # noqa: E402
from agenticx.rl.decision_scorers import make_scorer  # noqa: E402


def _stride_tasks(forest: TrialForest, n: int) -> list[str]:
    """等距抽 n 个 task（保代表性：pass/fail 混合按原比例），确定性。"""
    ids = sorted(forest.trees)
    if n >= len(ids):
        return ids
    step = len(ids) / n
    return [ids[int(i * step)] for i in range(n)]


def _parallel_policy_report(policies, forest, *, seed, ratio, max_attempts,
                            workers):
    """policy_report 的并行版：任务级线程池（与库版同语义：heldout_split +
    evaluate + summarize）。scorer 走共享缓存，线程安全（确定性纯函数）。"""
    from agenticx.trainer.heldout import heldout_split
    split = heldout_split(sorted(forest.trees), seed=seed, ratio=ratio)
    out = {"seed": seed, "max_attempts": max_attempts,
           "heldout_tasks": list(split.heldout), "train": {}, "heldout": {}}
    for p in policies:
        with ThreadPoolExecutor(workers) as pool:
            for split_name, ids in (("train", list(split.train)),
                                    ("heldout", list(split.heldout))):
                scores = list(pool.map(
                    lambda t: evaluate_policy_on_tree(
                        p, forest.trees[t], max_attempts), ids))
                out[split_name][p.name] = summarize(scores)
    return out


def _abort_record(task_id: str, attempt_index: int, attempts_remaining: int,
                  obs) -> DecisionRecord:
    """与 DecisionHeadPolicy._p_abort 同构的 q_abort 记录（prewarm 用）。"""
    import uuid
    q = DecisionQuestion(qid="q_abort", type="yes_no",
                         question="该尝试已无成功希望，应立即止损放弃吗？")
    return DecisionRecord(
        decision_id=f"pre-{uuid.uuid4().hex[:12]}",
        rollout_id=f"{task_id}#{attempt_index}",
        turn=obs.step, task_id=task_id, decision_type="continue_stop",
        state=render_step_state(obs, AttemptContext(
            task_id=task_id, attempt_index=attempt_index,
            attempts_remaining=attempts_remaining, spent_so_far=0)),
        state_compressor="step-features-v1", questions=(q,), created_at="")


class CachedScorer:
    """按 (state, qid) memo 的 scorer 包装：确定性纯函数可安全缓存。

    persist_path: jsonl 断点续跑——启动时加载已有 (key, probs)，新结果
    追加落盘（服务不稳/slot 死锁时 kill 重跑不丢已打分状态）。
    miss 路径带 2 次重试（偶发连接失败自愈；持续失败向上抛由
    fail-open / 崩溃重跑兜底）。
    """

    def __init__(self, inner, persist_path: str = ""):
        self.inner = inner
        self._cache: dict[str, dict] = {}
        self.hits = 0
        self._lock = threading.Lock()
        self._persist = None
        if persist_path:
            p = Path(persist_path)
            p.parent.mkdir(parents=True, exist_ok=True)
            if p.exists():
                with p.open(encoding="utf-8") as f:
                    for line in f:
                        row = json.loads(line)
                        self._cache[row["key"]] = row["probs"]
                print(f"缓存续跑: 从 {p} 加载 {len(self._cache)} 条",
                      flush=True)
            self._persist = p.open("a", encoding="utf-8")

    def __call__(self, rec):
        key = rec.state + "\x00" + ",".join(q.qid for q in rec.questions)
        with self._lock:
            if key in self._cache:
                self.hits += 1
                return self._cache[key]
        out = None
        for attempt in range(3):
            try:
                out = self.inner(rec)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(5)
        with self._lock:
            self._cache[key] = out
            if self._persist is not None:
                self._persist.write(json.dumps(
                    {"key": key, "probs": out}, ensure_ascii=False) + "\n")
                self._persist.flush()
        return out

    @property
    def misses(self) -> int:
        return len(self._cache)


class CountingPolicy:
    """协议透传 + abort/act 计数（报告放弃率用）。"""

    def __init__(self, inner):
        self.inner = inner
        self.n_aborts = 0
        self.n_acts = 0

    @property
    def name(self) -> str:
        return self.inner.name

    def act(self, obs, ctx):
        a = self.inner.act(obs, ctx)
        self.n_acts += 1
        if a == "abort":
            self.n_aborts += 1
        return a


def main() -> None:
    ap = argparse.ArgumentParser(description="回放侧 gating A/B（SP27）")
    ap.add_argument("--jobs-dir", default="harness-lab/jobs")
    ap.add_argument("--job-pattern", default="*tb21mix*",
                    help="job 目录 glob（真实 TB 数据是 agenticx-broken-tb21mix-rN）")
    ap.add_argument("--scorer", choices=("mock", "openai", "startlux",
                                         "trained"),
                    default="mock")
    ap.add_argument("--base-url", default="")
    ap.add_argument("--model", default="")
    ap.add_argument("--taus", nargs="+", type=float, default=[0.5, 0.6, 0.7],
                    help="DecisionHeadPolicy 的 tau_abort 扫描")
    ap.add_argument("--seeds", nargs="+", default=["v1", "v2", "v3"])
    ap.add_argument("--max-attempts", type=int, default=3)
    ap.add_argument("--ratio", type=float, default=0.2)
    ap.add_argument("--limit-attempts", type=int, default=0,
                    help="只回放前 N 条轨迹（0=全部，冒烟用）")
    ap.add_argument("--limit-tasks", type=int, default=0,
                    help="等距抽样 N 个任务（0=全部；服务吞吐受限时收敛用）")
    ap.add_argument("--parallel-tasks", type=int, default=1,
                    help="评测期任务级并行线程数（1=顺序，与库版 policy_report 同）")
    ap.add_argument("--prewarm-workers", type=int, default=4,
                    help="attempt-0 state 并行预热线程数（0=关；mock 无需）")
    ap.add_argument("--dump-decisions", default="",
                    help="把 attempt-0 打分落成带 teacher 标签的 DecisionLog"
                         "（continue_stop 数据资产，复用 backfill_teacher）")
    ap.add_argument("--dump-only", action="store_true",
                    help="只 prewarm + dump，不跑策略评测（数据资产单独产出）")
    ap.add_argument("--cache-file", default="",
                    help="scorer 结果持久缓存 jsonl（断点续跑；默认"
                         " results/decision-layer/gating/scorer_cache.jsonl，"
                         "mock 不落盘）")
    ap.add_argument("--out", default="results/decision-layer/gating")
    args = ap.parse_args()

    trajs = list(collect_jobs(Path(args.jobs_dir), job_pattern=args.job_pattern))
    if args.limit_attempts:
        trajs = trajs[: args.limit_attempts]
    if not trajs:
        raise SystemExit(f"未收集到轨迹: {args.jobs_dir}/{args.job_pattern}")
    forest = TrialForest.from_trajectories(trajs)
    if args.limit_tasks:
        keep = set(_stride_tasks(forest, args.limit_tasks))
        forest = TrialForest(
            trees={k: v for k, v in forest.trees.items() if k in keep})
    stats = forest.stats()
    print(f"forest: {stats['n_tasks']} tasks / {stats['n_attempts']} attempts"
          f" / pass率(tasks_with_pass/n_tasks)="
          f"{stats['tasks_with_pass']}/{stats['n_tasks']}")

    scorer, scorer_id = make_scorer(args.scorer, model=args.model,
                                    base_url=args.base_url)
    cache_file = (args.cache_file
                  if args.cache_file is not None and args.cache_file != ""
                  else ("" if args.scorer == "mock"
                        else str(Path(args.out) / "scorer_cache.jsonl")))
    cached = CachedScorer(scorer, persist_path=cache_file)

    # attempt-0 预热：其 state（spent_so_far=0）对所有策略/seed/tau 完全
    # 一致，并行打分填缓存 → 正式回放几乎全命中；后续 attempt 的
    # spent_so_far 依策略行为分化，只能回放时现场打分。
    prewarm_records: list[DecisionRecord] = [
        _abort_record(t.task_id, 0,
                      min(len(t.attempts), args.max_attempts) - 1, obs)
        for t in forest.trees.values() if t.attempts
        for obs in t.attempts[0].steps]
    if args.prewarm_workers > 0 and args.scorer != "mock":
        print(f"prewarm: {len(prewarm_records)} 个 attempt-0 state，"
              f"{args.prewarm_workers} 线程 …", flush=True)
        with ThreadPoolExecutor(args.prewarm_workers) as pool:
            for _ in pool.map(cached, prewarm_records):
                pass
        print(f"prewarm 完成，缓存 {cached.misses} 条", flush=True)

    # 数据资产（SP29a 升级）：attempt-0 的 continue_stop 决策点——
    # teacher 软标签 + execution 真值（attempt 终局）+ rollout 粒度三分
    if args.dump_decisions:
        from agenticx.rl.decision import (DecisionLog, assign_split,
                                          backfill_outcomes_missing,
                                          backfill_teacher,
                                          merge_decision_records)
        n = backfill_teacher(prewarm_records, cached,
                             teacher_model=scorer_id)
        dpath = Path(args.dump_decisions)
        # 幂等扩容：目标已存在则按 (rollout_id, turn) 合并——既有标签/
        # outcome/split 保留，只追加新 rollout（重跑同源 = 新增 0）
        existing = (DecisionLog.load(dpath).records if dpath.exists()
                    else [])
        records, n_new = merge_decision_records(existing, prewarm_records)
        # execution 真值：forest attempt-0 终局（passed = reward≥1.0）
        outcomes = {}
        for t in forest.trees.values():
            if t.attempts:
                a0 = t.attempts[0]
                outcomes[f"{t.task_id}#0"] = {
                    "ok": a0.passed,
                    "task_status": "pass" if a0.passed else "fail",
                    "note": f"attempt-0 terminal; status={a0.status}; "
                            f"reward={a0.reward_label}"}
        n_out = backfill_outcomes_missing(records, outcomes)
        assign_split(records)          # 确定性三分（重算幂等，split 冻结）
        DecisionLog(records=records).save(dpath)
        n_split = {"train": 0, "calib": 0, "test": 0, "": 0}
        for r in records:
            n_split[r.split or ""] = n_split.get(r.split or "", 0) + 1
        print(f"数据资产: {dpath}（{len(records)} 条 continue_stop，"
              f"新增 {n_new}，teacher 标签 {n}，真值回填 {n_out}，"
              f"split train/calib/test="
              f"{n_split['train']}/{n_split['calib']}/{n_split['test']}"
              + (f"（{n_split['']} 条未分桶）" if n_split[""] else "")
              + "）", flush=True)
    if args.dump_only:
        print("dump-only 模式：跳过策略评测")
        return

    # per-seed 跑全策略表；聚合 mean(range) 出双区汇总
    per_seed: dict[str, list[dict]] = {}
    for seed in args.seeds:
        policies = [CountingPolicy(b) for b in baseline_policies()] + [
            CountingPolicy(DecisionHeadPolicy(cached, tau_abort=t))
            for t in args.taus]
        if args.parallel_tasks > 1:
            report = _parallel_policy_report(
                policies, forest, seed=seed, ratio=args.ratio,
                max_attempts=args.max_attempts, workers=args.parallel_tasks)
        else:
            report = policy_report(policies, forest, seed=seed,
                                   ratio=args.ratio,
                                   max_attempts=args.max_attempts)
        per_seed[seed] = [
            {"name": p.name, "split": split,
             **report[split][p.name],
             "abort_rate": (p.n_aborts / p.n_acts) if p.n_acts else 0.0,
             "n_degraded": getattr(p.inner, "n_degraded", 0)}
            for p in policies for split in ("train", "heldout")]
        print(f"seed={seed} 完成"
              f"（cache {cached.hits} hit / {cached.misses} miss）", flush=True)

    # 聚合
    def agg(name: str, split: str, key: str) -> tuple[float, float]:
        vals = [row[key] for s in per_seed.values()
                for row in s if row["name"] == name and row["split"] == split]
        return (sum(vals) / len(vals), max(vals) - min(vals)) if vals else (0.0, 0.0)

    names = [row["name"] for row in next(iter(per_seed.values()))
             if row["split"] == "train"]
    summary = {split: {n: {k: agg(n, split, k)
                           for k in ("pass_rate", "avg_cost", "abort_rate")}
                        for n in names} for split in ("train", "heldout")}

    out = {"meta": {
        "jobs_dir": args.jobs_dir, "job_pattern": args.job_pattern,
        "scorer_id": scorer_id, "degraded": args.scorer == "mock",
        "seeds": args.seeds, "taus": args.taus,
        "max_attempts": args.max_attempts, "ratio": args.ratio,
        "forest": stats, "cache": {"hits": cached.hits, "misses": cached.misses},
        "n_degraded": sum(row["n_degraded"] for rows in per_seed.values()
                          for row in rows),
    }, "per_seed": per_seed, "summary": summary}

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "gating_ab.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    deg = " （mock，数字无结论意义）" if out["meta"]["degraded"] else ""
    lines = [
        "# Loop Gating A/B 报告（回放侧）",
        "",
        f"- scorer: `{scorer_id}`{deg}",
        f"- forest: {stats['n_tasks']} tasks / {stats['n_attempts']} attempts"
        f"（有通过记录的任务 {stats['tasks_with_pass']}）",
        f"- seeds: {', '.join(args.seeds)}  taus: {args.taus}"
        f"  max_attempts: {args.max_attempts}",
        f"- scorer 调用: {cached.misses} 次（缓存命中 {cached.hits} 次）",
        "",
    ]
    for split, title in (("train", "train 区（策略选择只看这里）"),
                         ("heldout", "held-out 区（仅验收，不参与选择）")):
        lines += [f"## {title}", "",
                  "| policy | pass_rate | avg_cost(est tok) | abort_rate |",
                  "|---|---|---|---|"]
        for n in names:
            m, r = summary[split][n]["pass_rate"]
            c, cr = summary[split][n]["avg_cost"]
            a, _ = summary[split][n]["abort_rate"]
            lines.append(f"| {n} | {m:.3f} (±{r / 2:.3f}) "
                         f"| {c:.0f} (±{cr / 2:.0f}) | {a:.3f} |")
        lines.append("")
    lines += [
        "## 判读",
        "",
        "- 决策头若在 train 区 pass_rate ≥ never_abort 且 avg_cost 更低，",
        "  则 V3「守门员降本」获得回放证据；否则记录负结果（同样有价值）。",
        "- held-out 区数字仅用于验收，不作为调 tau 的依据（防过拟合）。",
    ]
    (out_dir / "gating_ab.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    best = max(names, key=lambda n: summary["train"][n]["pass_rate"][0])
    print(f"报告: {out_dir}/gating_ab.md")
    print(f"train 区 pass_rate 最高: {best} "
          f"{summary['train'][best]['pass_rate'][0]:.3f}")


if __name__ == "__main__":
    main()
