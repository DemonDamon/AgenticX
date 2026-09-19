# tests/trajectory/test_memory.py
import pytest

from agenticx.learning.trajectory.memory import (
    ExperienceMemory, Lesson, extract_lessons, format_hints,
)

MSGS_WITH_ERRORS = [
    {"role": "user", "content": "do the thing"},
    {"role": "assistant", "content": "", "tool_calls": [{"id": "1"}]},
    {"role": "tool", "content": "error: FileNotFoundError: config.yaml not found"},
    {"role": "assistant", "content": "retry"},
    {"role": "tool", "content": "error: FileNotFoundError: config.yaml not found"},
    {"role": "tool", "content": "ok, wrote output.txt"},
]


def test_extract_failure_patterns_from_failed_attempt():
    lessons = extract_lessons("task-a", passed=False, messages=MSGS_WITH_ERRORS)
    assert lessons and all(l.kind == "failure_pattern" for l in lessons)
    top = lessons[0]
    assert top.task_id == "task-a" and "FileNotFoundError" in top.content
    assert "×2" in top.content                      # 同片段聚类计数


def test_extract_success_note_on_passed_attempt():
    lessons = extract_lessons("task-a", passed=True, messages=MSGS_WITH_ERRORS)
    kinds = [l.kind for l in lessons]
    assert kinds[0] == "success_note"
    assert "failure_pattern" in kinds               # 通过也记录踩过的坑


def test_extract_cleans_messages_no_lessons():
    clean = [{"role": "user", "content": "hi"},
             {"role": "assistant", "content": "done"}]
    assert extract_lessons("t", passed=True, messages=clean)[0].kind == "success_note"
    assert extract_lessons("t", passed=False, messages=clean) == []


def test_extract_caps_lesson_count():
    many = []
    for i in range(10):
        many.append({"role": "tool", "content": f"error: distinct failure {i}"})
    assert len(extract_lessons("t", passed=False, messages=many)) == 3


def test_memory_add_retrieve_ranking(tmp_path):
    m = ExperienceMemory(tmp_path / "exp.json")
    m.add([Lesson("task-a", "failure_pattern", "error: FileNotFoundError in cfg")], 1)
    m.add([Lesson("task-b", "failure_pattern", "error: FileNotFoundError in cfg")], 1)
    m.add([Lesson("task-a", "failure_pattern", "port already in use")], 1)
    got = m.retrieve("task-a", query="cfg missing", k=2)
    assert got[0].content.startswith("error: FileNotFoundError")   # task 匹配+关键词 > 跨 task
    assert all(l.task_id == "task-a" for l in got)                 # task-a 的两条都排前
    assert m.retrieve("task-zzz") == []                            # 无匹配不硬凑


def test_memory_freeze_blocks_add(tmp_path):
    m = ExperienceMemory(tmp_path / "exp.json")
    m.add([Lesson("t", "success_note", "ok")], 1)
    m.freeze()
    assert m.is_frozen
    with pytest.raises(RuntimeError):
        m.add([Lesson("t", "failure_pattern", "x")], 2)


def test_memory_persistence_roundtrip(tmp_path):
    p = tmp_path / "exp.json"
    m1 = ExperienceMemory(p)
    m1.add([Lesson("t", "failure_pattern", "boom")], 1)
    m1.freeze()
    m2 = ExperienceMemory(p)
    assert m2.is_frozen
    assert m2.retrieve("t", k=1)[0].content == "boom"


def test_format_hints_renders_block():
    assert format_hints([]) == ""
    txt = format_hints([Lesson("task-a", "failure_pattern", "boom: xyz")])
    assert "历史经验" in txt and "boom: xyz" in txt and "task-a" in txt


def test_memory_all_lessons_for_driver(tmp_path):
    m = ExperienceMemory(tmp_path / "exp.json")
    m.add([Lesson("a", "failure_pattern", "x"), Lesson("b", "success_note", "y")], 1)
    assert len(m.all_lessons()) == 2


# --- SP17: 跨任务投票 ---
from agenticx.learning.trajectory.memory import Lesson, _vote_key  # noqa: E402


def test_vote_key_normalizes_error_type():
    assert _vote_key("error: FileNotFoundError: /a.yaml") == \
           _vote_key("工具曾报错 ×2: error: FileNotFoundError: /b.yaml")
    assert _vote_key("error: FileNotFoundError: /a.yaml") != \
           _vote_key("error: TimeoutError: x")


def test_votes_accumulate_across_tasks_not_within(tmp_path):
    m = ExperienceMemory(tmp_path / "exp.json")
    m.add([Lesson("task-a", "failure_pattern",
                  "error: FileNotFoundError: /a")], 1)
    m.add([Lesson("task-a", "failure_pattern",
                  "error: FileNotFoundError: /a2")], 1)   # 同任务 → 不涨票
    m.add([Lesson("task-b", "contrastive_failure",
                  "error: FileNotFoundError: /b")], 1)    # 跨任务 → 2 票
    voted = m.voted_lessons()
    assert len(voted) == 3
    assert m.voted_lessons(min_votes=2) == [Lesson(
        "task-b", "contrastive_failure", "error: FileNotFoundError: /b")]
    assert m.voted_lessons(min_votes=3) == []


def test_votes_persist_and_backcompat(tmp_path):
    p = tmp_path / "exp.json"
    m = ExperienceMemory(p)
    m.add([Lesson("a", "failure_pattern", "error: TimeoutError: t"),
           Lesson("b", "failure_pattern", "error: TimeoutError: t2")], 1)
    m.freeze()
    m2 = ExperienceMemory(p)
    assert len(m2.voted_lessons(min_votes=2)) == 1          # 票数持久化
    # SP16 旧格式文件（无 votes 键）可读
    import json as _json
    old = tmp_path / "old.json"
    old.write_text(_json.dumps(
        {"lessons": [{"task_id": "a", "kind": "failure_pattern",
                      "content": "x", "source": "rule", "round": 1}],
         "frozen": True}))
    assert len(ExperienceMemory(old).all_lessons()) == 1
