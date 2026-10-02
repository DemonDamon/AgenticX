# agenticx/rl/decision.py
"""决策点标注层（SP25）：Jev 式判别头的训练数据地基。

Agent loop 中的高频决策点（工具选择/错误分类/继续终止/hint 门控/judge
预筛）选项有界、结果可验证——蒸馏成判别头（一次前向 + 受限 softmax）可
摊销延迟与成本。数据必须在 rollout 侧捕获：state 压缩表示事后无法忠实
重建，不标注即丢失。

设计原则（与 SP24 token-native 层同源）：
- 第四投影：决策点经 (rollout_id, turn) join 回 TokenRollout，独立
  sidecar（decisions.jsonl）落盘，不改动现有三投影
- 轨迹是事实，标注是判断：label 显式携带 source、多来源并存，消费侧按
  优先级取用（execution > self > teacher）
- 好坏由下游真值定义：outcome 延迟回填（decision → action → outcome），
  执行真值优先于老师观点
- 训推一致性红线：state 由版本化压缩函数生成，部署侧必须同构——
  压缩函数换版即换数据集，杜绝"短 state 训练、长 state 部署"的分布漂移
"""
from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable

QUESTION_TYPES = ("choice", "yes_no", "score")
DECISION_TYPES = (
    "tool_selection",       # 下一步调用哪个工具（choice）
    "error_classification", # tool error 可重试/瞬时/致命（choice）
    "continue_stop",        # 当前分支继续或终止（yes_no）
    "hint_gating",          # failure-memory hint 注入门控（yes_no）
    "judge_prescreen",      # 输出质量 0-5 预筛（score）
)
LABEL_SOURCES = ("execution", "teacher", "self")
_LABEL_PRIORITY = {"execution": 0, "self": 1, "teacher": 2}
SPLIT_NAMES = ("train", "calib", "test")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class DecisionQuestion:
    """一道带固定选项的决策题——三题型对齐 marker 监督方案（SP26 训练侧）。

    symbols 是受限 softmax 的候选符号表：choice 用选项文本、yes_no 固定
    (yes, no)、score 用分值数字串。
    """

    qid: str
    type: str                       # choice | yes_no | score
    question: str
    options: tuple[str, ...] = ()   # choice 必填；yes_no 自动固定；score 为空
    scale: tuple[int, int] = (0, 5) # score 分值区间（含端点）
    distractor_source: str = ""     # choice 干扰项生成器版本（负采样溯源）

    def __post_init__(self) -> None:
        # jsonl 往返容错：list → tuple 归一化（frozen dataclass 用 object.__setattr__）
        object.__setattr__(self, "options", tuple(self.options))
        object.__setattr__(self, "scale", tuple(self.scale))
        if self.type not in QUESTION_TYPES:
            raise ValueError(
                f"q '{self.qid}': 未知题型 {self.type}（可选 {QUESTION_TYPES}）")
        if self.type == "choice" and not self.options:
            raise ValueError(f"q '{self.qid}': choice 题必须提供 options")
        if self.type == "yes_no":
            object.__setattr__(self, "options", ("yes", "no"))
        if self.type == "score" and len(self.scale) != 2:
            raise ValueError(f"q '{self.qid}': score 题的 scale 必须是 (lo, hi)")

    @property
    def symbols(self) -> tuple[str, ...]:
        if self.type == "score":
            lo, hi = self.scale
            return tuple(str(i) for i in range(lo, hi + 1))
        return self.options


@dataclass(frozen=True)
class DecisionLabel:
    """一个来源对一道题的标注。多来源并存于 DecisionRecord.labels，
    消费侧经 label_for 按优先级取最优。"""

    qid: str
    source: str                    # execution | teacher | self
    hard: str | None = None        # 硬标签（候选符号之一）；None=仅有软标签
    probs: tuple[float, ...] = ()  # 软标签，长度与该题 symbols 对齐
    teacher_model: str = ""        # source=teacher 时必填（可复现红线）
    labeled_at: str = ""

    def __post_init__(self) -> None:
        if self.source not in LABEL_SOURCES:
            raise ValueError(f"未知标签来源 {self.source}（可选 {LABEL_SOURCES}）")
        if self.source == "teacher" and not self.teacher_model:
            raise ValueError("teacher 标签必须记录 teacher_model（可复现红线）")


@dataclass
class DecisionOutcome:
    """决策的下游真值——决策时未知，run 终局后由 backfill_outcome 回填。"""

    ok: bool | None = None   # 该决策导向的动作是否成功
    task_status: str = ""    # pass | fail | partial | unlabeled（run 终态）
    note: str = ""
    backfilled_at: str = ""


@dataclass
class DecisionRecord:
    """一个决策点：state + 若干题 + 多来源标注 + 延迟 outcome。

    join 键 (rollout_id, turn) 对齐 TokenRollout/TurnRecord；decision_id
    全局唯一。刻意不嵌入 TokenRollout——轨迹是事实（SP24），决策标注是
    判断，各自演进互不拖累。
    """

    decision_id: str
    rollout_id: str               # join TokenRollout.rollout_id
    turn: int                     # join TurnRecord.turn
    task_id: str
    decision_type: str            # DECISION_TYPES
    state: str                    # 压缩后上下文（与部署侧同构）
    state_compressor: str         # 压缩函数版本（训推一致性红线，必填）
    questions: tuple[DecisionQuestion, ...] = ()
    labels: list[DecisionLabel] = field(default_factory=list)
    outcome: DecisionOutcome | None = None
    split: str = ""               # train | calib | test（assign_split 赋值）
    created_at: str = ""

    def __post_init__(self) -> None:
        if self.decision_type not in DECISION_TYPES:
            raise ValueError(
                f"未知决策类型 {self.decision_type}（可选 {DECISION_TYPES}）")
        if not self.state_compressor:
            raise ValueError("state_compressor 必填（训推一致性红线）")

    def label_for(self, qid: str) -> DecisionLabel | None:
        """按优先级取最优标注：execution（执行真值）> self > teacher。"""
        cands = [l for l in self.labels if l.qid == qid]
        return min(cands, key=lambda l: _LABEL_PRIORITY[l.source]) if cands else None

    def add_label(self, label: DecisionLabel) -> None:
        if label.qid not in {q.qid for q in self.questions}:
            raise ValueError(f"标签 qid '{label.qid}' 不属于该决策点的问题集")
        self.labels.append(label)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "DecisionRecord":
        d = dict(d)
        d["questions"] = tuple(DecisionQuestion(**q) for q in d.get("questions", ()))
        d["labels"] = [DecisionLabel(**l) for l in d.get("labels", [])]
        if d.get("outcome"):
            d["outcome"] = DecisionOutcome(**d["outcome"])
        return cls(**d)


@dataclass
class DecisionLog:
    """决策点累积器 + sidecar（decisions.jsonl）落盘/加载。

    与 TokenRollout 平行使用、经 rollout_id 关联。raw 只追加不改写；
    补标结果写新文件（backfill_decisions.py 落 *.labeled.jsonl）。
    """

    records: list[DecisionRecord] = field(default_factory=list)

    def add(self, *, rollout_id: str, turn: int, task_id: str, decision_type: str,
            state: str, state_compressor: str,
            questions: Iterable[DecisionQuestion]) -> DecisionRecord:
        rec = DecisionRecord(
            decision_id=f"d-{uuid.uuid4().hex[:12]}",
            rollout_id=rollout_id, turn=turn, task_id=task_id,
            decision_type=decision_type, state=state,
            state_compressor=state_compressor,
            questions=tuple(questions), created_at=_now(),
        )
        self.records.append(rec)
        return rec

    def backfill_outcome(self, rollout_id: str, *, ok: bool | None = None,
                         task_status: str = "", note: str = "") -> int:
        """run 终局回填：该 rollout 的全部决策点补 outcome，返回条数。"""
        n = 0
        for rec in self.records:
            if rec.rollout_id == rollout_id:
                rec.outcome = DecisionOutcome(ok=ok, task_status=task_status,
                                              note=note, backfilled_at=_now())
                n += 1
        return n

    def to_jsonl(self) -> str:
        return "\n".join(json.dumps(r.to_dict(), ensure_ascii=False)
                         for r in self.records)

    def save(self, path: str | Path) -> int:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(self.to_jsonl() + ("\n" if self.records else ""),
                     encoding="utf-8")
        return len(self.records)

    @classmethod
    def load(cls, path: str | Path) -> "DecisionLog":
        text = Path(path).read_text(encoding="utf-8")
        lines = [ln for ln in text.splitlines() if ln.strip()]
        return cls(records=[DecisionRecord.from_dict(json.loads(ln))
                            for ln in lines])


def assign_split(records: list[DecisionRecord], *, seed: str = "dec-v1",
                 calib_ratio: float = 0.1, test_ratio: float = 0.1) -> None:
    """确定性三分 train/calib/test：sha256(rollout_id|seed) 首字节分桶。

    rollout 粒度隔离——同一轨迹的决策点不跨划分，防 calib/test 出现
    train state 的近重复（校准泄漏）。同 heldout_split 哲学：确定性、
    可复现、无顺序依赖。test 划分冻结后才可读，温度只在 calib 拟合。
    """
    bucket: dict[str, str] = {}
    for rec in records:
        if rec.rollout_id not in bucket:
            h = int(hashlib.sha256(f"{rec.rollout_id}|{seed}".encode())
                    .hexdigest()[:2], 16)
            bucket[rec.rollout_id] = (
                "test" if h < test_ratio * 256
                else "calib" if h < (test_ratio + calib_ratio) * 256
                else "train")
        rec.split = bucket[rec.rollout_id]


def assert_trainable_decision(rec: DecisionRecord,
                              split: dict | None = None) -> None:
    """held-out 红线扩展（SP25）：考试任务的决策点严禁进决策头训练。"""
    from agenticx.learning.trajectory.task_split import is_eval_task, load_split
    from agenticx.trainer.heldout import HeldoutViolation
    sp = split if split is not None else load_split()
    if is_eval_task(rec.task_id, sp):
        raise HeldoutViolation(
            f"decision {rec.decision_id} 的 task '{rec.task_id}' 在 held-out "
            f"考试集（seed={sp.get('seed')}），禁止进入决策头训练数据")


def assert_trainable_decisions(records: list[DecisionRecord],
                               split: dict | None = None) -> None:
    for rec in records:
        assert_trainable_decision(rec, split)


def load_trainable_decisions(path: str | Path,
                             split: dict | None = None) -> list[DecisionRecord]:
    """训练侧唯一入口：加载 + 逐条守卫，held-out 污染即抛。"""
    recs = DecisionLog.load(path).records
    assert_trainable_decisions(recs, split)
    return recs


# scorer(record) -> {qid: 与该题 symbols 等长的 probs}
Scorer = Callable[[DecisionRecord], dict[str, tuple[float, ...]]]


def backfill_teacher(records: list[DecisionRecord], scorer: Scorer, *,
                     teacher_model: str) -> int:
    """离线补标：为每条记录追加 teacher 软标签，返回补标题数。

    只追加不覆盖——既有 execution/self 标注保留（真值优先，消费侧
    label_for 决定优先级）。probs 长度必须与题的 symbols 一致。
    """
    n = 0
    for rec in records:
        # 幂等：同 teacher_model 已补过的 qid 跳过（重跑安全）
        done = {l.qid for l in rec.labels
                if l.source == "teacher" and l.teacher_model == teacher_model}
        scored = scorer(rec) or {}
        for qid, probs in scored.items():
            if qid in done:
                continue
            q = next((q for q in rec.questions if q.qid == qid), None)
            if q is None:
                raise ValueError(
                    f"scorer 返回了未知 qid '{qid}'（decision {rec.decision_id}）")
            probs = tuple(float(p) for p in probs)
            if len(probs) != len(q.symbols):
                raise ValueError(
                    f"probs 长度 {len(probs)} 与候选符号 {len(q.symbols)} "
                    f"不一致（qid {qid}）")
            rec.add_label(DecisionLabel(qid=qid, source="teacher", probs=probs,
                                        teacher_model=teacher_model,
                                        labeled_at=_now()))
            n += 1
    return n
