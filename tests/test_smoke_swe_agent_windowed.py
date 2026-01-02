import pytest

from agenticx.tools import ToolError, WindowedFileTool


def _make_file(tmp_path, name: str, num_lines: int) -> str:
    path = tmp_path / name
    content = "\n".join(f"line-{i}" for i in range(1, num_lines + 1))
    path.write_text(content, encoding="utf-8")
    return str(path)


def test_open_and_window_view(tmp_path):
    file_path = _make_file(tmp_path, "sample.txt", num_lines=12)
    tool = WindowedFileTool(window_size=5, allowed_paths=[str(tmp_path)])

    result = tool.run(action="open", file_path=file_path, line=1)

    assert result["start_line"] == 1
    assert result["end_line"] == 5
    assert result["window_size"] == 5
    assert "line-1" in result["content"]
    assert "line-5" in result["content"]
    assert "line-6" not in result["content"]


def test_goto_and_scroll(tmp_path):
    file_path = _make_file(tmp_path, "scroll.txt", num_lines=30)
    tool = WindowedFileTool(window_size=5, allowed_paths=[str(tmp_path)])

    tool.run(action="open", file_path=file_path, line=3)
    goto_result = tool.run(action="goto", line=10)
    assert goto_result["start_line"] == 10
    assert goto_result["end_line"] == 14

    down_result = tool.run(action="scroll_down", delta=3)
    assert down_result["start_line"] == 13
    assert down_result["end_line"] == 17

    up_result = tool.run(action="scroll_up", delta=50)
    assert up_result["start_line"] == 1
    assert up_result["end_line"] == 5


def test_goto_requires_open(tmp_path):
    tool = WindowedFileTool(window_size=5, allowed_paths=[str(tmp_path)])
    with pytest.raises(ToolError):
        tool.run(action="goto", line=1)

