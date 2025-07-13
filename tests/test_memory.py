"""
Test cases for the AgenticX memory system.
"""

import pytest
import asyncio
from datetime import datetime
from typing import Dict, Any

from agenticx.memory import (
    BaseMemory, 
    ShortTermMemory, 
    MCPMemory, 
    MemoryComponent, 
    KnowledgeBase,
    MemoryRecord,
    SearchResult,
    MemoryError
)


class TestShortTermMemory:
    """Test cases for ShortTermMemory."""
    
    @pytest.fixture
    async def memory(self):
        """Create a ShortTermMemory instance for testing."""
        return ShortTermMemory(tenant_id="test_tenant", max_records=100)
    
    async def test_add_and_get(self, memory):
        """Test adding and retrieving a memory record."""
        content = "This is a test memory"
        metadata = {"type": "test", "priority": "high"}
        
        record_id = await memory.add(content, metadata)
        assert record_id is not None
        
        retrieved_record = await memory.get(record_id)
        assert retrieved_record is not None
        assert retrieved_record.content == content
        assert retrieved_record.metadata["type"] == "test"
        assert retrieved_record.metadata["tenant_id"] == "test_tenant"
    
    async def test_search(self, memory):
        """Test searching for memory records."""
        # Add some test records
        await memory.add("Python programming tutorial", {"topic": "programming"})
        await memory.add("JavaScript basics guide", {"topic": "programming"})
        await memory.add("Cooking recipe for pasta", {"topic": "cooking"})
        
        # Search for programming content
        results = await memory.search("programming", limit=5)
        assert len(results) >= 2
        
        # Search with metadata filter
        results = await memory.search("guide", metadata_filter={"topic": "programming"})
        assert len(results) >= 1
        assert "JavaScript" in results[0].record.content
    
    async def test_update(self, memory):
        """Test updating a memory record."""
        record_id = await memory.add("Original content", {"status": "draft"})
        
        # Update content
        success = await memory.update(record_id, content="Updated content")
        assert success is True
        
        # Update metadata
        success = await memory.update(record_id, metadata={"status": "published"})
        assert success is True
        
        # Verify updates
        record = await memory.get(record_id)
        assert record.content == "Updated content"
        assert record.metadata["status"] == "published"
    
    async def test_delete(self, memory):
        """Test deleting a memory record."""
        record_id = await memory.add("To be deleted", {"temp": True})
        
        # Verify record exists
        record = await memory.get(record_id)
        assert record is not None
        
        # Delete record
        success = await memory.delete(record_id)
        assert success is True
        
        # Verify record is gone
        record = await memory.get(record_id)
        assert record is None
    
    async def test_list_all(self, memory):
        """Test listing all memory records."""
        # Add some test records
        await memory.add("Record 1", {"index": 1})
        await memory.add("Record 2", {"index": 2})
        await memory.add("Record 3", {"index": 3})
        
        # List all records
        records = await memory.list_all()
        assert len(records) >= 3
        
        # List with limit
        records = await memory.list_all(limit=2)
        assert len(records) == 2
        
        # List with metadata filter
        records = await memory.list_all(metadata_filter={"index": 2})
        assert len(records) == 1
        assert records[0].content == "Record 2"
    
    async def test_clear(self, memory):
        """Test clearing all memory records."""
        # Add some test records
        await memory.add("Record 1")
        await memory.add("Record 2")
        await memory.add("Record 3")
        
        # Clear all records
        count = await memory.clear()
        assert count == 3
        
        # Verify all records are gone
        records = await memory.list_all()
        assert len(records) == 0
    
    async def test_max_records_limit(self):
        """Test that max_records limit is enforced."""
        memory = ShortTermMemory(tenant_id="test", max_records=3)
        
        # Add records up to limit
        await memory.add("Record 1")
        await memory.add("Record 2")
        await memory.add("Record 3")
        
        # Add one more record (should trigger LRU eviction)
        await memory.add("Record 4")
        
        # Should still have 3 records
        records = await memory.list_all()
        assert len(records) == 3
        
        # The oldest record should be evicted
        all_contents = [r.content for r in records]
        assert "Record 1" not in all_contents
        assert "Record 4" in all_contents
    
    async def test_tenant_isolation(self):
        """Test that tenant isolation works correctly."""
        memory1 = ShortTermMemory(tenant_id="tenant1")
        memory2 = ShortTermMemory(tenant_id="tenant2")
        
        # Add records to different tenants
        id1 = await memory1.add("Tenant 1 record")
        id2 = await memory2.add("Tenant 2 record")
        
        # Each tenant should only see their own records
        record1 = await memory1.get(id1)
        record2 = await memory2.get(id2)
        
        assert record1 is not None
        assert record2 is not None
        assert record1.tenant_id == "tenant1"
        assert record2.tenant_id == "tenant2"


class TestMemoryComponent:
    """Test cases for MemoryComponent."""
    
    @pytest.fixture
    async def component(self):
        """Create a MemoryComponent for testing."""
        primary_memory = ShortTermMemory(tenant_id="test_tenant")
        return MemoryComponent(
            primary_memory=primary_memory,
            enable_history=True,
            auto_consolidate=False
        )
    
    async def test_add_intelligent(self, component):
        """Test intelligent memory addition."""
        content = "def hello_world():\n    print('Hello, World!')"
        metadata = {"source": "test"}
        
        record_id = await component.add_intelligent(
            content=content,
            metadata=metadata,
            enable_pipeline=True
        )
        
        assert record_id is not None
        
        # Verify the record was enhanced by the pipeline
        record = await component.primary_memory.get(record_id)
        assert record is not None
        assert record.metadata["content_type"] == "code"
        assert "python" in record.metadata.get("topics", [])
        assert "processed_at" in record.metadata
    
    async def test_search_across_memories(self, component):
        """Test searching across multiple memories."""
        # Add some test content
        await component.add_intelligent("Python programming guide", {"topic": "programming"})
        await component.add_intelligent("JavaScript tutorial", {"topic": "programming"})
        
        # Search across memories
        results = await component.search_across_memories("programming")
        assert len(results) >= 2
        
        # Verify results are sorted by relevance
        assert results[0].score >= results[1].score
    
    async def test_operation_history(self, component):
        """Test operation history tracking."""
        # Perform some operations
        await component.add_intelligent("Test content 1")
        await component.add_intelligent("Test content 2")
        await component.search_across_memories("test")
        
        # Check history
        history = await component.get_operation_history()
        assert len(history) >= 3
        
        # Check history filtering
        add_history = await component.get_operation_history(operation_type="add")
        search_history = await component.get_operation_history(operation_type="search")
        
        assert len(add_history) >= 2
        assert len(search_history) >= 1
    
    async def test_consolidate_memories(self, component):
        """Test memory consolidation."""
        # Add similar memories
        await component.add_intelligent("Python is a programming language")
        await component.add_intelligent("Python is used for programming")
        await component.add_intelligent("JavaScript is different from Python")
        
        # Consolidate memories
        consolidated_count = await component.consolidate_memories()
        
        # Should have consolidated some similar memories
        assert consolidated_count >= 0


class TestKnowledgeBase:
    """Test cases for KnowledgeBase."""
    
    @pytest.fixture
    async def kb(self):
        """Create a KnowledgeBase for testing."""
        memory_backend = ShortTermMemory(tenant_id="test_tenant")
        return KnowledgeBase(
            name="test_kb",
            memory_backend=memory_backend,
            read_only=False
        )
    
    async def test_add_and_search(self, kb):
        """Test adding and searching in knowledge base."""
        # Add some content
        await kb.add("Python programming basics", content_type="tutorial")
        await kb.add("Advanced Python concepts", content_type="tutorial")
        await kb.add("Python FAQ", content_type="faq")
        
        # Search all content
        results = await kb.search("Python")
        assert len(results) >= 3
        
        # Search with content type filter
        tutorial_results = await kb.search("Python", content_type="tutorial")
        assert len(tutorial_results) == 2
        
        faq_results = await kb.search("Python", content_type="faq")
        assert len(faq_results) == 1
    
    async def test_read_only_kb(self):
        """Test read-only knowledge base."""
        memory_backend = ShortTermMemory(tenant_id="test_tenant")
        kb = KnowledgeBase(
            name="readonly_kb",
            memory_backend=memory_backend,
            read_only=True
        )
        
        # Should not be able to add to read-only KB
        with pytest.raises(MemoryError):
            await kb.add("Test content")
    
    async def test_content_type_restrictions(self):
        """Test content type restrictions."""
        memory_backend = ShortTermMemory(tenant_id="test_tenant")
        kb = KnowledgeBase(
            name="restricted_kb",
            memory_backend=memory_backend,
            allowed_content_types={"tutorial", "guide"}
        )
        
        # Should allow permitted content types
        await kb.add("Test tutorial", content_type="tutorial")
        await kb.add("Test guide", content_type="guide")
        
        # Should reject non-permitted content types
        with pytest.raises(MemoryError):
            await kb.add("Test FAQ", content_type="faq")
    
    async def test_kb_stats(self, kb):
        """Test knowledge base statistics."""
        # Add some content
        await kb.add("Short content", content_type="note")
        await kb.add("This is a longer piece of content for testing", content_type="article")
        
        # Get stats
        stats = await kb.get_stats()
        
        assert stats["name"] == "test_kb"
        assert stats["total_records"] == 2
        assert stats["read_only"] is False
        assert "note" in stats["content_types"]
        assert "article" in stats["content_types"]
        assert stats["total_content_length"] > 0
        assert stats["avg_content_length"] > 0
    
    async def test_export_import(self, kb):
        """Test data export and import."""
        # Add some content
        await kb.add("Content 1", {"tag": "test"})
        await kb.add("Content 2", {"tag": "test"})
        
        # Export data
        exported_data = await kb.export_data()
        assert len(exported_data) == 2
        
        # Clear KB
        await kb.clear()
        
        # Import data
        import_stats = await kb.import_data(exported_data)
        assert import_stats["imported"] == 2
        assert import_stats["errors"] == 0
        
        # Verify data was imported
        records = await kb.list_all()
        assert len(records) == 2
    
    async def test_scoped_view(self, kb):
        """Test knowledge base scoped views."""
        # Add content with different types
        await kb.add("Tutorial content", content_type="tutorial")
        await kb.add("FAQ content", content_type="faq")
        await kb.add("Guide content", content_type="guide")
        
        # Create a scoped view for tutorials only
        tutorial_view = kb.create_scoped_view(
            name="tutorial_view",
            content_type_filter="tutorial"
        )
        
        # Search in the view
        results = await tutorial_view.search("content")
        assert len(results) == 1
        assert results[0].record.content == "Tutorial content"
        
        # List all in the view
        records = await tutorial_view.list_all()
        assert len(records) == 1
        
        # Get view stats
        stats = await tutorial_view.get_stats()
        assert stats["view_name"] == "tutorial_view"
        assert stats["total_records"] == 1
        assert stats["content_type_filter"] == "tutorial"


# Integration test example
class TestMemoryIntegration:
    """Integration tests for the memory system."""
    
    async def test_full_workflow(self):
        """Test a complete memory workflow."""
        # Create memory components
        primary_memory = ShortTermMemory(tenant_id="integration_test")
        memory_component = MemoryComponent(
            primary_memory=primary_memory,
            enable_history=True
        )
        
        # Create knowledge bases
        docs_kb = KnowledgeBase(
            name="documentation",
            memory_backend=primary_memory,
            allowed_content_types={"tutorial", "guide", "faq"}
        )
        
        code_kb = KnowledgeBase(
            name="code_examples",
            memory_backend=primary_memory,
            allowed_content_types={"code", "snippet"}
        )
        
        # Add content to different KBs
        await docs_kb.add(
            "How to use Python for data analysis",
            content_type="tutorial",
            metadata={"difficulty": "beginner"}
        )
        
        await code_kb.add(
            "import pandas as pd\ndf = pd.read_csv('data.csv')",
            content_type="code",
            metadata={"language": "python"}
        )
        
        # Use memory component for intelligent search
        results = await memory_component.search_across_memories("Python data")
        assert len(results) >= 2
        
        # Verify KB isolation
        doc_results = await docs_kb.search("Python")
        code_results = await code_kb.search("Python")
        
        assert len(doc_results) >= 1
        assert len(code_results) >= 1
        
        # Check that each KB only returns its own content
        for result in doc_results:
            assert result.record.metadata["knowledge_base"] == "documentation"
        
        for result in code_results:
            assert result.record.metadata["knowledge_base"] == "code_examples"
        
        # Get operation history
        history = await memory_component.get_operation_history()
        assert len(history) >= 1  # At least the search operation


if __name__ == "__main__":
    # Run tests
    asyncio.run(pytest.main([__file__, "-v"])) 