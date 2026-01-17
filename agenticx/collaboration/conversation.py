"""
Conversation Manager（对话管理器）

支持多轮对话的上下文保留和对话历史管理。
利用现有的 EventLog 和 Memory 系统。

参考 Eigent conversation_history 和 new_task_state 机制。
"""

import time
import logging
from typing import Any, Dict, List, Optional, Union
from datetime import datetime
from pydantic import BaseModel, Field  # type: ignore

from ..core.event import EventLog
from ..memory.short_term import ShortTermMemory
from ..memory.episodic_memory import EpisodicMemory

logger = logging.getLogger(__name__)


class ConversationEntry(BaseModel):
    """对话条目"""
    role: str = Field(description="角色标识（user, assistant, task_result, system）")
    content: Any = Field(description="内容")
    timestamp: float = Field(default_factory=time.time, description="时间戳")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")


class ConversationManager:
    """对话管理器
    
    功能:
    1. 对话历史保留（支持多轮对话）
    2. 上下文构建（为 Coordinator 提供历史上下文）
    3. 与 EventLog 和 Memory 系统集成
    """
    
    def __init__(
        self,
        event_log: Optional[EventLog] = None,
        memory: Optional[Union[ShortTermMemory, EpisodicMemory]] = None,
        max_history_length: int = 100000,  # 最大历史字符数
        max_entries: int = 100,  # 最大条目数
    ):
        """
        Args:
            event_log: EventLog 实例（用于对话历史持久化）
            memory: Memory 实例（ShortTermMemory 或 EpisodicMemory）
            max_history_length: 最大历史字符数
            max_entries: 最大条目数
        """
        self.event_log = event_log
        self.memory = memory
        self.max_history_length = max_history_length
        self.max_entries = max_entries
        self.conversation_history: List[ConversationEntry] = []
    
    async def add_conversation(
        self,
        role: str,
        content: Any,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        添加对话记录
        
        Args:
            role: 角色标识（user, assistant, task_result, system）
            content: 内容
            metadata: 元数据（可选）
        """
        entry = ConversationEntry(
            role=role,
            content=content,
            timestamp=time.time(),
            metadata=metadata or {},
        )
        self.conversation_history.append(entry)
        
        logger.debug(f"[Conversation] Added entry: role={role}, content_len={len(str(content))}")
        
        # 记录到 Memory（如果提供）
        if self.memory:
            try:
                # 尝试使用 add 方法（BaseMemory 接口）
                await self.memory.add(
                    content=str(content),
                    metadata={"role": role, **(metadata or {})},
                )
            except Exception as e:
                logger.debug(f"Memory add skipped (expected if not using BaseMemory): {e}")
        
        # 清理过长的历史
        await self._cleanup_history()
    
    def get_conversation_context(
        self,
        include_roles: Optional[List[str]] = None,
        max_tokens: Optional[int] = None,
    ) -> str:
        """
        获取对话上下文（用于 Coordinator）
        
        Args:
            include_roles: 包含的角色列表（默认全部）
            max_tokens: 最大 Token 数（简单估算：4 字符 = 1 token）
        
        Returns:
            格式化的对话上下文
        """
        context_parts = []
        
        # 过滤角色
        entries = self.conversation_history
        if include_roles:
            entries = [e for e in entries if e.role in include_roles]
        
        # 只保留最近的条目
        entries = entries[-self.max_entries:]
        
        for entry in entries:
            if entry.role == "task_result":
                # 任务结果格式化
                if isinstance(entry.content, dict):
                    task_content = entry.content.get("task_content", "")
                    task_result = entry.content.get("task_result", "")
                    context_parts.append(
                        f"Previous Task: {task_content}\nResult: {task_result}"
                    )
                else:
                    context_parts.append(f"Previous Task Result: {entry.content}")
            elif entry.role == "user":
                context_parts.append(f"User: {entry.content}")
            elif entry.role == "assistant":
                context_parts.append(f"Assistant: {entry.content}")
            elif entry.role == "system":
                context_parts.append(f"System: {entry.content}")
        
        context = "\n\n".join(context_parts)
        
        # Token 限制（简单截断）
        if max_tokens:
            max_chars = max_tokens * 4  # 粗略估算
            if len(context) > max_chars:
                context = context[-max_chars:]
                logger.debug(f"[Conversation] Truncated context to {max_chars} chars")
        
        return context
    
    async def _cleanup_history(self) -> None:
        """清理过长的对话历史"""
        # 限制条目数
        if len(self.conversation_history) > self.max_entries:
            removed = len(self.conversation_history) - self.max_entries
            self.conversation_history = self.conversation_history[-self.max_entries:]
            logger.debug(f"[Conversation] Removed {removed} old entries")
        
        # 限制字符数
        total_chars = sum(len(str(e.content)) for e in self.conversation_history)
        if total_chars > self.max_history_length:
            # 从前面删除，保留最近的
            while total_chars > self.max_history_length and len(self.conversation_history) > 1:
                removed_entry = self.conversation_history.pop(0)
                total_chars -= len(str(removed_entry.content))
            logger.debug(f"[Conversation] Cleaned up history, total_chars={total_chars}")
    
    def get_history(
        self,
        role: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[ConversationEntry]:
        """
        获取对话历史
        
        Args:
            role: 角色过滤（可选）
            limit: 限制返回数量
        
        Returns:
            对话条目列表
        """
        entries = self.conversation_history
        
        if role:
            entries = [e for e in entries if e.role == role]
        
        if limit:
            entries = entries[-limit:]
        
        return entries
    
    def clear_history(self) -> int:
        """
        清空对话历史
        
        Returns:
            清除的条目数
        """
        count = len(self.conversation_history)
        self.conversation_history.clear()
        logger.info(f"[Conversation] Cleared {count} entries")
        return count
    
    def get_history_stats(self) -> Dict[str, Any]:
        """
        获取对话历史统计信息
        
        Returns:
            统计信息字典
        """
        total_entries = len(self.conversation_history)
        total_chars = sum(len(str(e.content)) for e in self.conversation_history)
        
        role_counts = {}
        for entry in self.conversation_history:
            role_counts[entry.role] = role_counts.get(entry.role, 0) + 1
        
        return {
            "total_entries": total_entries,
            "total_chars": total_chars,
            "role_counts": role_counts,
            "estimated_tokens": total_chars // 4,  # 粗略估算
        }
