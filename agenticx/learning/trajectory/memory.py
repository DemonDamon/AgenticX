# agenticx/learning/trajectory/memory.py
"""文本经验库（SP16 · RSIAgent Experience Memory 等价物）。

P0.5 的策略只能编码 {continue, abort} 标量阈值; 本模块把经验表征升级为
文本 Lesson（失败模式聚类 + 通过笔记）, 生命周期对齐 RSIAgent:
add → freeze → 测试时 retrieve 注入（不可变 frozen memory）。
LLM 提取走 Lesson.source="llm" 预留接口, SP16 只做规则式提取。
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Lesson:
    task_id: str
    kind: str                 # failure_pattern | success_note
    content: str
    source: str = "rule"


def _is_error(content: str) -> bool:
    return "error" in content.lower()[:200]      # 与 forest._is_error_result 同口径


def _vote_key(content: str) -> str:
    """跨任务投票键: 归一化到异常类型级（error: 后第一个冒号段）。"""
    low = content.lower()
    idx = low.find("error")
    if idx < 0:
        return low[:60]
    seg = content[idx:idx + 120].split(":")
    return ":".join(s.strip().lower() for s in seg[:2])[:60]


def _error_patterns(messages: list) -> dict[str, str]:
    """一条轨迹的 {消息级键: 代表性原始片段}（同键保首个, 120 字符截断）。"""
    out: dict[str, str] = {}
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "tool":
            content = str(m.get("content") or "").strip()
            if _is_error(content):
                out.setdefault(content[:120], content[:120])
    return out


def extract_contrastive_lessons(task_id: str, pass_messages_list: list,
                                fail_messages_list: list, *,
                                max_lessons: int = 3) -> list[Lesson]:
    """对比式提取（SP17 · ModularRSI 对比蒸馏同构）。

    失败组报错（类型级归一化）− 成功组报错（类型级归一化）
    = 系统缺陷信号（kind=contrastive_failure）;
    两组共通类型 = 任务本身难度, 不是缺陷, 排除（消息级差异不分裂排除）。
    分组与覆盖率按消息级片段（与 extract_lessons 同口径）。
    排序: 失败组轨迹覆盖率（出现该片段的失败轨迹数）降序。
    两组任一为空 → 无法对比 → 返回 []（调用方回退 extract_lessons）。
    """
    if not pass_messages_list or not fail_messages_list:
        return []
    pass_type_keys: set[str] = set()
    for msgs in pass_messages_list:
        for snippet in _error_patterns(msgs).values():
            pass_type_keys.add(_vote_key(snippet))
    coverage: dict[str, int] = {}
    rep: dict[str, str] = {}
    for msgs in fail_messages_list:
        for key, snippet in _error_patterns(msgs).items():
            if _vote_key(snippet) in pass_type_keys:
                continue          # 类型级共通 → 任务难度, 不是缺陷
            coverage[key] = coverage.get(key, 0) + 1
            rep.setdefault(key, snippet)
    lessons = []
    for key, n in sorted(coverage.items(), key=lambda kv: -kv[1]):
        lessons.append(Lesson(task_id, "contrastive_failure",
                              f"失败组独有报错 ×{n}: {rep[key]}"))
        if len(lessons) >= max_lessons:
            break
    return lessons


def extract_lessons(task_id: str, passed: bool, messages: list,
                    *, max_lessons: int = 3) -> list[Lesson]:
    """规则式经验提取: tool 报错片段聚类（截 120 字符为 key）计数排序。"""
    counts: dict[str, int] = {}
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "tool":
            content = str(m.get("content") or "").strip()
            if _is_error(content):
                counts[content[:120]] = counts.get(content[:120], 0) + 1
    lessons: list[Lesson] = []
    if passed:
        note = "此任务曾成功通过"
        if counts:
            note += f"；过程中报错 {sum(counts.values())} 次仍通过"
        lessons.append(Lesson(task_id, "success_note", note))
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    for snippet, n in ranked[: max_lessons - len(lessons)]:
        lessons.append(Lesson(task_id, "failure_pattern",
                              f"工具曾报错 ×{n}: {snippet}"))
    return lessons


class ExperienceMemory:
    """经验库: JSON 持久化（同 PolicyRegistry 模式）, freeze 后拒绝 add。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            data = {}
        self._lessons: list[dict] = data.get("lessons", [])
        self._frozen: bool = data.get("frozen", False)
        self._votes: dict[str, dict] = data.get("votes", {})

    def _save(self) -> None:
        self.path.write_text(json.dumps(
            {"lessons": self._lessons, "votes": self._votes,
             "frozen": self._frozen},
            ensure_ascii=False, indent=2))

    @property
    def is_frozen(self) -> bool:
        return self._frozen

    def freeze(self) -> None:
        self._frozen = True
        self._save()

    def add(self, lessons: list[Lesson], round_no: int) -> int:
        if self._frozen:
            raise RuntimeError("memory 已冻结, 拒绝追加（frozen memory 语义）")
        for l in lessons:
            d = asdict(l)
            d["round"] = round_no
            self._lessons.append(d)
            v = self._votes.setdefault(_vote_key(l.content), {"tasks": []})
            if l.task_id not in v["tasks"]:
                v["tasks"].append(l.task_id)
        self._save()
        return len(lessons)

    def retrieve(self, task_id: str, query: str = "", k: int = 3) -> list[Lesson]:
        """排序: task 精确匹配 100 分 + query 词与 content 重叠; 0 分不返回。"""
        words = [w for w in query.split() if w]

        def score(rec: dict) -> int:
            s = 100 if rec["task_id"] == task_id else 0
            s += sum(w in rec["content"] for w in words)
            return s

        ranked = sorted((r for r in self._lessons if score(r) > 0),
                        key=score, reverse=True)
        return [Lesson(r["task_id"], r["kind"], r["content"], r["source"])
                for r in ranked[:k]]

    def all_lessons(self, k: int | None = None) -> list[Lesson]:
        recs = self._lessons if k is None else self._lessons[:k]
        return [Lesson(r["task_id"], r["kind"], r["content"], r["source"])
                for r in recs]

    def voted_lessons(self, *, min_votes: int = 1,
                      k: int | None = None) -> list[Lesson]:
        """按跨任务票数过滤（SP17）: 票数 = 该 lesson 记录时其错误模式
        已复现的任务数（任务首现记 1 票, 第 N 个新任务复现时记 N 票;
        同任务重复 add 不涨票）。votes 侧结构为唯一真值源。"""
        def votes_of(rec: dict) -> int:
            tasks = self._votes.get(_vote_key(rec["content"]),
                                    {"tasks": []})["tasks"]
            return tasks.index(rec["task_id"]) + 1 \
                if rec["task_id"] in tasks else 0
        recs = [r for r in self._lessons if votes_of(r) >= min_votes]
        recs.sort(key=votes_of, reverse=True)
        if k is not None:
            recs = recs[:k]
        return [Lesson(r["task_id"], r["kind"], r["content"], r["source"])
                for r in recs]


def format_hints(lessons: list[Lesson]) -> str:
    """渲染为注入系统提示词的文本块; 空输入返回空串（= 不注入）。"""
    if not lessons:
        return ""
    lines = ["## 历史经验（来自此前轮次的冻结记忆, 供参考）"]
    for l in lessons:
        lines.append(f"- [{l.kind}] {l.task_id}: {l.content}")
    return "\n".join(lines)


def contrastive_lessons_from_trajectories(trajectories, *,
                                          min_pass: int = 1, min_fail: int = 1,
                                          max_lessons_per_task: int = 3
                                          ) -> list[Lesson]:
    """轨迹级对比挖掘: 按 task 分组, pass/fail 双组齐备(达门槛)才做对比提取。

    partial 状态不进对比组（verifier 分数非 0/1, 语义模糊）。
    """
    passes: dict[str, list] = {}
    fails: dict[str, list] = {}
    for t in trajectories:
        msgs = getattr(t, "messages", None) or []
        if getattr(t, "status", "") == "pass":
            passes.setdefault(t.task_id, []).append(msgs)
        elif getattr(t, "status", "") == "fail":
            fails.setdefault(t.task_id, []).append(msgs)
    lessons: list[Lesson] = []
    for task_id in sorted(set(passes) & set(fails)):
        if len(passes[task_id]) >= min_pass and len(fails[task_id]) >= min_fail:
            lessons.extend(extract_contrastive_lessons(
                task_id, passes[task_id], fails[task_id],
                max_lessons=max_lessons_per_task))
    return lessons
