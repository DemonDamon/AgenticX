# agenticx/learning/trajectory/regularization.py
"""经验层正则化（SP21 · Google RRSI 论文吸收）。

RRSI（Recursive Regularized Self-Improvement）研究冻结模型、只演化 harness
时怎么不被三件事毁掉：基准特异拟合、噪声追逐、复杂度累积。本模块把它的
三道选择门移植到我们的经验层（对象: memory.Lesson / evolution 策略演化）：

  1) 泄漏筛查 screen_leakage —— 教训文本里出现任务专有标识
     （他人任务 ID / 绝对路径 / 长十六进制 / host:port）→ 拒绝。
     基准特异技巧能涨分但换任务就废，宁可不学。
  2) 回放验收 admission_gate / prune_with_replay —— 用已记录轨迹做零成本
     回放：错误模式在历史 attempt 上的出现组 vs 未出现组的通过率差
     δ = pass(with) − pass(without)。δ ≈ 0 说明该模式不构成缺陷信号
     （噪声或任务难度），不进库 / 被剪枝。这是 RRSI "noise-adjusted
     performance gate" 的回放版：真跑验证太贵，回放验证免费。
  3) 已否定清单（evolution.PolicyRegistry.deny）—— 被回放否决的策略变体
     留指纹，evolve_loop 提前跳过，不再消耗评估预算（RRSI 归因章节明确
     点名"被否定假设反复消耗候选"这个坑）。

外加考试任务单次验证 heldout_report_once：经验层的最终数字只允许在
held-out 任务上测一次（报告用，不参与任何选择/淘汰），marker 落盘后
第二次调用直接拒绝——防止"边看考试分边调经验"把考试题变成训练题。

纪律: 本模块所有函数只消费已记录数据（memory JSON / 轨迹），不发 LLM
调用、不起容器。真正的影响验证仍要 live run（GPU 就绪后）。
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .memory import Lesson, _error_patterns, _vote_key

# ---------------------------------------------------------------- 泄漏筛查

# 任务 ID 形状（TB 风格 "PROJ-H-03" / "gh-cli" 之外的大写-连字符-数字组合）
_TASK_ID_RE = re.compile(r"\b[A-Z]{2,}(?:-[A-Z0-9]+)+-\d+\b")
_ABS_PATH_RE = re.compile(r"(?<![\w])/(?:tmp|home|root|var|opt|srv)/\S+")
# 12 位以上十六进制/纯数字（commit sha、文件 inode、任务内常量）
_LONG_ID_RE = re.compile(r"\b[0-9a-f]{12,}\b|\b\d{12,}\b")
_HOST_PORT_RE = re.compile(r"\b[\w.-]+:\d{4,5}\b")


def _check_leak(content: str, own_task_id: str,
                known_task_ids: frozenset[str]) -> list[str]:
    reasons: list[str] = []
    for m in _TASK_ID_RE.findall(content):
        if m != own_task_id and m in known_task_ids:
            reasons.append(f"提及他人任务ID: {m}")
    if _ABS_PATH_RE.search(content):
        reasons.append("含绝对路径（环境特异）")
    if _LONG_ID_RE.search(content):
        reasons.append("含长十六进制/长数字串（任务内常量泄漏）")
    if _HOST_PORT_RE.search(content):
        reasons.append("含 host:port（环境特异）")
    return reasons


@dataclass(frozen=True)
class LeakageResult:
    lesson: Lesson
    ok: bool
    reasons: tuple[str, ...] = ()


def screen_leakage(lesson: Lesson,
                   known_task_ids: "frozenset[str] | set[str] | None" = None,
                   ) -> LeakageResult:
    """单条教训泄漏筛查。自己的 task_id 允许出现（任务内记忆是刻意的），
    其他已知任务 ID 出现即泄漏。known_task_ids 缺省时只查形状类规则。"""
    known = frozenset(known_task_ids or ())
    reasons = _check_leak(lesson.content, lesson.task_id, known)
    return LeakageResult(lesson, not reasons, tuple(reasons))


def screen_lessons(lessons: list[Lesson],
                   known_task_ids: "frozenset[str] | set[str] | None" = None,
                   ) -> tuple[list[Lesson], list[LeakageResult]]:
    """批量筛查：返回 (通过, 被拒明细)。"""
    passed, rejected = [], []
    for l in lessons:
        r = screen_leakage(l, known_task_ids)
        (passed if r.ok else rejected).append(l if r.ok else r)
    return passed, rejected


# ------------------------------------------------------------- 回放统计/验收

def _passed(t) -> bool:
    status = str(getattr(t, "status", "")).lower()
    if status in ("pass", "passed", "success"):
        return True
    if status in ("fail", "failed", "error"):
        return False
    reward = getattr(t, "reward", None)
    label = getattr(reward, "label", None)
    return bool(label is not None and label >= 1.0)


@dataclass(frozen=True)
class ReplayStats:
    vote_key: str
    n_with: int                  # 出现该模式的 attempt 数
    n_with_passed: int
    n_without: int
    n_without_passed: int
    min_attempts: int

    @property
    def pass_rate_with(self) -> float:
        return self.n_with_passed / self.n_with if self.n_with else 0.0

    @property
    def pass_rate_without(self) -> float:
        return self.n_without_passed / self.n_without if self.n_without else 0.0

    @property
    def delta(self) -> float:
        """δ = 出现组通过率 − 未出现组通过率；负值 = 模式与失败相关。"""
        return self.pass_rate_with - self.pass_rate_without

    @property
    def sufficient(self) -> bool:
        return self.n_with >= self.min_attempts

    def to_dict(self) -> dict:
        return {"vote_key": self.vote_key, "n_with": self.n_with,
                "pass_rate_with": round(self.pass_rate_with, 4),
                "n_without": self.n_without,
                "pass_rate_without": round(self.pass_rate_without, 4),
                "delta": round(self.delta, 4), "sufficient": self.sufficient}


def _patterns_of(t) -> set[str]:
    msgs = getattr(t, "messages", None) or []
    return {_vote_key(s) for s in _error_patterns(msgs).values()}


def replay_stats(vote_key: str, trajectories, *, task_ids=None,
                 min_attempts: int = 3) -> ReplayStats:
    """错误模式在历史轨迹上的零成本回放统计。

    trajectories: RSITrajectory 或鸭子类型（task_id/status/messages）。
    task_ids: 限定统计范围（应传训练任务集，考试任务禁入选择环节）。
    """
    n_with = n_with_p = n_wo = n_wo_p = 0
    for t in trajectories:
        if task_ids is not None and getattr(t, "task_id", None) not in task_ids:
            continue
        if vote_key in _patterns_of(t):
            n_with += 1
            n_with_p += _passed(t)
        else:
            n_wo += 1
            n_wo_p += _passed(t)
    return ReplayStats(vote_key, n_with, n_with_p, n_wo, n_wo_p, min_attempts)


_HYPOTHESIS_KINDS = {"contrastive_failure", "failure_pattern"}


@dataclass
class GateResult:
    admitted: list[Lesson] = field(default_factory=list)
    rejected: list[tuple[Lesson, str]] = field(default_factory=list)
    stats: dict[str, ReplayStats] = field(default_factory=dict)


def admission_gate(lessons: list[Lesson], trajectories, *,
                   task_ids=None, min_delta: float = 0.15,
                   min_attempts: int = 3, known_task_ids=None,
                   split: dict | None = None) -> GateResult:
    """入库验收门（RRSI 三道门合并作用于新教训）。

    1. 考试任务污染: lesson.task_id 在 heldout → 拒绝（红线）。
    2. 泄漏筛查: 任务专有标识 → 拒绝。
    3. 回放噪声门: 假设类教训（contrastive_failure/failure_pattern）
       要求 δ ≤ −min_delta（模式出现组通过率显著更低）且样本量足够；
       success_note 是任务内记忆不是假设，免回放门（只过前两道）。
    """
    out = GateResult()
    for l in lessons:
        if split is not None and l.task_id in split.get("heldout", []):
            out.rejected.append((l, "eval_task_contamination"))
            continue
        leak = screen_leakage(l, known_task_ids)
        if not leak.ok:
            out.rejected.append((l, "leakage:" + ";".join(leak.reasons)))
            continue
        if l.kind not in _HYPOTHESIS_KINDS:
            out.admitted.append(l)
            continue
        key = _vote_key(l.content)
        if key not in out.stats:
            out.stats[key] = replay_stats(
                key, trajectories, task_ids=task_ids, min_attempts=min_attempts)
        st = out.stats[key]
        if not st.sufficient:
            out.rejected.append((l, f"insufficient_samples(n_with={st.n_with})"))
        elif st.delta > -min_delta:
            out.rejected.append((l, f"not_discriminative(delta={st.delta:.3f})"))
        else:
            out.admitted.append(l)
    return out


@dataclass
class PruneReport:
    n_before: int
    n_after: int = 0
    removed: list[tuple[str, str, str]] = field(default_factory=list)  # (task, kind, reason)

    @property
    def n_removed(self) -> int:
        return self.n_before - self.n_after


def prune_with_replay(memory, trajectories, *, task_ids=None,
                      min_delta: float = 0.15, min_attempts: int = 3,
                      known_task_ids=None, split: dict | None = None,
                      max_active: int | None = None) -> PruneReport:
    """存量经验库治理：泄漏 + 回放显著性双门剪枝（RRSI 结构剪枝）。

    允许作用于冻结库——freeze 语义是"拒绝新学习"，剪枝是质量治理，
    不是学习（对齐 RRSI: permanent state 可被正则化收缩，不可被污染）。
    max_active: 复杂度上限，超出时按（票数, |δ|）排序保留 top-N，
    控制注入 prompt 的经验总量（RRSI 表 2: 无正则演化 token 开销 +57%）。
    """
    lessons = memory.all_lessons()
    report = PruneReport(n_before=len(lessons))
    gate = admission_gate(lessons, trajectories, task_ids=task_ids,
                          min_delta=min_delta, min_attempts=min_attempts,
                          known_task_ids=known_task_ids, split=split)
    kept = list(gate.admitted)
    removed = [(l.task_id, l.kind, why) for l, why in gate.rejected]

    if max_active is not None and len(kept) > max_active:
        # 复杂度上限: 按（跨任务票数, |δ|）排序保留 top-N
        def rank_key(l: Lesson):
            st = gate.stats.get(_vote_key(l.content))
            dv = abs(st.delta) if st else 0.0
            return (-_votes_of(memory, l), -dv)

        keep_sorted = sorted(kept, key=rank_key)[:max_active]
        dropped = [l for l in kept if l not in keep_sorted]
        removed.extend((l.task_id, l.kind, "complexity_cap") for l in dropped)
        kept = keep_sorted

    keep_keys = {(l.task_id, l.kind, l.content) for l in kept}
    memory._lessons = [r for r in memory._lessons
                       if (r["task_id"], r["kind"], r["content"]) in keep_keys]
    memory._save()
    report.n_after = len(memory._lessons)
    report.removed = removed
    return report


def _votes_of(memory, lesson: Lesson) -> int:
    """该教训错误模式的跨任务票数（memory.voted_lessons 同口径）。"""
    tasks = memory._votes.get(_vote_key(lesson.content), {"tasks": []})["tasks"]
    return tasks.index(lesson.task_id) + 1 if lesson.task_id in tasks else 0


# --------------------------------------------------------- 考试任务单次验证

def heldout_report_once(memory, trajectories, *, split: dict,
                        marker_path: Path | None = None,
                        force: bool = False) -> dict:
    """经验层在 held-out 任务上的单次回放级验证（只报告，不选择）。

    RRSI 方法论: evolve set 上选择，held-out 只验一次。marker 落盘后
    重复调用直接拒绝（force=True 仅供审计重放，会在 marker 里留痕）。
    边界: 这是回放级证据（模式在未见任务上是否仍与失败相关），不是
    live run 能力分——live 验证等 GPU。
    """
    mp = Path(marker_path) if marker_path else \
        Path(memory.path).with_suffix(".heldout.marker.json")
    lessons = memory.all_lessons()
    eval_tasks = set(split.get("heldout", []))
    # 污染红线: 库里不允许有考试任务来源的教训
    from_eval = [l.task_id for l in lessons if l.task_id in eval_tasks]
    if from_eval:
        raise RuntimeError(
            f"经验库含考试任务来源教训 {sorted(set(from_eval))}——先剪枝再验证")
    if mp.exists() and not force:
        prev = json.loads(mp.read_text())
        raise RuntimeError(
            f"held-out 验证已执行过（{prev['timestamp']}），重复验证会把"
            f"考试题变成训练题。需要审计重放请显式 force=True（会留痕）。")

    # 只验证经验库假设类教训的错误模式在考试任务上的表现（未见任务迁移证据）
    keys: list[str] = []
    for l in lessons:
        if l.kind in _HYPOTHESIS_KINDS:
            k = _vote_key(l.content)
            if k not in keys:
                keys.append(k)
    groups = [replay_stats(k, trajectories, task_ids=eval_tasks).to_dict()
              for k in keys]
    groups.sort(key=lambda g: g["delta"])
    n_eval = sum(1 for t in trajectories
                 if getattr(t, "task_id", None) in eval_tasks)
    report: dict = {"timestamp": datetime.now(timezone.utc).isoformat(),
                    "n_lessons": len(lessons),
                    "n_eval_trajectories": n_eval,
                    "note": "replay-level evidence only; live validation pending GPU",
                    "groups": groups}
    mp.parent.mkdir(parents=True, exist_ok=True)
    if force and mp.exists():
        report["forced_rerun_of"] = json.loads(mp.read_text())["timestamp"]
    mp.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return report
