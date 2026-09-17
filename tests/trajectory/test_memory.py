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
