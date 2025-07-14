"""
AgenticX CLI 工具模块

提供命令行工具、项目脚手架、调试和部署等功能
"""

from .main import main
from .client import AgenticXClient, AsyncAgenticXClient
from .scaffold import ProjectScaffolder
from .debug import DebugServer
from .docs import DocGenerator
from .deploy import DeployManager

__version__ = "0.1.3"

__all__ = [
    "main",
    "AgenticXClient", 
    "AsyncAgenticXClient",
    "ProjectScaffolder",
    "DebugServer",
    "DocGenerator", 
    "DeployManager"
] 