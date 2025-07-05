"""
AgenticX 工具系统

这个模块提供了统一的工具抽象和实现，支持：
- 基于类的工具 (BaseTool)
- 函数式工具 (FunctionTool, @tool 装饰器)
- 远程工具 (RemoteTool)
- 内置工具集 (BuiltInTools)
"""

from .base import BaseTool
from .function_tool import FunctionTool, tool
from .executor import ToolExecutor
from .credentials import CredentialStore
from .remote import RemoteTool, MCPServerConfig
from .mineru import create_mineru_parse_tool, create_mineru_ocr_languages_tool
from .builtin import (
    WebSearchTool,
    FileTool,
    CodeInterpreterTool,
)

__all__ = [
    # 核心抽象
    "BaseTool",
    "FunctionTool", 
    "tool",
    
    # 执行器和管理
    "ToolExecutor",
    "CredentialStore",
    
    # 远程工具
    "RemoteTool",
    "MCPServerConfig",
    
    # MinerU 工具
    "create_mineru_parse_tool",
    "create_mineru_ocr_languages_tool",
    
    # 内置工具
    "WebSearchTool",
    "FileTool", 
    "CodeInterpreterTool",
] 