#!/usr/bin/env python3
"""AST/lightweight outline extraction for code_outline tool.

Author: Damon Li
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any, Iterator

_CODE_EXTS = {
    ".py": "python",
    ".pyi": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".go": "go",
}

_MAX_DOC = 120
_MAX_FILES_DEFAULT = 50
_MAX_DEPTH = 4


def _trim_doc(text: str | None) -> str:
    if not text:
        return ""
    first = text.strip().split("\n\n", 1)[0].replace("\n", " ").strip()
    if len(first) > _MAX_DOC:
        return first[: _MAX_DOC - 3] + "..."
    return first


def _py_symbols(path: Path, content: str) -> list[dict[str, Any]]:
    symbols: list[dict[str, Any]] = []
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return symbols
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ClassDef):
            symbols.append({
                "kind": "class",
                "name": node.name,
                "lineno": node.lineno,
                "docstring": _trim_doc(ast.get_docstring(node)),
            })
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = [a.arg for a in node.args.args[:6]]
            sig = f"def {node.name}({', '.join(args)})"
            symbols.append({
                "kind": "function",
                "name": node.name,
                "lineno": node.lineno,
                "signature": sig,
                "docstring": _trim_doc(ast.get_docstring(node)),
            })
    return symbols


_RE_TS_CLASS = re.compile(
    r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)",
    re.MULTILINE,
)
_RE_TS_FN = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(",
    re.MULTILINE,
)
_RE_TS_METHOD = re.compile(
    r"^\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{",
    re.MULTILINE,
)
_RE_GO_TYPE = re.compile(r"^type\s+(\w+)\s+struct", re.MULTILINE)
_RE_GO_FN = re.compile(r"^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(", re.MULTILINE)


def _regex_symbols(language: str, content: str) -> list[dict[str, Any]]:
    symbols: list[dict[str, Any]] = []
    lines = content.splitlines()
    if language in ("typescript", "javascript"):
        for m in _RE_TS_CLASS.finditer(content):
            lineno = content[: m.start()].count("\n") + 1
            symbols.append({"kind": "class", "name": m.group(1), "lineno": lineno, "docstring": ""})
        for m in _RE_TS_FN.finditer(content):
            lineno = content[: m.start()].count("\n") + 1
            symbols.append({
                "kind": "function",
                "name": m.group(1),
                "lineno": lineno,
                "signature": f"function {m.group(1)}(...)",
                "docstring": "",
            })
    elif language == "go":
        for m in _RE_GO_TYPE.finditer(content):
            lineno = content[: m.start()].count("\n") + 1
            symbols.append({"kind": "class", "name": m.group(1), "lineno": lineno, "docstring": ""})
        for m in _RE_GO_FN.finditer(content):
            lineno = content[: m.start()].count("\n") + 1
            symbols.append({
                "kind": "function",
                "name": m.group(1),
                "lineno": lineno,
                "signature": f"func {m.group(1)}(...)",
                "docstring": "",
            })
    if not symbols and lines:
        symbols.append({
            "kind": "file",
            "name": "(head)",
            "lineno": 1,
            "docstring": " ".join(lines[:3])[:_MAX_DOC],
        })
    return symbols


def outline_file(path: Path) -> dict[str, Any]:
    ext = path.suffix.lower()
    language = _CODE_EXTS.get(ext, "unknown")
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return {"path": str(path), "language": language, "symbols": [], "error": str(exc)}
    if language == "python":
        symbols = _py_symbols(path, content)
    elif language in ("typescript", "javascript", "go"):
        symbols = _regex_symbols(language, content)
    else:
        head = content.splitlines()[:50]
        symbols = [{
            "kind": "file",
            "name": path.name,
            "lineno": 1,
            "docstring": " ".join(head[:5])[:_MAX_DOC],
        }]
    return {"path": str(path), "language": language, "symbols": symbols}


def _iter_code_files(root: Path, *, max_depth: int) -> Iterator[Path]:
    skip_dirs = {
        "node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv",
        ".cursor", "coverage", ".turbo", "target",
    }

    def walk(dir_path: Path, depth: int) -> Iterator[Path]:
        if depth > max_depth:
            return
        try:
            entries = sorted(dir_path.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            return
        for entry in entries:
            if entry.is_dir():
                if entry.name in skip_dirs or entry.name.startswith("."):
                    continue
                yield from walk(entry, depth + 1)
            elif entry.is_file() and entry.suffix.lower() in _CODE_EXTS:
                yield entry

    yield from walk(root, 0)


def build_outline(
    root: Path,
    *,
    query: str | None = None,
    max_files: int = _MAX_FILES_DEFAULT,
) -> dict[str, Any]:
    if root.is_file():
        files = [root]
    elif root.is_dir():
        files = list(_iter_code_files(root, max_depth=_MAX_DEPTH))
    else:
        return {"files": [], "truncated": False, "error": f"path not found: {root}"}

    q = (query or "").strip().lower()
    out_files: list[dict[str, Any]] = []
    truncated = False
    for fp in files:
        if q:
            rel = str(fp)
            outline = outline_file(fp)
            sym_names = " ".join(s.get("name", "") for s in outline.get("symbols", []))
            if q not in rel.lower() and q not in fp.name.lower() and q not in sym_names.lower():
                continue
        if len(out_files) >= max_files:
            truncated = True
            break
        out_files.append(outline_file(fp))

    result: dict[str, Any] = {"files": out_files, "truncated": truncated}
    if truncated:
        result["next_hint"] = "缩小 path 或添加 query 过滤；可提高 max_files（上限 50）。"
    return result


def format_outline_result(payload: dict[str, Any]) -> str:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if len(text) > 24_000:
        text = text[:24_000] + "\n... (truncated JSON output)"
    return text
