"""
WindowedFileTool

参考 SWE-agent 的 windowed 视图工具，提供“窗口化阅读”能力：
- 只返回文件中的一小段窗口内容
- 支持 open/goto/scroll_up/scroll_down 操作
- 自动维护当前文件与窗口起始行，便于多次调用

版权声明：该实现参考了 SWE-agent 的 windowed 工具配置与行为（MIT License）。
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator

from .base import BaseTool, ToolError, ToolValidationError


class WindowAction(str, Enum):
    OPEN = "open"
    GOTO = "goto"
    SCROLL_UP = "scroll_up"
    SCROLL_DOWN = "scroll_down"


class WindowArgs(BaseModel):
    action: WindowAction = Field(description="windowed 文件工具动作")
    file_path: Optional[str] = Field(default=None, description="要打开的文件路径（open 时必填）")
    line: Optional[int] = Field(default=None, ge=1, description="目标起始行（open/goto 时可选）")
    delta: Optional[int] = Field(default=None, ge=1, description="滚动行数（scroll 时可选，默认为窗口大小）")
    window_size: Optional[int] = Field(default=None, ge=1, description="窗口行数（open 时可覆盖默认值）")

    @model_validator(mode="after")
    def validate_required_fields(self) -> "WindowArgs":
        if self.action == WindowAction.OPEN and not self.file_path:
            raise ValueError("file_path is required for open action")
        if self.action == WindowAction.GOTO and self.line is None:
            raise ValueError("line is required for goto action")
        return self


class WindowedFileTool(BaseTool):
    """
    窗口化文件阅读工具

    - 默认窗口大小 100 行，可通过参数覆盖
    - 支持 open/goto/scroll_up/scroll_down
    - 每次调用都会返回当前窗口的文本与元数据
    """

    def __init__(
        self,
        *,
        window_size: int = 100,
        allowed_paths: Optional[List[str]] = None,
        **kwargs,
    ):
        super().__init__(
            name="windowed_file_tool",
            description="以窗口化方式查看文件内容，支持 open/goto/scroll",
            **kwargs,
        )
        if window_size <= 0:
            raise ValueError("window_size must be positive")
        self.window_size = window_size
        self.allowed_paths = [str(Path(p).resolve()) for p in allowed_paths] if allowed_paths else []
        self._current_file: Optional[Path] = None
        self._current_line: int = 1

    def _run(self, **kwargs):
        args = WindowArgs(**kwargs)
        if args.action == WindowAction.OPEN:
            return self._handle_open(args)
        if args.action == WindowAction.GOTO:
            return self._handle_goto(args)
        if args.action == WindowAction.SCROLL_UP:
            return self._handle_scroll(args, direction=-1)
        if args.action == WindowAction.SCROLL_DOWN:
            return self._handle_scroll(args, direction=1)
        raise ToolError(f"Unsupported action: {args.action}", tool_name=self.name)

    # internal helpers
    def _handle_open(self, args: WindowArgs):
        path = self._resolve_and_check(args.file_path)
        window_size = args.window_size or self.window_size
        self.window_size = window_size
        self._current_file = path
        self._current_line = args.line or 1
        return self._render_window(start_line=self._current_line, window_size=window_size)

    def _handle_goto(self, args: WindowArgs):
        if self._current_file is None:
            raise ToolError("No file opened. Call open first.", tool_name=self.name)
        target_line = args.line or 1
        self._current_line = max(1, target_line)
        return self._render_window(start_line=self._current_line, window_size=self.window_size)

    def _handle_scroll(self, args: WindowArgs, direction: int):
        if self._current_file is None:
            raise ToolError("No file opened. Call open first.", tool_name=self.name)
        delta = args.delta or self.window_size
        new_start = self._current_line + direction * delta
        return self._render_window(start_line=new_start, window_size=self.window_size)

    def _resolve_and_check(self, file_path: str) -> Path:
        path = Path(file_path).expanduser().resolve()
        if self.allowed_paths:
            is_allowed = any(str(path).startswith(p) for p in self.allowed_paths)
            if not is_allowed:
                raise ToolValidationError(
                    f"Access to path {path} is not allowed",
                    tool_name=self.name,
                    details={"path": str(path)},
                )
        if not path.exists():
            raise ToolValidationError(
                f"File {path} does not exist",
                tool_name=self.name,
                details={"path": str(path)},
            )
        if not path.is_file():
            raise ToolValidationError(
                f"Path {path} is not a file",
                tool_name=self.name,
                details={"path": str(path)},
            )
        return path

    def _read_lines(self, path: Path) -> List[str]:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:  # pragma: no cover - unlikely but guarded
            raise ToolError(
                f"Failed to read file {path}: {exc}",
                tool_name=self.name,
                details={"path": str(path)},
            )
        return text.splitlines()

    def _render_window(self, start_line: int, window_size: int):
        assert window_size > 0
        if self._current_file is None:
            raise ToolError("No file opened. Call open first.", tool_name=self.name)

        lines = self._read_lines(self._current_file)
        total_lines = len(lines)

        if total_lines == 0:
            self._current_line = 1
            return {
                "path": str(self._current_file),
                "start_line": 1,
                "end_line": 0,
                "total_lines": 0,
                "window_size": window_size,
                "content": "",
            }

        max_start = max(1, total_lines - window_size + 1)
        start = min(max(1, start_line), max_start)
        end = min(total_lines, start + window_size - 1)
        self._current_line = start

        window_content = "\n".join(lines[start - 1 : end])
        return {
            "path": str(self._current_file),
            "start_line": start,
            "end_line": end,
            "total_lines": total_lines,
            "window_size": window_size,
            "content": window_content,
        }

