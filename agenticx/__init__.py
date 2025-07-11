"""
AgenticX: 统一的多智能体框架

一个生产就绪的多智能体应用开发框架，支持从简单自动化助手到复杂协作式智能体系统的构建。

核心模块：
- core: 核心抽象和组件 (M1-M7)
- llms: LLM 服务提供层 (M2)
- tools: 工具系统 (M3)
- memory: 记忆系统 (M4)
"""

__version__ = "0.1.0"
__author__ = "AgenticX Team"
__description__ = "统一的多智能体框架"

# 导出核心组件
from .core import *
from .llms import *
from .tools import *
from .memory import *

__all__ = [
    # 版本信息
    "__version__",
    "__author__", 
    "__description__",
] 