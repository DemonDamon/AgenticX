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

    def _save(self) -> None:
        self.path.write_text(json.dumps(
            {"lessons": self._lessons, "frozen": self._frozen},
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


def format_hints(lessons: list[Lesson]) -> str:
    """渲染为注入系统提示词的文本块; 空输入返回空串（= 不注入）。"""
    if not lessons:
        return ""
    lines = ["## 历史经验（来自此前轮次的冻结记忆, 供参考）"]
    for l in lessons:
        lines.append(f"- [{l.kind}] {l.task_id}: {l.content}")
    return "\n".join(lines)
