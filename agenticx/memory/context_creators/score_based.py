"""
Score-Based Context Creator

Implements CAMEL-style score-based context creation with two-phase token management
and automatic summarization trigger mechanism.

Inspired by CAMEL-AI's ScoreBasedContextCreator implementation.
"""

from typing import List, Dict, Any, Optional, Tuple
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
import logging

from ..base import MemoryRecord
from ...core.token_counter import TokenCounter

logger = logging.getLogger(__name__)


@dataclass
class MessageScore:
    """Message with relevance score for context selection."""
    record: MemoryRecord
    score: float
    index: int
    
    def __lt__(self, other):
        """Sort by score descending."""
        return self.score > other.score


class BaseTokenCounter(ABC):
    """
    Abstract base class for token counting.
    Compatible with AgenticX's TokenCounter interface.
    """
    
    @abstractmethod
    def count_tokens(self, text: str) -> int:
        """Count tokens in text."""
        pass
    
    @abstractmethod
    def count_tokens_estimate(self, text: str) -> int:
        """Fast estimation of token count."""
        pass


class AgenticXTokenCounterAdapter(BaseTokenCounter):
    """Adapter for AgenticX TokenCounter to CAMEL interface."""
    
    def __init__(self, token_counter: TokenCounter):
        self.token_counter = token_counter
    
    def count_tokens(self, text: str) -> int:
        """Count tokens precisely."""
        return self.token_counter.count_tokens(text)
    
    def count_tokens_estimate(self, text: str) -> int:
        """Fast estimation (uses same method for now)."""
        return self.token_counter.count_tokens(text)


class ScoreBasedContextCreator:
    """
    Score-based context creator with two-phase token management.
    
    Phase 1 (Estimation): Fast token estimation to quickly select messages
    Phase 2 (Precise): Accurate token counting to ensure limit compliance
    
    Automatically triggers summarization when token limit is exceeded.
    
    Example:
        >>> token_counter = TokenCounter(model="gpt-4")
        >>> creator = ScoreBasedContextCreator(
        ...     token_counter=token_counter,
        ...     token_limit=4000,
        ...     summarization_threshold=0.8
        ... )
        >>> messages, token_count = creator.create_context(records)
    """
    
    def __init__(
        self,
        token_counter: TokenCounter,
        token_limit: int,
        summarization_threshold: float = 0.8,
        keep_rate: float = 0.9,
        min_messages: int = 2,
        enable_summarization: bool = True,
        summarizer: Optional[Any] = None  # LLM provider for summarization
    ):
        """
        Initialize score-based context creator.
        
        Args:
            token_counter: Token counter instance
            token_limit: Maximum token limit for context
            summarization_threshold: Threshold (0-1) to trigger summarization
            keep_rate: Score decay rate for older messages (0-1)
            min_messages: Minimum number of messages to keep
            enable_summarization: Whether to enable automatic summarization
            summarizer: Optional LLM provider for summarization
        """
        if not isinstance(token_counter, TokenCounter):
            # Wrap if needed
            self.token_counter = AgenticXTokenCounterAdapter(token_counter)
        else:
            self.token_counter = AgenticXTokenCounterAdapter(token_counter)
        
        self.token_limit = token_limit
        self.summarization_threshold = summarization_threshold
        self.keep_rate = keep_rate
        self.min_messages = min_messages
        self.enable_summarization = enable_summarization
        self.summarizer = summarizer
        
        # Statistics
        self.summarization_count = 0
        self.total_tokens_saved = 0
    
    def create_context(
        self,
        records: List[MemoryRecord],
        query: Optional[str] = None
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        Create context from memory records using score-based selection.
        
        Args:
            records: List of memory records
            query: Optional query for relevance scoring
            
        Returns:
            Tuple of (selected messages, total token count)
        """
        if not records:
            return [], 0
        
        # Phase 1: Fast estimation and scoring
        scored_messages = self._score_messages(records, query)
        
        # Phase 2: Precise token counting and selection
        selected_messages, token_count = self._select_with_precise_counting(
            scored_messages
        )
        
        # Check if summarization is needed
        if self.enable_summarization and token_count > self.token_limit * self.summarization_threshold:
            selected_messages, token_count = self._apply_summarization(
                selected_messages,
                token_count
            )
        
        return selected_messages, token_count
    
    def _score_messages(
        self,
        records: List[MemoryRecord],
        query: Optional[str] = None
    ) -> List[MessageScore]:
        """
        Phase 1: Score messages using fast estimation.
        
        Scoring factors:
        1. Recency (newer messages get higher base score)
        2. Relevance (if query provided, match against content)
        3. Keep rate decay for older messages
        """
        scored = []
        
        for i, record in enumerate(records):
            # Base score from recency (newer = higher)
            recency_score = self.keep_rate ** (len(records) - i - 1)
            
            # Relevance score if query provided
            relevance_score = 1.0
            if query:
                relevance_score = self._calculate_relevance(record.content, query)
            
            # Combined score
            score = recency_score * relevance_score
            
            scored.append(MessageScore(
                record=record,
                score=score,
                index=i
            ))
        
        # Sort by score (descending)
        scored.sort()
        
        return scored
    
    def _select_with_precise_counting(
        self,
        scored_messages: List[MessageScore]
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        Phase 2: Select messages with precise token counting.
        
        Selects messages in score order until token limit is reached.
        Always keeps at least min_messages messages.
        """
        selected = []
        total_tokens = 0
        
        # Always include first message (highest score)
        if scored_messages:
            first_msg = scored_messages[0]
            msg_dict = self._record_to_message_dict(first_msg.record)
            msg_tokens = self.token_counter.count_tokens(msg_dict.get("content", ""))
            
            selected.append(msg_dict)
            total_tokens += msg_tokens
        
        # Select remaining messages by score
        for msg_score in scored_messages[1:]:
            msg_dict = self._record_to_message_dict(msg_score.record)
            msg_tokens = self.token_counter.count_tokens(msg_dict.get("content", ""))
            
            # Check if adding this message would exceed limit
            if total_tokens + msg_tokens > self.token_limit:
                # Ensure we keep minimum messages
                if len(selected) < self.min_messages:
                    selected.append(msg_dict)
                    total_tokens += msg_tokens
                else:
                    break
            else:
                selected.append(msg_dict)
                total_tokens += msg_tokens
        
        return selected, total_tokens
    
    def _apply_summarization(
        self,
        messages: List[Dict[str, Any]],
        current_token_count: int
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        Apply summarization when token count exceeds threshold.
        
        Summarizes older messages while keeping recent ones intact.
        """
        if not self.summarizer:
            logger.warning("Summarization requested but no summarizer provided")
            return messages, current_token_count
        
        # Keep recent messages (last 20% or at least 2)
        keep_count = max(2, int(len(messages) * 0.2))
        recent_messages = messages[-keep_count:]
        old_messages = messages[:-keep_count]
        
        if not old_messages:
            return messages, current_token_count
        
        # Summarize old messages
        try:
            summary = self._summarize_messages(old_messages)
            summary_dict = {
                "role": "system",
                "content": f"[Summary of {len(old_messages)} previous messages]\n{summary}",
                "metadata": {"type": "summary", "original_count": len(old_messages)}
            }
            
            # Calculate new token count
            summary_tokens = self.token_counter.count_tokens(summary)
            recent_tokens = sum(
                self.token_counter.count_tokens(msg.get("content", ""))
                for msg in recent_messages
            )
            new_token_count = summary_tokens + recent_tokens
            
            # Calculate tokens saved
            old_tokens = sum(
                self.token_counter.count_tokens(msg.get("content", ""))
                for msg in old_messages
            )
            tokens_saved = old_tokens - summary_tokens
            self.total_tokens_saved += max(0, tokens_saved)
            self.summarization_count += 1
            
            logger.info(
                f"Summarized {len(old_messages)} messages, "
                f"saved {tokens_saved} tokens "
                f"({old_tokens} -> {summary_tokens})"
            )
            
            return [summary_dict] + recent_messages, new_token_count
            
        except Exception as e:
            logger.error(f"Summarization failed: {e}")
            return messages, current_token_count
    
    def _summarize_messages(self, messages: List[Dict[str, Any]]) -> str:
        """
        Summarize a list of messages using LLM.
        
        Args:
            messages: List of message dictionaries
            
        Returns:
            Summary text
        """
        if not self.summarizer:
            raise ValueError("No summarizer provided")
        
        # Build summarization prompt
        message_texts = [
            f"{msg.get('role', 'user')}: {msg.get('content', '')}"
            for msg in messages
        ]
        conversation_text = "\n".join(message_texts)
        
        prompt = f"""Please summarize the following conversation, preserving key information and decisions:

{conversation_text}

Summary:"""
        
        # Call summarizer (assuming it has invoke or similar method)
        if hasattr(self.summarizer, 'invoke'):
            response = self.summarizer.invoke([{"role": "user", "content": prompt}])
            if hasattr(response, 'content'):
                return response.content
            return str(response)
        elif hasattr(self.summarizer, 'chat'):
            return self.summarizer.chat(prompt)
        else:
            # Fallback: simple truncation
            return f"[Summary of {len(messages)} messages: {conversation_text[:500]}...]"
    
    def _calculate_relevance(self, content: str, query: str) -> float:
        """
        Calculate relevance score between content and query.
        
        Simple implementation: word overlap ratio.
        """
        content_lower = content.lower()
        query_lower = query.lower()
        query_words = set(query_lower.split())
        
        if not query_words:
            return 1.0
        
        content_words = set(content_lower.split())
        overlap = len(query_words & content_words)
        
        return overlap / len(query_words)
    
    def _record_to_message_dict(self, record: MemoryRecord) -> Dict[str, Any]:
        """Convert MemoryRecord to message dictionary format."""
        role = record.metadata.get("role", "user")
        
        return {
            "role": role,
            "content": record.content,
            "metadata": record.metadata,
            "timestamp": record.created_at.isoformat() if record.created_at else None
        }
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get creator statistics."""
        return {
            "summarization_count": self.summarization_count,
            "total_tokens_saved": self.total_tokens_saved,
            "token_limit": self.token_limit,
            "summarization_threshold": self.summarization_threshold
        }
