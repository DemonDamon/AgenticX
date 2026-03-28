# LiteParse 接入 Machi 对话工具链

## 现状

- `LiteParseAdapter` 已实现，`UnifiedDocumentTool._process_document` 已调用它。
- 但 `STUDIO_TOOLS`（[agenticx/cli/agent_tools.py](agenticx/cli/agent_tools.py)）里**没有** `liteparse` 这个 function。
- `dispatch_tool_async` 里也**没有** `"liteparse"` 分支。
- `_filter_tools_by_policy` 按 function name 匹配 `tools_enabled` key，因此 UI 里的「LiteParse 默认/关闭」对任何工具都没实际效果。

## 要改的文件

只需修改一个文件：[agenticx/cli/agent_tools.py](agenticx/cli/agent_tools.py)

### 改动 1：在 `STUDIO_TOOLS` 列表里追加 `liteparse` 工具定义

在 `STUDIO_TOOLS` 末尾（`list_files` 之后，闭合 `]` 之前）插入：

```python
{
    "type": "function",
    "function": {
        "name": "liteparse",
        "description": (
            "Parse a document file (PDF, DOCX, PPTX, XLSX, images) and return "
            "extracted text. Uses LiteParse if installed, falls back to MinerU "
            "or plain text reader automatically."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute or workspace-relative path to the document."},
            },
            "required": ["path"],
            "additionalProperties": False,
        },
    },
},
```

### 改动 2：在 `dispatch_tool_async` 里追加分支

在 `if name == "list_files":` 那一行之后添加：

```python
if name == "liteparse":
    return await _tool_liteparse(arguments, session)
```

### 改动 3：新增 `_tool_liteparse` 处理函数

紧邻 `_tool_list_files` 定义之后添加：

```python
async def _tool_liteparse(
    arguments: Dict[str, Any],
    session: Optional[StudioSession] = None,
) -> str:
    """Dispatch to UnifiedDocumentTool which chains LiteParseAdapter → MinerU → plain text."""
    raw_path = str(arguments.get("path", "")).strip()
    if not raw_path:
        return "ERROR: missing required parameter 'path'."
    try:
        path = _resolve_workspace_path(raw_path, session, pick_existing=True)
    except ValueError as exc:
        return f"ERROR: {exc}"
    if not path.exists():
        return f"ERROR: file not found: {path}"

    from agenticx.tools.unified_document import UnifiedDocumentTool
    tool = UnifiedDocumentTool()
    success, content = tool.execute(str(path))
    if success:
        return content
    return f"ERROR: document parsing failed: {content}"
```

## 效果

- 模型可以直接调用 `liteparse(path="/path/to/report.pdf")` 解析文档。
- Desktop 设置里「分身工具权限 → LiteParse → 禁用」会让 `_filter_tools_by_policy` 把该 function 从工具列表里移除，模型就不会调用它。
- 实际解析优先级：LiteParse CLI（已装）→ MinerU → 纯文本降级，由 `UnifiedDocumentTool` 内部自动处理，无需额外代码。
