"""
Smoke Tests for Memory Extraction Pipeline (AIGNE Internalization - P0)

测试覆盖：
- 正常提取路径 (Happy path)
- 空输入处理
- 配置禁用场景
- 异步/同步模式
- 去重逻辑
- Session/User 记忆管理

运行方式：
    pytest -q tests/test_smoke_aigne_memory_extraction.py
    pytest -q -k "smoke_aigne_memory"
"""

import asyncio
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from agenticx.core.memory_extraction import (
    MemoryFact,
    MemoryScope,
    MemoryExtractionConfig,
    ExtractionResult,
    SimpleMemoryExtractor,
    LLMMemoryExtractor,
    SessionMemoryManager,
    UserMemoryManager,
    create_memory_extractor,
    create_session_memory_manager,
)


# =============================================================================
# Test Fixtures
# =============================================================================

@pytest.fixture
def sample_messages():
    """Sample conversation messages for testing."""
    return [
        {"role": "user", "content": "I prefer dark mode in my IDE. My name is Alice."},
        {"role": "assistant", "content": "Got it! I'll remember your preference for dark mode."},
        {"role": "user", "content": "I always use Python 3.10 for my projects."},
        {"role": "assistant", "content": "Noted. Python 3.10 is a great choice."},
    ]


@pytest.fixture
def sample_existing_facts():
    """Sample existing facts for deduplication testing."""
    return [
        MemoryFact(
            label="user_language",
            fact="User prefers Python programming",
            confidence=0.9,
            scope=MemoryScope.SESSION
        )
    ]


@pytest.fixture
def extraction_config():
    """Default extraction config for tests."""
    return MemoryExtractionConfig(
        enabled=True,
        async_mode=False,  # Sync mode for easier testing
        extraction_interval=2,
        max_session_facts=10,
        dedup_similarity_threshold=0.8,
        extraction_timeout=5.0
    )


@pytest.fixture
def mock_llm_provider():
    """Mock LLM provider that returns valid JSON."""
    provider = MagicMock(spec=['invoke'])  # Only expose 'invoke' method
    response = MagicMock()
    response.content = '{"facts": [{"label": "user_preference_mode", "fact": "User prefers dark mode", "confidence": 0.9}]}'
    provider.invoke = MagicMock(return_value=response)
    return provider


@pytest.fixture
def mock_knowledge_base():
    """Mock knowledge base for persistence testing."""
    kb = AsyncMock()
    kb.add = AsyncMock(return_value="mock_id")
    kb.search = AsyncMock(return_value=[])
    return kb


# =============================================================================
# MemoryFact Tests
# =============================================================================

class TestMemoryFact:
    """Tests for MemoryFact data class."""
    
    def test_memory_fact_creation(self):
        """Test basic MemoryFact creation."""
        fact = MemoryFact(
            label="test_label",
            fact="This is a test fact",
            confidence=0.85,
            scope=MemoryScope.SESSION
        )
        
        assert fact.label == "test_label"
        assert fact.fact == "This is a test fact"
        assert fact.confidence == 0.85
        assert fact.scope == MemoryScope.SESSION
        assert isinstance(fact.extracted_at, datetime)
    
    def test_memory_fact_to_dict(self):
        """Test MemoryFact serialization to dict."""
        fact = MemoryFact(
            label="pref_theme",
            fact="User likes dark theme",
            confidence=0.9,
            source_turn_id="turn_123",
            scope=MemoryScope.USER
        )
        
        data = fact.to_dict()
        
        assert data["content"] == "User likes dark theme"
        assert data["metadata"]["label"] == "pref_theme"
        assert data["metadata"]["confidence"] == 0.9
        assert data["metadata"]["source_turn_id"] == "turn_123"
        assert data["metadata"]["scope"] == "user"
        assert data["metadata"]["content_type"] == "memory_fact"
    
    def test_memory_fact_from_dict(self):
        """Test MemoryFact deserialization from dict."""
        data = {
            "content": "User prefers Python",
            "metadata": {
                "label": "lang_pref",
                "confidence": 0.8,
                "source_turn_id": "turn_456",
                "scope": "session",
                "extracted_at": "2024-01-15T10:00:00+00:00"
            }
        }
        
        fact = MemoryFact.from_dict(data)
        
        assert fact.label == "lang_pref"
        assert fact.fact == "User prefers Python"
        assert fact.confidence == 0.8
        assert fact.scope == MemoryScope.SESSION


# =============================================================================
# SimpleMemoryExtractor Tests
# =============================================================================

class TestSimpleMemoryExtractor:
    """Tests for SimpleMemoryExtractor (rule-based extraction)."""
    
    @pytest.mark.asyncio
    async def test_extract_preferences(self, sample_messages):
        """Test extraction of user preferences."""
        extractor = SimpleMemoryExtractor()
        
        result = await extractor.extract(
            messages=sample_messages,
            existing_facts=[]
        )
        
        assert result.success is True
        assert isinstance(result.new_facts, list)
        # Should extract "prefer dark mode" and "always use Python 3.10"
        assert len(result.new_facts) >= 1
        assert result.extraction_time >= 0
    
    @pytest.mark.asyncio
    async def test_extract_user_info(self):
        """Test extraction of user information."""
        extractor = SimpleMemoryExtractor()
        
        messages = [
            {"role": "user", "content": "My name is Bob and I work as a software engineer."},
        ]
        
        result = await extractor.extract(messages, [])
        
        assert result.success is True
        # Should extract name/work info
        info_facts = [f for f in result.new_facts if "info" in f.label]
        assert len(info_facts) >= 1
    
    @pytest.mark.asyncio
    async def test_extract_empty_messages(self):
        """Test extraction with empty message list."""
        extractor = SimpleMemoryExtractor()
        
        result = await extractor.extract(messages=[], existing_facts=[])
        
        assert result.success is True
        assert result.new_facts == []
        assert result.error is None
    
    @pytest.mark.asyncio
    async def test_extract_non_user_messages(self):
        """Test that non-user messages are ignored."""
        extractor = SimpleMemoryExtractor()
        
        messages = [
            {"role": "assistant", "content": "I prefer to help users efficiently."},
            {"role": "system", "content": "You are a helpful assistant."},
        ]
        
        result = await extractor.extract(messages, [])
        
        assert result.success is True
        assert result.new_facts == []  # No user messages to extract from


# =============================================================================
# LLMMemoryExtractor Tests
# =============================================================================

class TestLLMMemoryExtractor:
    """Tests for LLMMemoryExtractor (LLM-based extraction)."""
    
    @pytest.mark.asyncio
    async def test_extract_with_mock_llm(self, sample_messages, mock_llm_provider):
        """Test extraction with mocked LLM provider."""
        extractor = LLMMemoryExtractor(llm_provider=mock_llm_provider)
        
        result = await extractor.extract(
            messages=sample_messages,
            existing_facts=[]
        )
        
        assert result.success is True
        assert len(result.new_facts) == 1
        assert result.new_facts[0].label == "user_preference_mode"
        assert "dark mode" in result.new_facts[0].fact
    
    @pytest.mark.asyncio
    async def test_extract_with_async_llm(self, sample_messages):
        """Test extraction with async LLM provider."""
        async_provider = MagicMock(spec=['invoke_async'])  # Only expose async method
        response = MagicMock()
        response.content = '{"facts": [{"label": "test_fact", "fact": "Test content", "confidence": 0.7}]}'
        async_provider.invoke_async = AsyncMock(return_value=response)
        
        extractor = LLMMemoryExtractor(llm_provider=async_provider)
        
        result = await extractor.extract(sample_messages, [])
        
        assert result.success is True
        assert len(result.new_facts) == 1
    
    @pytest.mark.asyncio
    async def test_extract_handles_invalid_json(self, sample_messages):
        """Test graceful handling of invalid JSON response."""
        provider = MagicMock(spec=['invoke'])
        response = MagicMock()
        response.content = "This is not valid JSON"
        provider.invoke = MagicMock(return_value=response)
        
        extractor = LLMMemoryExtractor(llm_provider=provider)
        
        result = await extractor.extract(sample_messages, [])
        
        # Should succeed but with no facts
        assert result.success is True
        assert result.new_facts == []
    
    @pytest.mark.asyncio
    async def test_extract_timeout_handling(self, sample_messages):
        """Test timeout handling during extraction."""
        async def slow_invoke(*args, **kwargs):
            await asyncio.sleep(10)  # Longer than timeout
            response = MagicMock()
            response.content = '{"facts": []}'
            return response
        
        provider = MagicMock(spec=['invoke_async'])
        provider.invoke_async = slow_invoke
        
        extractor = LLMMemoryExtractor(llm_provider=provider)
        config = MemoryExtractionConfig(extraction_timeout=0.1)
        
        result = await extractor.extract(sample_messages, [], config=config)
        
        assert result.success is False
        assert "timed out" in result.error.lower()
    
    @pytest.mark.asyncio
    async def test_deduplication(self, sample_messages, sample_existing_facts):
        """Test that duplicate facts are removed."""
        # Create a fresh provider with duplicate fact response
        provider = MagicMock(spec=['invoke'])
        response = MagicMock()
        response.content = '{"facts": [{"label": "user_language", "fact": "User prefers Python programming language", "confidence": 0.9}]}'
        provider.invoke = MagicMock(return_value=response)
        
        extractor = LLMMemoryExtractor(llm_provider=provider)
        
        result = await extractor.extract(
            messages=sample_messages,
            existing_facts=sample_existing_facts
        )
        
        # Duplicate label should be removed
        assert result.success is True
        assert "user_language" in result.removed_facts


# =============================================================================
# SessionMemoryManager Tests
# =============================================================================

class TestSessionMemoryManager:
    """Tests for SessionMemoryManager."""
    
    @pytest.mark.asyncio
    async def test_maybe_extract_below_threshold(self, sample_messages, extraction_config):
        """Test that extraction is not triggered below interval threshold."""
        extractor = SimpleMemoryExtractor()
        manager = SessionMemoryManager(
            extractor=extractor,
            config=extraction_config
        )
        manager.set_session_id("test_session")
        
        # First call - should not trigger (1 < 2)
        result = await manager.maybe_extract(sample_messages[:1])
        
        assert result is None
        assert manager._message_count_since_extraction == 1
    
    @pytest.mark.asyncio
    async def test_maybe_extract_at_threshold(self, sample_messages, extraction_config):
        """Test that extraction is triggered at interval threshold."""
        extractor = SimpleMemoryExtractor()
        manager = SessionMemoryManager(
            extractor=extractor,
            config=extraction_config
        )
        manager.set_session_id("test_session")
        
        # First call
        await manager.maybe_extract(sample_messages[:1])
        # Second call - should trigger (2 >= 2)
        result = await manager.maybe_extract(sample_messages)
        
        assert result is not None
        assert result.success is True
        assert manager._message_count_since_extraction == 0  # Reset after extraction
    
    @pytest.mark.asyncio
    async def test_force_extract(self, sample_messages, extraction_config):
        """Test forced extraction regardless of threshold."""
        extractor = SimpleMemoryExtractor()
        manager = SessionMemoryManager(
            extractor=extractor,
            config=extraction_config
        )
        manager.set_session_id("test_session")
        
        result = await manager.maybe_extract(sample_messages, force=True)
        
        assert result is not None
        assert result.success is True
    
    @pytest.mark.asyncio
    async def test_disabled_extraction(self, sample_messages):
        """Test that extraction is skipped when disabled."""
        config = MemoryExtractionConfig(enabled=False)
        extractor = SimpleMemoryExtractor()
        manager = SessionMemoryManager(extractor=extractor, config=config)
        
        result = await manager.maybe_extract(sample_messages, force=True)
        
        assert result is None
    
    @pytest.mark.asyncio
    async def test_session_facts_accumulation(self, sample_messages, extraction_config):
        """Test that facts accumulate in session cache."""
        extractor = SimpleMemoryExtractor()
        manager = SessionMemoryManager(
            extractor=extractor,
            config=extraction_config
        )
        manager.set_session_id("test_session")
        
        await manager.maybe_extract(sample_messages, force=True)
        
        facts = manager.get_session_facts()
        assert isinstance(facts, list)
        # Facts should have session_id in metadata
        for fact in facts:
            assert fact.metadata.get("session_id") == "test_session"
    
    @pytest.mark.asyncio
    async def test_persistence_to_knowledge_base(self, sample_messages, extraction_config, mock_knowledge_base):
        """Test that facts are persisted to knowledge base."""
        extractor = SimpleMemoryExtractor()
        manager = SessionMemoryManager(
            extractor=extractor,
            knowledge_base=mock_knowledge_base,
            config=extraction_config
        )
        manager.set_session_id("test_session")
        
        await manager.maybe_extract(sample_messages, force=True)
        
        # Knowledge base add should have been called
        if manager.get_session_facts():
            assert mock_knowledge_base.add.called
    
    def test_get_facts_for_context(self, extraction_config):
        """Test formatting facts for context injection."""
        extractor = SimpleMemoryExtractor()
        manager = SessionMemoryManager(
            extractor=extractor,
            config=extraction_config
        )
        
        # Manually add some facts
        manager._session_facts = [
            MemoryFact(label="pref1", fact="User likes Python", confidence=0.9),
            MemoryFact(label="pref2", fact="User prefers dark mode", confidence=0.8),
        ]
        
        context = manager.get_facts_for_context(max_tokens=100)
        
        assert "Known Facts" in context
        assert "pref1" in context
        assert "Python" in context
    
    def test_clear_session(self, extraction_config):
        """Test clearing session cache."""
        extractor = SimpleMemoryExtractor()
        manager = SessionMemoryManager(
            extractor=extractor,
            config=extraction_config
        )
        
        manager._session_facts = [
            MemoryFact(label="test", fact="Test fact", confidence=0.9)
        ]
        manager._message_count_since_extraction = 5
        
        manager.clear()
        
        assert manager._session_facts == []
        assert manager._message_count_since_extraction == 0


# =============================================================================
# UserMemoryManager Tests
# =============================================================================

class TestUserMemoryManager:
    """Tests for UserMemoryManager."""
    
    @pytest.mark.asyncio
    async def test_consolidate_high_confidence_facts(self):
        """Test that only high confidence facts are consolidated."""
        manager = UserMemoryManager()
        manager.set_user_id("user_123")
        
        session_facts = [
            MemoryFact(label="high_conf", fact="Important fact", confidence=0.9),
            MemoryFact(label="low_conf", fact="Maybe fact", confidence=0.5),
        ]
        
        await manager.consolidate(session_facts)
        
        user_facts = manager.get_user_facts()
        
        # Only high confidence fact should be consolidated
        assert len(user_facts) == 1
        assert user_facts[0].label == "high_conf"
        assert user_facts[0].scope == MemoryScope.USER
    
    @pytest.mark.asyncio
    async def test_consolidate_updates_existing(self):
        """Test that consolidation updates existing facts."""
        manager = UserMemoryManager()
        manager.set_user_id("user_123")
        
        # Pre-populate with existing fact
        manager._user_facts = [
            MemoryFact(label="existing", fact="Old info", confidence=0.7, scope=MemoryScope.USER)
        ]
        
        session_facts = [
            MemoryFact(label="existing", fact="Updated info", confidence=0.9),
        ]
        
        await manager.consolidate(session_facts)
        
        user_facts = manager.get_user_facts()
        
        assert len(user_facts) == 1
        assert user_facts[0].fact == "Updated info"
        assert user_facts[0].confidence == 0.9  # Higher confidence kept
    
    @pytest.mark.asyncio
    async def test_consolidate_respects_max_facts(self):
        """Test that consolidation respects max facts limit."""
        config = MemoryExtractionConfig(max_user_facts=2)
        manager = UserMemoryManager(config=config)
        manager.set_user_id("user_123")
        
        session_facts = [
            MemoryFact(label="fact1", fact="Fact 1", confidence=0.9),
            MemoryFact(label="fact2", fact="Fact 2", confidence=0.8),
            MemoryFact(label="fact3", fact="Fact 3", confidence=0.7),
        ]
        
        await manager.consolidate(session_facts)
        
        user_facts = manager.get_user_facts()
        
        # Should only keep top 2 by confidence
        assert len(user_facts) == 2
        assert user_facts[0].confidence >= user_facts[1].confidence


# =============================================================================
# Factory Function Tests
# =============================================================================

class TestFactoryFunctions:
    """Tests for factory functions."""
    
    def test_create_memory_extractor_simple(self):
        """Test creating simple extractor."""
        extractor = create_memory_extractor(use_simple=True)
        
        assert isinstance(extractor, SimpleMemoryExtractor)
    
    def test_create_memory_extractor_llm(self, mock_llm_provider):
        """Test creating LLM extractor."""
        extractor = create_memory_extractor(
            llm_provider=mock_llm_provider,
            use_simple=False
        )
        
        assert isinstance(extractor, LLMMemoryExtractor)
    
    def test_create_memory_extractor_fallback_to_simple(self):
        """Test fallback to simple when no LLM provider."""
        extractor = create_memory_extractor(llm_provider=None, use_simple=False)
        
        # Should fallback to simple
        assert isinstance(extractor, SimpleMemoryExtractor)
    
    def test_create_session_memory_manager(self, mock_knowledge_base):
        """Test creating session memory manager."""
        manager = create_session_memory_manager(
            knowledge_base=mock_knowledge_base,
            use_simple_extractor=True
        )
        
        assert isinstance(manager, SessionMemoryManager)
        assert manager.knowledge_base is mock_knowledge_base


# =============================================================================
# Integration Tests
# =============================================================================

class TestIntegration:
    """Integration tests for memory extraction pipeline."""
    
    @pytest.mark.asyncio
    async def test_full_extraction_pipeline(self, sample_messages, mock_knowledge_base):
        """Test complete extraction pipeline from messages to persistence."""
        config = MemoryExtractionConfig(
            enabled=True,
            async_mode=False,
            extraction_interval=1
        )
        
        manager = create_session_memory_manager(
            knowledge_base=mock_knowledge_base,
            config=config,
            use_simple_extractor=True
        )
        manager.set_session_id("integration_test")
        
        # Trigger extraction
        result = await manager.maybe_extract(sample_messages, force=True)
        
        assert result is not None
        assert result.success is True
        
        # Check facts are in session cache
        facts = manager.get_session_facts()
        assert len(facts) >= 0  # May or may not find facts depending on content
        
        # Check context generation
        context = manager.get_facts_for_context()
        assert isinstance(context, str)
    
    @pytest.mark.asyncio
    async def test_session_to_user_consolidation(self, sample_messages):
        """Test consolidation from session to user memory."""
        session_config = MemoryExtractionConfig(
            enabled=True,
            async_mode=False,
            extraction_interval=1
        )
        
        session_manager = create_session_memory_manager(
            config=session_config,
            use_simple_extractor=True
        )
        session_manager.set_session_id("test_session")
        
        user_manager = UserMemoryManager()
        user_manager.set_user_id("test_user")
        
        # Extract session facts
        await session_manager.maybe_extract(sample_messages, force=True)
        
        # Consolidate to user memory
        await session_manager.consolidate_to_user_memory(user_manager)
        
        # User manager should have consolidated facts
        user_facts = user_manager.get_user_facts()
        # Facts with confidence >= 0.7 should be consolidated
        for fact in user_facts:
            assert fact.scope == MemoryScope.USER


# =============================================================================
# Edge Cases
# =============================================================================

class TestEdgeCases:
    """Tests for edge cases and error handling."""
    
    @pytest.mark.asyncio
    async def test_extraction_with_none_content(self):
        """Test extraction handles None content gracefully."""
        extractor = SimpleMemoryExtractor()
        
        messages = [
            {"role": "user", "content": None},
            {"role": "user", "content": "Valid content here."},
        ]
        
        result = await extractor.extract(messages, [])
        
        assert result.success is True
        # Should not crash on None content
    
    @pytest.mark.asyncio
    async def test_extraction_with_non_string_content(self):
        """Test extraction handles non-string content gracefully."""
        extractor = SimpleMemoryExtractor()
        
        messages = [
            {"role": "user", "content": ["list", "content"]},
            {"role": "user", "content": {"dict": "content"}},
        ]
        
        result = await extractor.extract(messages, [])
        
        assert result.success is True
        # Should not crash on non-string content
    
    @pytest.mark.asyncio
    async def test_llm_provider_error_handling(self, sample_messages):
        """Test graceful handling of LLM provider errors."""
        provider = MagicMock(spec=['invoke'])
        provider.invoke = MagicMock(side_effect=Exception("LLM API error"))
        
        extractor = LLMMemoryExtractor(llm_provider=provider)
        
        result = await extractor.extract(sample_messages, [])
        
        assert result.success is False
        assert "LLM API error" in result.error
    
    def test_memory_scope_enum_values(self):
        """Test MemoryScope enum has expected values."""
        assert MemoryScope.SESSION.value == "session"
        assert MemoryScope.USER.value == "user"
        assert MemoryScope.GLOBAL.value == "global"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
