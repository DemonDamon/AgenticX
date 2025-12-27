"""
AgenticX 会话持久化模块

提供会话状态的持久化存储，借鉴 ADK 的 SessionService 设计：
- BaseSessionService: 会话服务抽象基类
- InMemorySessionService: 内存存储实现
- DatabaseSessionService: 数据库存储实现（SQLAlchemy）
"""

from .base import (
    BaseSessionService,
    Session,
    SessionState,
    SessionEvent,
    SessionNotFoundError,
    SessionAlreadyExistsError,
)
from .in_memory import InMemorySessionService
from .database import DatabaseSessionService

__all__ = [
    # 基类和模型
    "BaseSessionService",
    "Session",
    "SessionState",
    "SessionEvent",
    # 异常
    "SessionNotFoundError",
    "SessionAlreadyExistsError",
    # 实现
    "InMemorySessionService",
    "DatabaseSessionService",
]

