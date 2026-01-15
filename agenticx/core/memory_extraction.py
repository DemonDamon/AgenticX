"""
Memory Extraction Pipeline

从对话中自动提取事实性记忆，支持 session 和 user 级别的记忆管理。
参考自 AIGNE Framework 的 AgentSession.updateSessionMemory/updateUserMemory 设计。

核心设计原则：
- 异步执行，不阻塞主流程
- Session facts 临时，User facts 持久
- Token budget 限制注入大小
- 与现有 KnowledgeBase 集成
"""

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Union
from enum import Enum

logger = logging.getLogger(__name__)


# =============================================================================
# 数据模型
# =============================================================================

class MemoryScope(str, Enum):
    """记忆作用域"""
    SESSION = "session"  # 会话级别（临时）
    USER = "user"        # 用户级别（持久）
    GLOBAL = "global"    # 全局级别（跨用户）


@dataclass
class MemoryFact:
    """
    从对话中提取的事实。
    
    与 KnowledgeBase 的 MemoryRecord 对齐，便于存储。
    """
    label: str
    fact: str
    confidence: float = 1.0
    source_turn_id: Optional[str] = None
    scope: MemoryScope = MemoryScope.SESSION
    extracted_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式，用于存储到 KnowledgeBase。"""
        return {
            "content": self.fact,
            "metadata": {
                "label": self.label,
                "confidence": self.confidence,
                "source_turn_id": self.source_turn_id,
                "scope": self.scope.value,
                "extracted_at": self.extracted_at.isoformat(),
                "content_type": "memory_fact",
                **self.metadata
            }
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MemoryFact":
        """从字典格式恢复。"""
        metadata = data.get("metadata", {})
        return cls(
            label=metadata.get("label", "unknown"),
            fact=data.get("content", ""),
            confidence=metadata.get("confidence", 1.0),
            source_turn_id=metadata.get("source_turn_id"),
            scope=MemoryScope(metadata.get("scope", "session")),
            extracted_at=datetime.fromisoformat(metadata.get("extracted_at", datetime.now(timezone.utc).isoformat())),
            metadata={k: v for k, v in metadata.items() if k not in ("label", "confidence", "source_turn_id", "scope", "extracted_at", "content_type")}
        )


@dataclass
class MemoryExtractionConfig:
    """内存提取配置。"""
    enabled: bool = True
    async_mode: bool = True
    session_memory_enabled: bool = True
    user_memory_enabled: bool = True
    # Token 预算：提取的记忆占上下文的比例上限
    memory_ratio: float = 0.1
    # 最大记忆条数
    max_session_facts: int = 50
    max_user_facts: int = 200
    # 提取触发阈值：多少条新消息后触发提取
    extraction_interval: int = 5
    # 去重相似度阈值
    dedup_similarity_threshold: float = 0.85
    # 提取超时（秒）
    extraction_timeout: float = 30.0


@dataclass
class ExtractionResult:
    """提取结果。"""
    new_facts: List[MemoryFact]
    updated_facts: List[MemoryFact]
    removed_facts: List[str]  # 被去重移除的 fact labels
    extraction_time: float
    success: bool
    error: Optional[str] = None


# =============================================================================
# 提取 Prompt 模板
# =============================================================================

DEFAULT_EXTRACTION_PROMPT = """You are analyzing a conversation to extract important facts that should be remembered.

## Conversation
{messages}

## Existing Facts (for deduplication)
{existing_facts}

## Instructions
1. Extract NEW facts from this conversation that are:
   - Preferences stated by the user
   - Important decisions made
   - Key information about the user or their goals
   - Constraints or requirements mentioned
   - Lessons learned from the conversation

2. For each fact, provide:
   - A short label (3-5 words)
   - The fact itself (1-2 sentences)
   - Confidence score (0.0-1.0)

3. Do NOT extract:
   - Temporary information (e.g., "user is currently looking at...")
   - Information already in existing facts
   - Trivial or obvious information

## Output Format (JSON)
```json
{{
  "facts": [
    {{"label": "...", "fact": "...", "confidence": 0.9}},
    ...
  ]
}}
```

Extract facts now:"""


CONSOLIDATION_PROMPT = """You are consolidating memory facts from a session into a user's long-term memory.

## Session Facts
{session_facts}

## Existing User Facts
{user_facts}

## Instructions
1. Identify facts that should be persisted to user memory:
   - Stable preferences (not one-time preferences)
   - Important user information
   - Recurring patterns or behaviors

2. For facts already in user memory:
   - Update if the new information is more accurate/complete
   - Keep existing if no new information

3. Merge similar facts into consolidated versions

## Output Format (JSON)
```json
{{
  "facts_to_add": [
    {{"label": "...", "fact": "...", "confidence": 0.9}}
  ],
  "facts_to_update": [
    {{"label": "existing_label", "new_fact": "...", "confidence": 0.9}}
  ]
}}
```

Consolidate facts now:"""


# =============================================================================
# 提取器抽象基类
# =============================================================================

class BaseMemoryExtractor(ABC):
    """内存提取器抽象基类。"""
    
    @abstractmethod
    async def extract(
        self,
        messages: List[Dict[str, Any]],
        existing_facts: List[MemoryFact],
        config: Optional[MemoryExtractionConfig] = None,
    ) -> ExtractionResult:
        """
        从消息中提取事实。
        
        Args:
            messages: 对话消息列表
            existing_facts: 现有事实（用于去重）
            config: 提取配置
            
        Returns:
            提取结果
        """
        pass


class LLMMemoryExtractor(BaseMemoryExtractor):
    """
    基于 LLM 的内存提取器。
    
    使用 LLM 理解对话语义并提取关键事实。
    """
    
    def __init__(
        self,
        llm_provider: Any,
        extraction_prompt: Optional[str] = None,
        model: Optional[str] = None,
    ):
        """
        Args:
            llm_provider: LLM 提供者实例
            extraction_prompt: 自定义提取 prompt
            model: 指定模型名称
        """
        self.llm_provider = llm_provider
        self.extraction_prompt = extraction_prompt or DEFAULT_EXTRACTION_PROMPT
        self.model = model
    
    async def extract(
        self,
        messages: List[Dict[str, Any]],
        existing_facts: List[MemoryFact],
        config: Optional[MemoryExtractionConfig] = None,
    ) -> ExtractionResult:
        """使用 LLM 提取事实。"""
        config = config or MemoryExtractionConfig()
        start_time = time.time()
        
        if not messages:
            return ExtractionResult(
                new_facts=[],
                updated_facts=[],
                removed_facts=[],
                extraction_time=0.0,
                success=True
            )
        
        try:
            # 格式化消息
            messages_text = self._format_messages(messages)
            existing_facts_text = self._format_existing_facts(existing_facts)
            
            # 构建 prompt
            prompt = self.extraction_prompt.format(
                messages=messages_text,
                existing_facts=existing_facts_text
            )
            
            # 调用 LLM
            response = await asyncio.wait_for(
                self._invoke_llm(prompt),
                timeout=config.extraction_timeout
            )
            
            # 解析响应
            new_facts = self._parse_response(response)
            
            # 去重
            new_facts, removed = self._deduplicate(
                new_facts, 
                existing_facts, 
                config.dedup_similarity_threshold
            )
            
            extraction_time = time.time() - start_time
            
            logger.info(
                f"Memory extraction completed: {len(new_facts)} new facts, "
                f"{len(removed)} deduplicated, took {extraction_time:.2f}s"
            )
            
            return ExtractionResult(
                new_facts=new_facts,
                updated_facts=[],
                removed_facts=removed,
                extraction_time=extraction_time,
                success=True
            )
            
        except asyncio.TimeoutError:
            logger.warning(f"Memory extraction timed out after {config.extraction_timeout}s")
            return ExtractionResult(
                new_facts=[],
                updated_facts=[],
                removed_facts=[],
                extraction_time=config.extraction_timeout,
                success=False,
                error="Extraction timed out"
            )
        except Exception as e:
            logger.error(f"Memory extraction failed: {e}")
            return ExtractionResult(
                new_facts=[],
                updated_facts=[],
                removed_facts=[],
                extraction_time=time.time() - start_time,
                success=False,
                error=str(e)
            )
    
    async def _invoke_llm(self, prompt: str) -> str:
        """调用 LLM 获取响应。"""
        import inspect
        
        response = None
        messages = [{"role": "user", "content": prompt}]
        
        # 检查是否有异步方法（必须是真正的协程函数）
        invoke_async = getattr(self.llm_provider, 'invoke_async', None)
        if invoke_async is not None and (
            inspect.iscoroutinefunction(invoke_async) or 
            asyncio.iscoroutinefunction(invoke_async)
        ):
            response = await invoke_async(messages)
        elif hasattr(self.llm_provider, 'invoke'):
            # 同步调用
            response = self.llm_provider.invoke(messages)
        else:
            raise ValueError("LLM provider must have 'invoke' or 'invoke_async' method")
        
        # 提取响应内容
        if response is None:
            return ""
        if hasattr(response, 'content'):
            content = response.content
            # 处理 content 可能是 MagicMock 的情况
            if isinstance(content, str):
                return content
            return str(content)
        return str(response)
    
    def _format_messages(self, messages: List[Dict[str, Any]]) -> str:
        """格式化消息列表为文本。"""
        lines = []
        for msg in messages[-20:]:  # 只取最近 20 条
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if isinstance(content, str):
                content = content[:500] + "..." if len(content) > 500 else content
            lines.append(f"[{role}]: {content}")
        return "\n".join(lines)
    
    def _format_existing_facts(self, facts: List[MemoryFact]) -> str:
        """格式化现有事实为文本。"""
        if not facts:
            return "None"
        lines = []
        for fact in facts[:30]:  # 只展示最近 30 条
            lines.append(f"- {fact.label}: {fact.fact}")
        return "\n".join(lines)
    
    def _parse_response(self, response: str) -> List[MemoryFact]:
        """解析 LLM 响应为事实列表。"""
        import json
        import re
        
        facts = []
        
        # 尝试提取 JSON
        json_match = re.search(r'\{[\s\S]*\}', response)
        if json_match:
            try:
                data = json.loads(json_match.group())
                for item in data.get("facts", []):
                    facts.append(MemoryFact(
                        label=item.get("label", "unknown"),
                        fact=item.get("fact", ""),
                        confidence=float(item.get("confidence", 0.8)),
                        scope=MemoryScope.SESSION
                    ))
            except json.JSONDecodeError:
                logger.warning("Failed to parse JSON response, using fallback")
        
        return facts
    
    def _deduplicate(
        self,
        new_facts: List[MemoryFact],
        existing_facts: List[MemoryFact],
        threshold: float
    ) -> tuple:
        """去重新事实。"""
        # 简单的字符串匹配去重（可扩展为语义相似度）
        existing_labels = {f.label.lower() for f in existing_facts}
        existing_contents = {f.fact.lower() for f in existing_facts}
        
        unique_facts = []
        removed = []
        
        for fact in new_facts:
            label_lower = fact.label.lower()
            fact_lower = fact.fact.lower()
            
            # 检查 label 重复
            if label_lower in existing_labels:
                removed.append(fact.label)
                continue
            
            # 检查内容高度相似
            is_duplicate = False
            for existing in existing_contents:
                similarity = self._simple_similarity(fact_lower, existing)
                if similarity >= threshold:
                    is_duplicate = True
                    removed.append(fact.label)
                    break
            
            if not is_duplicate:
                unique_facts.append(fact)
        
        return unique_facts, removed
    
    def _simple_similarity(self, s1: str, s2: str) -> float:
        """简单的字符串相似度计算（Jaccard）。"""
        words1 = set(s1.split())
        words2 = set(s2.split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = len(words1 & words2)
        union = len(words1 | words2)
        
        return intersection / union if union > 0 else 0.0


class SimpleMemoryExtractor(BaseMemoryExtractor):
    """
    简单的内存提取器（不使用 LLM）。
    
    使用规则和关键词匹配提取事实，适用于测试或低成本场景。
    """
    
    # 关键词模式
    PREFERENCE_KEYWORDS = ["prefer", "like", "want", "need", "always", "never", "favorite"]
    INFO_KEYWORDS = ["my name is", "i am", "i work", "my job", "i live"]
    
    async def extract(
        self,
        messages: List[Dict[str, Any]],
        existing_facts: List[MemoryFact],
        config: Optional[MemoryExtractionConfig] = None,
    ) -> ExtractionResult:
        """使用规则提取事实。"""
        config = config or MemoryExtractionConfig()
        start_time = time.time()
        
        facts = []
        
        for msg in messages:
            if msg.get("role") != "user":
                continue
            
            content = msg.get("content", "")
            if not isinstance(content, str):
                continue
            
            content_lower = content.lower()
            
            # 检查偏好关键词
            for keyword in self.PREFERENCE_KEYWORDS:
                if keyword in content_lower:
                    # 提取包含关键词的句子
                    sentences = content.split('.')
                    for sentence in sentences:
                        if keyword in sentence.lower():
                            facts.append(MemoryFact(
                                label=f"user_preference_{len(facts)}",
                                fact=sentence.strip(),
                                confidence=0.6,
                                scope=MemoryScope.SESSION
                            ))
                            break
                    break
            
            # 检查信息关键词
            for keyword in self.INFO_KEYWORDS:
                if keyword in content_lower:
                    sentences = content.split('.')
                    for sentence in sentences:
                        if keyword in sentence.lower():
                            facts.append(MemoryFact(
                                label=f"user_info_{len(facts)}",
                                fact=sentence.strip(),
                                confidence=0.7,
                                scope=MemoryScope.USER
                            ))
                            break
                    break
        
        extraction_time = time.time() - start_time
        
        return ExtractionResult(
            new_facts=facts[:config.max_session_facts],
            updated_facts=[],
            removed_facts=[],
            extraction_time=extraction_time,
            success=True
        )


# =============================================================================
# Session 级别记忆管理器
# =============================================================================

class SessionMemoryManager:
    """
    Session 级别的记忆管理器。
    
    负责：
    - 触发内存提取
    - 管理 session 级别的事实
    - 与 KnowledgeBase 交互存储
    """
    
    def __init__(
        self,
        extractor: BaseMemoryExtractor,
        knowledge_base: Optional[Any] = None,
        config: Optional[MemoryExtractionConfig] = None,
    ):
        """
        Args:
            extractor: 内存提取器
            knowledge_base: 知识库实例（用于持久化）
            config: 提取配置
        """
        self.extractor = extractor
        self.knowledge_base = knowledge_base
        self.config = config or MemoryExtractionConfig()
        
        # Session 内存缓存
        self._session_facts: List[MemoryFact] = []
        self._message_count_since_extraction = 0
        self._extraction_task: Optional[asyncio.Task] = None
        self._session_id: Optional[str] = None
    
    def set_session_id(self, session_id: str) -> None:
        """设置 session ID。"""
        self._session_id = session_id
    
    async def maybe_extract(
        self,
        messages: List[Dict[str, Any]],
        force: bool = False
    ) -> Optional[ExtractionResult]:
        """
        检查并可能触发内存提取。
        
        Args:
            messages: 当前消息列表
            force: 是否强制提取
            
        Returns:
            提取结果（如果触发了提取）
        """
        if not self.config.enabled:
            return None
        
        self._message_count_since_extraction += 1
        
        should_extract = force or (
            self._message_count_since_extraction >= self.config.extraction_interval
        )
        
        if not should_extract:
            return None
        
        self._message_count_since_extraction = 0
        
        if self.config.async_mode:
            # 异步执行，不阻塞
            self._extraction_task = asyncio.create_task(
                self._do_extract(messages)
            )
            return None
        else:
            # 同步执行
            return await self._do_extract(messages)
    
    async def _do_extract(
        self,
        messages: List[Dict[str, Any]]
    ) -> ExtractionResult:
        """执行提取逻辑。"""
        logger.debug(
            f"Starting memory extraction for session {self._session_id}, "
            f"{len(messages)} messages"
        )
        
        result = await self.extractor.extract(
            messages,
            self._session_facts,
            self.config
        )
        
        if result.success and result.new_facts:
            # 添加到 session 缓存
            for fact in result.new_facts:
                fact.metadata["session_id"] = self._session_id
            
            self._session_facts.extend(result.new_facts)
            
            # 限制缓存大小
            if len(self._session_facts) > self.config.max_session_facts:
                self._session_facts = self._session_facts[-self.config.max_session_facts:]
            
            # 持久化到 KnowledgeBase
            if self.knowledge_base:
                await self._persist_facts(result.new_facts)
        
        return result
    
    async def _persist_facts(self, facts: List[MemoryFact]) -> None:
        """持久化事实到 KnowledgeBase。"""
        if not self.knowledge_base:
            return
        
        for fact in facts:
            try:
                await self.knowledge_base.add(
                    content=fact.fact,
                    metadata=fact.to_dict()["metadata"]
                )
            except Exception as e:
                logger.warning(f"Failed to persist fact '{fact.label}': {e}")
    
    def get_session_facts(self) -> List[MemoryFact]:
        """获取当前 session 的所有事实。"""
        return self._session_facts.copy()
    
    def get_facts_for_context(self, max_tokens: Optional[int] = None) -> str:
        """
        获取用于注入到上下文的事实摘要。
        
        Args:
            max_tokens: 最大 token 数限制
            
        Returns:
            格式化的事实文本
        """
        if not self._session_facts:
            return ""
        
        lines = ["## Known Facts About This Session"]
        
        # 按置信度排序
        sorted_facts = sorted(
            self._session_facts,
            key=lambda f: f.confidence,
            reverse=True
        )
        
        total_chars = 0
        max_chars = (max_tokens or 500) * 4  # 估算 token
        
        for fact in sorted_facts:
            line = f"- {fact.label}: {fact.fact}"
            if total_chars + len(line) > max_chars:
                break
            lines.append(line)
            total_chars += len(line)
        
        return "\n".join(lines)
    
    async def consolidate_to_user_memory(
        self,
        user_memory_manager: Optional["UserMemoryManager"] = None
    ) -> None:
        """
        将 session 记忆整合到用户级别记忆。
        
        在 session 结束时调用。
        """
        if not user_memory_manager or not self._session_facts:
            return
        
        await user_memory_manager.consolidate(self._session_facts)
    
    def clear(self) -> None:
        """清除 session 缓存。"""
        self._session_facts = []
        self._message_count_since_extraction = 0
        if self._extraction_task and not self._extraction_task.done():
            self._extraction_task.cancel()


class UserMemoryManager:
    """
    用户级别的记忆管理器。
    
    负责：
    - 管理跨 session 的持久化用户记忆
    - 整合 session 记忆
    - 与长期存储交互
    """
    
    def __init__(
        self,
        extractor: Optional[BaseMemoryExtractor] = None,
        knowledge_base: Optional[Any] = None,
        config: Optional[MemoryExtractionConfig] = None,
    ):
        """
        Args:
            extractor: 内存提取器（用于整合）
            knowledge_base: 知识库实例
            config: 配置
        """
        self.extractor = extractor
        self.knowledge_base = knowledge_base
        self.config = config or MemoryExtractionConfig()
        
        # 用户记忆缓存
        self._user_facts: List[MemoryFact] = []
        self._user_id: Optional[str] = None
    
    def set_user_id(self, user_id: str) -> None:
        """设置用户 ID。"""
        self._user_id = user_id
    
    async def load_user_facts(self) -> List[MemoryFact]:
        """从存储加载用户事实。"""
        if not self.knowledge_base or not self._user_id:
            return []
        
        try:
            results = await self.knowledge_base.search(
                query="",
                limit=self.config.max_user_facts,
                metadata_filter={
                    "scope": MemoryScope.USER.value,
                    "user_id": self._user_id
                }
            )
            
            self._user_facts = [
                MemoryFact.from_dict({
                    "content": r.content,
                    "metadata": r.metadata
                })
                for r in results
            ]
            
            logger.info(f"Loaded {len(self._user_facts)} user facts for {self._user_id}")
            return self._user_facts
            
        except Exception as e:
            logger.warning(f"Failed to load user facts: {e}")
            return []
    
    async def consolidate(self, session_facts: List[MemoryFact]) -> None:
        """
        整合 session 事实到用户记忆。
        
        Args:
            session_facts: 要整合的 session 事实
        """
        if not session_facts:
            return
        
        # 筛选高置信度的事实
        high_confidence_facts = [
            f for f in session_facts
            if f.confidence >= 0.7
        ]
        
        for fact in high_confidence_facts:
            # 更新作用域为 USER
            fact.scope = MemoryScope.USER
            fact.metadata["user_id"] = self._user_id
            
            # 检查是否已存在
            existing = next(
                (f for f in self._user_facts if f.label == fact.label),
                None
            )
            
            if existing:
                # 更新现有事实
                existing.fact = fact.fact
                existing.confidence = max(existing.confidence, fact.confidence)
            else:
                self._user_facts.append(fact)
        
        # 限制大小
        if len(self._user_facts) > self.config.max_user_facts:
            # 保留置信度最高的
            self._user_facts = sorted(
                self._user_facts,
                key=lambda f: f.confidence,
                reverse=True
            )[:self.config.max_user_facts]
        
        # 持久化
        if self.knowledge_base:
            await self._persist_user_facts(high_confidence_facts)
    
    async def _persist_user_facts(self, facts: List[MemoryFact]) -> None:
        """持久化用户事实。"""
        if not self.knowledge_base:
            return
        
        for fact in facts:
            try:
                await self.knowledge_base.add(
                    content=fact.fact,
                    metadata=fact.to_dict()["metadata"]
                )
            except Exception as e:
                logger.warning(f"Failed to persist user fact '{fact.label}': {e}")
    
    def get_user_facts(self) -> List[MemoryFact]:
        """获取用户事实。"""
        return self._user_facts.copy()
    
    def get_facts_for_context(self, max_tokens: Optional[int] = None) -> str:
        """获取用于注入上下文的用户事实。"""
        if not self._user_facts:
            return ""
        
        lines = ["## Known Facts About This User"]
        
        sorted_facts = sorted(
            self._user_facts,
            key=lambda f: f.confidence,
            reverse=True
        )
        
        total_chars = 0
        max_chars = (max_tokens or 500) * 4
        
        for fact in sorted_facts:
            line = f"- {fact.label}: {fact.fact}"
            if total_chars + len(line) > max_chars:
                break
            lines.append(line)
            total_chars += len(line)
        
        return "\n".join(lines)


# =============================================================================
# 工厂函数
# =============================================================================

def create_memory_extractor(
    llm_provider: Optional[Any] = None,
    use_simple: bool = False,
    extraction_prompt: Optional[str] = None,
) -> BaseMemoryExtractor:
    """
    创建内存提取器。
    
    Args:
        llm_provider: LLM 提供者（如果使用 LLM 提取）
        use_simple: 是否使用简单提取器
        extraction_prompt: 自定义提取 prompt
        
    Returns:
        内存提取器实例
    """
    if use_simple or llm_provider is None:
        return SimpleMemoryExtractor()
    else:
        return LLMMemoryExtractor(
            llm_provider=llm_provider,
            extraction_prompt=extraction_prompt
        )


def create_session_memory_manager(
    llm_provider: Optional[Any] = None,
    knowledge_base: Optional[Any] = None,
    config: Optional[MemoryExtractionConfig] = None,
    use_simple_extractor: bool = False,
) -> SessionMemoryManager:
    """
    创建 Session 记忆管理器。
    
    Args:
        llm_provider: LLM 提供者
        knowledge_base: 知识库实例
        config: 配置
        use_simple_extractor: 是否使用简单提取器
        
    Returns:
        SessionMemoryManager 实例
    """
    extractor = create_memory_extractor(
        llm_provider=llm_provider,
        use_simple=use_simple_extractor
    )
    
    return SessionMemoryManager(
        extractor=extractor,
        knowledge_base=knowledge_base,
        config=config
    )
