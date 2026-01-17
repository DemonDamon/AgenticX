"""
Context Manager（上下文管理器）

封装 ContextCompiler 和 TokenCounter，实现 Coordinator 和 Worker 上下文的精细化管理。

参考 Eigent coordinator_context 注入机制。
"""

import logging
from typing import Any, Dict, List, Optional

from ...core.context_compiler import ContextCompiler, CompactionStrategy
from ...core.token_counter import TokenCounter
from ...core.event import EventLog

logger = logging.getLogger(__name__)


class ContextManager:
    """上下文管理器（利用现有 ContextCompiler 和 TokenCounter）
    
    功能:
    1. 构建 Coordinator 专用上下文（包含历史信息）
    2. 构建 Worker 专用上下文（仅包含当前任务）
    3. Token 限制和优化
    """
    
    def __init__(
        self,
        context_compiler: Optional[ContextCompiler] = None,
        token_counter: Optional[TokenCounter] = None,
        max_coordinator_tokens: int = 2000,
        max_worker_tokens: int = 1000,
    ):
        """
        Args:
            context_compiler: 上下文编译器（用于上下文压缩和优化）
            token_counter: Token 计数器（用于精确 Token 计量）
            max_coordinator_tokens: Coordinator 最大 Token 限制
            max_worker_tokens: Worker 最大 Token 限制
        """
        self.context_compiler = context_compiler or ContextCompiler()
        self.token_counter = token_counter or TokenCounter()
        self.max_coordinator_tokens = max_coordinator_tokens
        self.max_worker_tokens = max_worker_tokens
    
    def build_coordinator_context(
        self,
        conversation_history: List[Dict[str, Any]],
        event_log: Optional[EventLog] = None,
    ) -> str:
        """
        构建 Coordinator 专用上下文
        
        策略:
        1. 优先使用 EventLog + ContextCompiler（如果提供）
        2. 否则使用 conversation_history + TokenCounter
        3. 只包含任务结果和摘要（不包含详细工具调用）
        4. Token 限制（避免上下文过长）
        
        Args:
            conversation_history: 对话历史
            event_log: EventLog 实例（可选）
        
        Returns:
            格式化的上下文字符串
        """
        # 策略 1: 如果提供 EventLog，使用 ContextCompiler 编译上下文
        if event_log and len(event_log.events) > 0:
            try:
                compiled_context = self.context_compiler.compile_context(
                    event_log=event_log,
                    strategy=CompactionStrategy.TOPIC_BASED,
                    max_tokens=self.max_coordinator_tokens,
                )
                logger.debug(f"[ContextManager] Built coordinator context from EventLog")
                return compiled_context
            except Exception as e:
                logger.warning(f"[ContextManager] Failed to compile context from EventLog: {e}")
                # 降级到 conversation_history
        
        # 策略 2: 使用 conversation_history + TokenCounter
        context_parts = []
        
        # 只保留最近的条目
        recent_history = conversation_history[-10:] if len(conversation_history) > 10 else conversation_history
        
        for entry in recent_history:
            role = entry.get('role', '')
            content = entry.get('content', '')
            
            if role == 'task_result':
                # 只包含任务摘要
                summary = self._summarize_task_result(content)
                context_parts.append(f"Previous Task: {summary}")
            elif role in ['user', 'assistant', 'system']:
                # 其他角色的消息
                summary = self._summarize_content(content)
                context_parts.append(f"{role.capitalize()}: {summary}")
        
        context = "\n".join(context_parts)
        
        # Token 限制
        token_count = self.token_counter.count_tokens(context)
        if token_count > self.max_coordinator_tokens:
            # 简单截断：保留最近的内容（从后面截取）
            ratio = self.max_coordinator_tokens / token_count
            max_chars = int(len(context) * ratio)
            context = context[-max_chars:]
            logger.debug(
                f"[ContextManager] Truncated coordinator context: "
                f"{token_count} -> ~{self.max_coordinator_tokens} tokens"
            )
        
        return context
    
    def build_worker_context(
        self,
        task_description: str,
        dependency_results: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        构建 Worker 专用上下文（不含历史上下文）
        
        Args:
            task_description: 任务描述
            dependency_results: 依赖任务的结果（可选）
        
        Returns:
            格式化的上下文字符串
        """
        context_parts = [f"Task: {task_description}"]
        
        # 添加依赖任务结果
        if dependency_results:
            context_parts.append("\nDependency Results:")
            for dep_id, result in dependency_results.items():
                content = result.get("content", "")
                summary = self._summarize_content(content, max_length=100)
                context_parts.append(f"- {dep_id}: {summary}")
        
        context = "\n".join(context_parts)
        
        # Token 限制
        token_count = self.token_counter.count_tokens(context)
        if token_count > self.max_worker_tokens:
            # 简单截断：保留前面的内容（任务描述优先）
            ratio = self.max_worker_tokens / token_count
            max_chars = int(len(context) * ratio)
            context = context[:max_chars]
            logger.debug(
                f"[ContextManager] Truncated worker context: "
                f"{token_count} -> ~{self.max_worker_tokens} tokens"
            )
        
        return context
    
    def _summarize_task_result(self, result: Any) -> str:
        """摘要任务结果（避免上下文过长）"""
        if isinstance(result, dict):
            task_content = result.get("task_content", "")
            task_result = result.get("task_result", "")
            return f"{task_content} -> {self._summarize_content(task_result)}"
        return self._summarize_content(result)
    
    def _summarize_content(self, content: Any, max_length: int = 200) -> str:
        """摘要内容"""
        content_str = str(content)
        if len(content_str) > max_length:
            return content_str[:max_length] + "..."
        return content_str
    
    def estimate_tokens(self, text: str) -> int:
        """估算文本的 Token 数
        
        Args:
            text: 要估算的文本
        
        Returns:
            Token 数量
        """
        return self.token_counter.count_tokens(text)
    
    def get_stats(self) -> Dict[str, Any]:
        """获取上下文管理统计信息"""
        return {
            "max_coordinator_tokens": self.max_coordinator_tokens,
            "max_worker_tokens": self.max_worker_tokens,
            "compiler_enabled": self.context_compiler is not None,
            "counter_enabled": self.token_counter is not None,
        }
