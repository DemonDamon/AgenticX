"""
Test suite for hierarchical memory system components.

Tests the core functionality of the six-layer bionic memory architecture
including memory layers, search engine, and decay service.
"""

import pytest
import pytest_asyncio
import asyncio
from datetime import datetime, timedelta, UTC
from typing import List, Dict, Any

from agenticx.memory import (
    # Hierarchical components
    HierarchicalMemoryManager,
    MemoryType,
    MemoryImportance,
    MemorySensitivity,
    SearchContext,
    
    # Memory layers
    CoreMemory,
    EpisodicMemory,
    Episode,
    EpisodeEvent,
    SemanticMemory,
    Concept,
    KnowledgeTriple,
    
    # Search engine
    HybridSearchEngine,
    BM25SearchBackend,
    VectorSearchBackend,
    HybridRanker,
    SearchQuery,
    
    # Decay service
    MemoryDecayService,
    DecayStrategy,
    DecayParameters
)


class TestHierarchicalMemoryManager:
    """Test the hierarchical memory manager."""
    
    @pytest_asyncio.fixture
    async def memory_manager(self):
        """Create a memory manager with registered layers."""
        manager = HierarchicalMemoryManager(tenant_id="test_tenant")
        
        # Register memory layers
        core_memory = CoreMemory(tenant_id="test_tenant", agent_id="test_agent")
        episodic_memory = EpisodicMemory(tenant_id="test_tenant", agent_id="test_agent")
        semantic_memory = SemanticMemory(tenant_id="test_tenant", agent_id="test_agent")
        
        manager.register_layer(MemoryType.CORE, core_memory)
        manager.register_layer(MemoryType.EPISODIC, episodic_memory)
        manager.register_layer(MemoryType.SEMANTIC, semantic_memory)
        
        return manager
    
    @pytest.mark.asyncio
    async def test_memory_layer_registration(self, memory_manager):
        """Test memory layer registration and retrieval."""
        # Test layer retrieval
        core_layer = memory_manager.get_layer(MemoryType.CORE)
        assert core_layer is not None
        assert core_layer.memory_type == MemoryType.CORE
        
        episodic_layer = memory_manager.get_layer(MemoryType.EPISODIC)
        assert episodic_layer is not None
        assert episodic_layer.memory_type == MemoryType.EPISODIC
        
        semantic_layer = memory_manager.get_layer(MemoryType.SEMANTIC)
        assert semantic_layer is not None
        assert semantic_layer.memory_type == MemoryType.SEMANTIC
        
        # Test non-existent layer
        procedural_layer = memory_manager.get_layer(MemoryType.PROCEDURAL)
        assert procedural_layer is None
    
    @pytest.mark.asyncio
    async def test_add_memory_to_layers(self, memory_manager):
        """Test adding memory to different layers."""
        # Add to core memory
        core_record_id = await memory_manager.add_memory(
            content="Agent identity: Research Assistant",
            memory_type=MemoryType.CORE,
            importance=MemoryImportance.CRITICAL
        )
        assert core_record_id is not None
        
        # Add to episodic memory
        episodic_record_id = await memory_manager.add_memory(
            content="User asked about climate change",
            memory_type=MemoryType.EPISODIC,
            importance=MemoryImportance.MEDIUM
        )
        assert episodic_record_id is not None
        
        # Add to semantic memory
        semantic_record_id = await memory_manager.add_memory(
            content="Climate change is caused by greenhouse gases",
            memory_type=MemoryType.SEMANTIC,
            importance=MemoryImportance.HIGH
        )
        assert semantic_record_id is not None
    
    @pytest.mark.asyncio
    async def test_search_all_layers(self, memory_manager):
        """Test searching across all memory layers."""
        # Add test data
        await memory_manager.add_memory(
            content="Agent specializes in climate research",
            memory_type=MemoryType.CORE
        )
        await memory_manager.add_memory(
            content="Discussion about global warming effects",
            memory_type=MemoryType.EPISODIC
        )
        await memory_manager.add_memory(
            content="Global warming causes sea level rise",
            memory_type=MemoryType.SEMANTIC
        )
        
        # Search all layers
        results = await memory_manager.search_all_layers(
            query="global warming",
            query_type="default",
            limit=10
        )
        
        assert len(results) > 0
        assert any("global warming" in result.record.content.lower() for result in results)
    
    @pytest.mark.asyncio
    async def test_memory_stats(self, memory_manager):
        """Test memory statistics collection."""
        # Add some test data
        await memory_manager.add_memory("Core info", MemoryType.CORE)
        await memory_manager.add_memory("Event 1", MemoryType.EPISODIC)
        await memory_manager.add_memory("Event 2", MemoryType.EPISODIC)
        await memory_manager.add_memory("Fact 1", MemoryType.SEMANTIC)
        
        # Get stats
        stats = await memory_manager.get_memory_stats()
        
        assert "core" in stats
        assert "episodic" in stats
        assert "semantic" in stats
        
        assert stats["core"]["total_records"] == 2  # 1 added record + 1 auto-created agent profile
        assert stats["episodic"]["total_records"] == 2
        assert stats["semantic"]["total_records"] == 1


class TestCoreMemory:
    """Test the core memory layer."""
    
    @pytest_asyncio.fixture
    async def core_memory(self):
        """Create a core memory instance."""
        memory = CoreMemory(tenant_id="test_tenant", agent_id="test_agent")
        await memory._ensure_initialized()
        return memory
    
    @pytest.mark.asyncio
    async def test_agent_identity_management(self, core_memory):
        """Test agent identity management."""
        # Set agent identity
        identity_id = await core_memory.set_agent_identity(
            name="Research Assistant",
            role="AI Researcher",
            description="Specializes in climate science research",
            personality={"curious": True, "analytical": True},
            capabilities=["research", "analysis", "writing"]
        )
        
        assert identity_id is not None
        
        # Retrieve agent identity
        identity = await core_memory.get_agent_identity()
        assert identity is not None
        assert identity["name"] == "Research Assistant"
        assert identity["role"] == "AI Researcher"
        assert identity["personality"]["curious"] is True
        assert "research" in identity["capabilities"]
        
        # Update identity
        updated_id = await core_memory.set_agent_identity(
            name="Research Assistant",
            role="Senior AI Researcher",
            description="Expert in climate science and environmental research",
            personality={"curious": True, "analytical": True, "experienced": True},
            capabilities=["research", "analysis", "writing", "mentoring"]
        )
        
        # Should update existing identity
        assert updated_id == identity_id
        
        # Verify update
        updated_identity = await core_memory.get_agent_identity()
        assert updated_identity["role"] == "Senior AI Researcher"
        assert updated_identity["personality"]["experienced"] is True
        assert "mentoring" in updated_identity["capabilities"]
    
    @pytest.mark.asyncio
    async def test_persistent_context_management(self, core_memory):
        """Test persistent context management."""
        # Set context
        context_id = await core_memory.set_persistent_context(
            key="research_focus",
            value="climate change impacts",
            description="Current research focus area"
        )
        
        assert context_id is not None
        
        # Retrieve context
        context_value = await core_memory.get_persistent_context("research_focus")
        assert context_value == "climate change impacts"
        
        # Update context
        updated_id = await core_memory.set_persistent_context(
            key="research_focus",
            value="renewable energy solutions",
            description="Updated research focus area"
        )
        
        # Should update existing context
        assert updated_id == context_id
        
        # Verify update
        updated_value = await core_memory.get_persistent_context("research_focus")
        assert updated_value == "renewable energy solutions"
        
        # Get all context
        all_context = await core_memory.get_all_context()
        assert "research_focus" in all_context
        assert all_context["research_focus"] == "renewable energy solutions"
    
    @pytest.mark.asyncio
    async def test_agent_state_tracking(self, core_memory):
        """Test agent state tracking."""
        # Update agent state
        state_id = await core_memory.update_agent_state(
            state_data={"mood": "focused", "energy": 80, "last_task": "research"},
            description="Agent is focused on research task"
        )
        
        assert state_id is not None
        
                # Add more states with small delays to ensure different timestamps
        await asyncio.sleep(0.01)
        await core_memory.update_agent_state(
            state_data={"mood": "curious", "energy": 75, "last_task": "analysis"},
            description="Agent is analyzing research findings"
        )

        await asyncio.sleep(0.01)
        await core_memory.update_agent_state(
            state_data={"mood": "satisfied", "energy": 85, "last_task": "writing"},
            description="Agent completed writing task"
        )
        
        # Get recent states
        recent_states = await core_memory.get_recent_states(limit=3)
        assert len(recent_states) == 3
        
        # States should be in reverse chronological order
        assert recent_states[0]["state_data"]["last_task"] == "writing"
        assert recent_states[1]["state_data"]["last_task"] == "analysis"
        assert recent_states[2]["state_data"]["last_task"] == "research"
    
    @pytest.mark.asyncio
    async def test_core_memory_search(self, core_memory):
        """Test core memory search functionality."""
        # Add test data
        await core_memory.add(
            content="Agent specializes in climate research",
            importance=MemoryImportance.HIGH
        )
        await core_memory.add(
            content="Research methodology focuses on data analysis",
            importance=MemoryImportance.MEDIUM
        )
        await core_memory.add(
            content="Agent has published papers on renewable energy",
            importance=MemoryImportance.HIGH
        )
        
        # Search for research-related content
        results = await core_memory.search("research", limit=5)
        assert len(results) > 0
        assert all("research" in result.record.content.lower() for result in results)
        
        # Search with metadata filter
        results = await core_memory.search(
            "climate",
            metadata_filter={"importance": MemoryImportance.HIGH.value}
        )
        assert len(results) > 0
        for result in results:
            assert result.record.importance == MemoryImportance.HIGH


class TestEpisodicMemory:
    """Test the episodic memory layer."""
    
    @pytest_asyncio.fixture
    async def episodic_memory(self):
        """Create an episodic memory instance."""
        return EpisodicMemory(tenant_id="test_tenant", agent_id="test_agent")
    
    @pytest.mark.asyncio
    async def test_event_addition(self, episodic_memory):
        """Test adding events to episodic memory."""
        timestamp = datetime.now(UTC)
        
        # Add event
        event_id = await episodic_memory.add_event(
            event_type="conversation",
            content="User asked about climate change",
            timestamp=timestamp,
            metadata={"user_id": "user123", "topic": "climate"},
            importance=MemoryImportance.HIGH
        )
        
        assert event_id is not None
        
        # Verify event was added
        results = await episodic_memory.search("climate change")
        assert len(results) > 0
        assert results[0].record.metadata["event_type"] == "conversation"
    
    @pytest.mark.asyncio
    async def test_episode_management(self, episodic_memory):
        """Test episode creation and management."""
        # Create episode
        episode_id = await episodic_memory.create_episode(
            title="Climate Change Research Session",
            tags=["research", "climate", "environment"],
            importance=MemoryImportance.HIGH
        )
        
        assert episode_id is not None
        
        # Get episode
        episode = await episodic_memory.get_episode(episode_id)
        assert episode is not None
        assert episode.title == "Climate Change Research Session"
        assert "research" in episode.tags
        
        # Add events to episode
        await episodic_memory.add_event(
            event_type="question",
            content="What are the main causes of climate change?",
            episode_id=episode_id
        )
        
        await episodic_memory.add_event(
            event_type="answer",
            content="Primary causes include greenhouse gas emissions...",
            episode_id=episode_id
        )
        
        # Verify events were added to episode
        updated_episode = await episodic_memory.get_episode(episode_id)
        assert len(updated_episode.events) == 2
        assert updated_episode.events[0].event_type == "question"
        assert updated_episode.events[1].event_type == "answer"
    
    @pytest.mark.asyncio
    async def test_temporal_search(self, episodic_memory):
        """Test temporal search functionality."""
        base_time = datetime.now(UTC)
        
        # Add events at different times
        await episodic_memory.add_event(
            event_type="task",
            content="Started research on renewable energy",
            timestamp=base_time - timedelta(hours=2)
        )
        
        await episodic_memory.add_event(
            event_type="task",
            content="Completed analysis of solar panel efficiency",
            timestamp=base_time - timedelta(hours=1)
        )
        
        await episodic_memory.add_event(
            event_type="task",
            content="Wrote summary of wind energy research",
            timestamp=base_time
        )
        
        # Search by event type
        task_events = await episodic_memory.search_events_by_type("task")
        assert len(task_events) == 3
        
        # Search with time range
        recent_events = await episodic_memory.search_events_by_type(
            "task",
            time_range=(base_time - timedelta(minutes=90), base_time)
        )
        assert len(recent_events) == 2
        
        # Get timeline
        timeline = await episodic_memory.get_timeline(
            start_time=base_time - timedelta(hours=3),
            end_time=base_time
        )
        assert len(timeline) == 3
        
        # Timeline should be chronological
        assert timeline[0].timestamp < timeline[1].timestamp < timeline[2].timestamp
    
    @pytest.mark.asyncio
    async def test_episode_auto_grouping(self, episodic_memory):
        """Test automatic episode grouping."""
        base_time = datetime.now(UTC)
        
        # Add events close in time (should group into same episode)
        await episodic_memory.add_event(
            event_type="conversation",
            content="User asked about solar energy",
            timestamp=base_time
        )
        
        await episodic_memory.add_event(
            event_type="response",
            content="Solar energy is renewable and clean",
            timestamp=base_time + timedelta(minutes=1)
        )
        
        # Add event far in time (should create new episode)
        await episodic_memory.add_event(
            event_type="conversation",
            content="User asked about wind energy",
            timestamp=base_time + timedelta(hours=3)
        )
        
        # Check episodes
        episodes = await episodic_memory.get_recent_episodes()
        assert len(episodes) >= 2
        
        # First episode should have 2 events
        first_episode = episodes[0]
        assert len(first_episode.events) == 2
        
        # Second episode should have 1 event
        second_episode = episodes[1]
        assert len(second_episode.events) == 1


class TestSemanticMemory:
    """Test the semantic memory layer."""
    
    @pytest_asyncio.fixture
    async def semantic_memory(self):
        """Create a semantic memory instance."""
        return SemanticMemory(tenant_id="test_tenant", agent_id="test_agent")
    
    @pytest.mark.asyncio
    async def test_knowledge_addition(self, semantic_memory):
        """Test adding knowledge to semantic memory."""
        # Add knowledge
        record_id = await semantic_memory.add_knowledge(
            content="Photosynthesis is the process by which plants convert sunlight into energy",
            knowledge_type="fact",
            category="biology",
            concepts=["photosynthesis", "plants", "sunlight", "energy"],
            importance=MemoryImportance.HIGH
        )
        
        assert record_id is not None
        
        # Verify knowledge was added
        results = await semantic_memory.search("photosynthesis")
        assert len(results) > 0
        
        # Find the knowledge record (not concept record)
        knowledge_record = None
        for result in results:
            if result.record.metadata.get("type") == "semantic_knowledge":
                knowledge_record = result
                break
        
        assert knowledge_record is not None
        assert knowledge_record.record.metadata["knowledge_type"] == "fact"
        assert knowledge_record.record.metadata["category"] == "biology"
        assert "photosynthesis" in knowledge_record.record.metadata["concepts"]
    
    @pytest.mark.asyncio
    async def test_concept_management(self, semantic_memory):
        """Test concept creation and management."""
        # Add concept
        concept_id = await semantic_memory.add_concept(
            name="Climate Change",
            description="Long-term shifts in global temperatures and weather patterns",
            category="environment",
            attributes={"severity": "high", "timeframe": "long-term"},
            synonyms=["global warming", "climate crisis"]
        )
        
        assert concept_id is not None
        
        # Retrieve concept
        concept = await semantic_memory.get_concept("Climate Change")
        assert concept is not None
        assert concept.name == "Climate Change"
        assert concept.category == "environment"
        assert "global warming" in concept.synonyms
        assert concept.attributes["severity"] == "high"
        
        # Search concepts
        search_results = await semantic_memory.search_concepts("climate")
        assert len(search_results) > 0
        assert search_results[0][0].name == "Climate Change"
    
    @pytest.mark.asyncio
    async def test_concept_relationships(self, semantic_memory):
        """Test concept relationships."""
        # Add related concepts
        await semantic_memory.add_concept(
            name="Greenhouse Gases",
            description="Gases that trap heat in Earth's atmosphere",
            category="environment"
        )
        
        await semantic_memory.add_concept(
            name="Carbon Dioxide",
            description="A greenhouse gas produced by burning fossil fuels",
            category="chemistry"
        )
        
        await semantic_memory.add_concept(
            name="Climate Change",
            description="Long-term shifts in global temperatures and weather patterns",
            category="environment"
        )
        
        # Add relationships
        success = await semantic_memory.add_relationship(
            subject_concept="Carbon Dioxide",
            relationship_type="is_a",
            object_concept="Greenhouse Gases"
        )
        assert success is True
        
        success = await semantic_memory.add_relationship(
            subject_concept="Greenhouse Gases",
            relationship_type="causes",
            object_concept="Climate Change"
        )
        assert success is True
        
        # Get related concepts
        related_concepts = await semantic_memory.get_related_concepts(
            "Carbon Dioxide",
            relationship_types=["is_a"]
        )
        assert len(related_concepts) > 0
        assert related_concepts[0][0].name == "Greenhouse Gases"
        assert related_concepts[0][1] == "is_a"
    
    @pytest.mark.asyncio
    async def test_concept_search(self, semantic_memory):
        """Test concept search functionality."""
        # Add concepts
        await semantic_memory.add_concept(
            name="Solar Energy",
            description="Energy from the sun",
            category="renewable_energy"
        )
        
        await semantic_memory.add_concept(
            name="Wind Energy",
            description="Energy from wind",
            category="renewable_energy"
        )
        
        await semantic_memory.add_concept(
            name="Fossil Fuels",
            description="Non-renewable energy sources",
            category="traditional_energy"
        )
        
        # Search by category
        renewable_concepts = await semantic_memory.get_concepts_by_category("renewable_energy")
        assert len(renewable_concepts) == 2
        
        # Search concepts
        energy_concepts = await semantic_memory.search_concepts("energy")
        assert len(energy_concepts) >= 3
        
        # Category-filtered search
        renewable_search = await semantic_memory.search_concepts("energy", category="renewable_energy")
        assert len(renewable_search) == 2


class TestHybridSearchEngine:
    """Test the hybrid search engine."""
    
    @pytest.fixture
    def search_engine(self):
        """Create a hybrid search engine."""
        return HybridSearchEngine()
    
    @pytest_asyncio.fixture
    async def populated_engine(self, search_engine):
        """Create a search engine with test data."""
        from agenticx.memory.hierarchical import HierarchicalMemoryRecord
        
        # Create test records
        records = [
            HierarchicalMemoryRecord(
                id="1",
                content="Climate change is a global environmental challenge",
                metadata={"category": "environment", "importance": 3},
                tenant_id="test",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
                memory_type=MemoryType.SEMANTIC,
                importance=MemoryImportance.HIGH
            ),
            HierarchicalMemoryRecord(
                id="2",
                content="Solar energy is a renewable energy source",
                metadata={"category": "energy", "importance": 2},
                tenant_id="test",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
                memory_type=MemoryType.SEMANTIC,
                importance=MemoryImportance.MEDIUM
            ),
            HierarchicalMemoryRecord(
                id="3",
                content="User asked about sustainable development",
                metadata={"category": "conversation", "importance": 1},
                tenant_id="test",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
                memory_type=MemoryType.EPISODIC,
                importance=MemoryImportance.LOW
            )
        ]
        
        # Index records
        for record in records:
            await search_engine.index_record(record)
        
        return search_engine
    
    @pytest.mark.asyncio
    async def test_bm25_search(self, populated_engine):
        """Test BM25 search functionality."""
        query = SearchQuery(text="climate change", query_type="bm25")
        
        results = await populated_engine.search(query, limit=5)
        assert len(results) > 0
        
        # Results should be ranked by BM25 score
        assert results[0].record.content == "Climate change is a global environmental challenge"
        assert results[0].score > 0
    
    @pytest.mark.asyncio
    async def test_vector_search(self, populated_engine):
        """Test vector search functionality."""
        query = SearchQuery(text="renewable energy", query_type="vector")
        
        results = await populated_engine.search(query, limit=5)
        assert len(results) > 0
        assert results[0].score > 0
    
    @pytest.mark.asyncio
    async def test_hybrid_search(self, populated_engine):
        """Test hybrid search functionality."""
        query = SearchQuery(text="sustainable energy", query_type="hybrid")
        
        results = await populated_engine.search(query, limit=5)
        assert len(results) > 0
        assert results[0].score > 0
    
    @pytest.mark.asyncio
    async def test_search_filters(self, populated_engine):
        """Test search with filters."""
        query = SearchQuery(
            text="energy",
            query_type="hybrid",
            filters={"category": "energy"}
        )
        
        results = await populated_engine.search(query, limit=5)
        assert len(results) > 0
        assert all(result.record.metadata.get("category") == "energy" for result in results)
    
    @pytest.mark.asyncio
    async def test_search_engine_stats(self, populated_engine):
        """Test search engine statistics."""
        stats = await populated_engine.get_stats()
        
        assert stats["engine_type"] == "Hybrid"
        assert "bm25_backend" in stats
        assert "vector_backend" in stats
        assert "ranker_weights" in stats
        
        assert stats["bm25_backend"]["total_documents"] == 3
        assert stats["vector_backend"]["total_documents"] == 3


class TestMemoryDecayService:
    """Test the memory decay service."""
    
    @pytest.fixture
    def decay_service(self):
        """Create a memory decay service."""
        return MemoryDecayService(tenant_id="test_tenant")
    
    @pytest.fixture
    def test_records(self):
        """Create test memory records."""
        from agenticx.memory.hierarchical import HierarchicalMemoryRecord
        
        base_time = datetime.now(UTC)
        
        records = [
            HierarchicalMemoryRecord(
                id="1",
                content="Recent important information",
                metadata={"category": "core"},
                tenant_id="test",
                created_at=base_time - timedelta(hours=1),
                updated_at=base_time - timedelta(hours=1),
                memory_type=MemoryType.CORE,
                importance=MemoryImportance.CRITICAL,
                access_count=10,
                last_accessed=base_time - timedelta(minutes=30)
            ),
            HierarchicalMemoryRecord(
                id="2",
                content="Old unused information",
                metadata={"category": "episodic"},
                tenant_id="test",
                created_at=base_time - timedelta(days=30),
                updated_at=base_time - timedelta(days=30),
                memory_type=MemoryType.EPISODIC,
                importance=MemoryImportance.LOW,
                access_count=0,
                last_accessed=base_time - timedelta(days=30),
                decay_factor=0.5
            ),
            HierarchicalMemoryRecord(
                id="3",
                content="Moderately used information",
                metadata={"category": "semantic"},
                tenant_id="test",
                created_at=base_time - timedelta(days=10),
                updated_at=base_time - timedelta(days=10),
                memory_type=MemoryType.SEMANTIC,
                importance=MemoryImportance.MEDIUM,
                access_count=3,
                last_accessed=base_time - timedelta(days=8)
            )
        ]
        
        return records
    
    @pytest.mark.asyncio
    async def test_decay_factor_calculation(self, decay_service, test_records):
        """Test decay factor calculation."""
        # Test recent, important, accessed record
        recent_record = test_records[0]
        decay_factor = await decay_service.calculate_decay_factor(recent_record)
        assert decay_factor > 0.8  # Should have high decay factor
        
        # Test old, unimportant, unaccessed record
        old_record = test_records[1]
        decay_factor = await decay_service.calculate_decay_factor(old_record)
        assert decay_factor < 0.5  # Should have low decay factor
        
        # Test moderate record
        moderate_record = test_records[2]
        decay_factor = await decay_service.calculate_decay_factor(moderate_record)
        assert 0.5 < decay_factor < 1.0  # Should have moderate-high decay factor due to semantic type and access
    
    @pytest.mark.asyncio
    async def test_decay_analysis(self, decay_service, test_records):
        """Test decay analysis."""
        record = test_records[0]
        
        analysis = await decay_service.analyze_decay(record, prediction_days=30)
        
        assert analysis.record_id == record.id
        assert analysis.current_decay_factor > 0
        assert analysis.predicted_decay_factor > 0
        assert analysis.predicted_decay_factor < analysis.current_decay_factor
        assert isinstance(analysis.decay_factors, dict)
        assert isinstance(analysis.recommendations, list)
    
    @pytest.mark.asyncio
    async def test_decay_factor_updates(self, decay_service, test_records):
        """Test updating decay factors."""
        updated_factors = await decay_service.update_decay_factors(test_records)
        
        assert len(updated_factors) == 3
        assert all(0 <= factor <= 1 for factor in updated_factors.values())
        
        # Verify records were updated
        for record in test_records:
            assert record.id in updated_factors
            assert record.decay_factor == updated_factors[record.id]
    
    @pytest.mark.asyncio
    async def test_decaying_records_identification(self, decay_service, test_records):
        """Test identification of decaying records."""
        decaying_records = await decay_service.get_decaying_records(
            test_records, 
            threshold=0.5
        )
        
        # Should include old record with low decay factor
        assert len(decaying_records) > 0
        assert any(record.id == "2" for record in decaying_records)
    
    @pytest.mark.asyncio
    async def test_cleanup_candidates(self, decay_service, test_records):
        """Test cleanup candidate suggestions."""
        candidates = await decay_service.suggest_cleanup_candidates(test_records)
        
        assert isinstance(candidates, list)
        
        if candidates:
            # Should be sorted by decay factor (lowest first)
            for i in range(len(candidates) - 1):
                assert candidates[i][1] <= candidates[i + 1][1]
    
    @pytest.mark.asyncio
    async def test_importance_boost(self, decay_service, test_records):
        """Test importance boosting."""
        record = test_records[1]  # Old record with low decay
        original_decay = record.decay_factor
        
        new_decay = await decay_service.boost_memory_importance(record, boost_factor=0.3)
        
        assert new_decay > original_decay
        assert record.decay_factor == new_decay
    
    @pytest.mark.asyncio
    async def test_decay_statistics(self, decay_service, test_records):
        """Test decay statistics."""
        stats = await decay_service.get_decay_statistics(test_records)
        
        assert stats["total_records"] == 3
        assert "avg_decay_factor" in stats
        assert "min_decay_factor" in stats
        assert "max_decay_factor" in stats
        assert "decay_distribution" in stats
        assert "by_memory_type" in stats
        assert "by_importance" in stats
        
        # Check distribution
        distribution = stats["decay_distribution"]
        assert distribution["healthy"] + distribution["aging"] + distribution["decaying"] == 3


class TestIntegration:
    """Integration tests for the hierarchical memory system."""
    
    @pytest.fixture
    def complete_system(self):
        """Create a complete hierarchical memory system."""
        # Create manager
        manager = HierarchicalMemoryManager(tenant_id="test_tenant")
        
        # Create and register layers
        core_memory = CoreMemory(tenant_id="test_tenant", agent_id="test_agent")
        episodic_memory = EpisodicMemory(tenant_id="test_tenant", agent_id="test_agent")
        semantic_memory = SemanticMemory(tenant_id="test_tenant", agent_id="test_agent")
        
        manager.register_layer(MemoryType.CORE, core_memory)
        manager.register_layer(MemoryType.EPISODIC, episodic_memory)
        manager.register_layer(MemoryType.SEMANTIC, semantic_memory)
        
        # Create search engine
        search_engine = HybridSearchEngine()
        
        # Create decay service
        decay_service = MemoryDecayService(tenant_id="test_tenant")
        
        return {
            "manager": manager,
            "search_engine": search_engine,
            "decay_service": decay_service,
            "core_memory": core_memory,
            "episodic_memory": episodic_memory,
            "semantic_memory": semantic_memory
        }
    
    @pytest.mark.asyncio
    async def test_end_to_end_memory_lifecycle(self, complete_system):
        """Test complete memory lifecycle."""
        manager = complete_system["manager"]
        search_engine = complete_system["search_engine"]
        decay_service = complete_system["decay_service"]
        
        # 1. Add memories to different layers
        core_id = await manager.add_memory(
            content="I am a research assistant specializing in climate science",
            memory_type=MemoryType.CORE,
            importance=MemoryImportance.CRITICAL
        )
        
        episodic_id = await manager.add_memory(
            content="User asked about renewable energy sources",
            memory_type=MemoryType.EPISODIC,
            importance=MemoryImportance.MEDIUM
        )
        
        semantic_id = await manager.add_memory(
            content="Solar panels convert sunlight into electricity",
            memory_type=MemoryType.SEMANTIC,
            importance=MemoryImportance.HIGH
        )
        
        # 2. Search across all layers
        results = await manager.search_all_layers("renewable energy")
        assert len(results) > 0
        
        # 3. Index memories in search engine
        for memory_type in [MemoryType.CORE, MemoryType.EPISODIC, MemoryType.SEMANTIC]:
            layer = manager.get_layer(memory_type)
            records = await layer.list_all()
            for record in records:
                await search_engine.index_record(record)
        
        # 4. Perform hybrid search
        hybrid_results = await search_engine.search("solar energy", limit=5)
        assert len(hybrid_results) > 0
        
        # 5. Analyze decay
        all_records = []
        for memory_type in [MemoryType.CORE, MemoryType.EPISODIC, MemoryType.SEMANTIC]:
            layer = manager.get_layer(memory_type)
            records = await layer.list_all()
            all_records.extend(records)
        
        decay_stats = await decay_service.get_decay_statistics(all_records)
        assert decay_stats["total_records"] == 4  # 3 added + 1 auto-created agent profile
        
        # 6. Update decay factors
        updated_factors = await decay_service.update_decay_factors(all_records)
        assert len(updated_factors) == 4  # 3 added + 1 auto-created agent profile
        
        # 7. Get system statistics
        memory_stats = await manager.get_memory_stats()
        search_stats = await search_engine.get_stats()
        
        assert memory_stats["core"]["total_records"] == 2  # 1 added + 1 auto-created agent profile
        assert memory_stats["episodic"]["total_records"] == 1
        assert memory_stats["semantic"]["total_records"] == 1
        
        assert search_stats["bm25_backend"]["total_documents"] == 4  # 3 added + 1 auto-created agent profile
        assert search_stats["vector_backend"]["total_documents"] == 4  # 3 added + 1 auto-created agent profile
    
    @pytest.mark.asyncio
    async def test_cross_layer_associations(self, complete_system):
        """Test associations between different memory layers."""
        manager = complete_system["manager"]
        core_memory = complete_system["core_memory"]
        episodic_memory = complete_system["episodic_memory"]
        semantic_memory = complete_system["semantic_memory"]
        
        # Add related memories
        core_id = await core_memory.add(
            content="Research focus: Climate change mitigation",
            importance=MemoryImportance.HIGH
        )
        
        episode_id = await episodic_memory.add_event(
            event_type="research",
            content="Conducted literature review on carbon capture technologies",
            importance=MemoryImportance.MEDIUM
        )
        
        concept_id = await semantic_memory.add_concept(
            name="Carbon Capture",
            description="Technology to capture CO2 from atmosphere",
            category="technology"
        )
        
        # Add associations
        core_record = await core_memory.get(core_id)
        episodic_records = await episodic_memory.list_all()
        semantic_records = await semantic_memory.list_all()
        
        if core_record and episodic_records and semantic_records:
            # Add association from core to episodic
            await core_memory.add_association(core_id, episodic_records[0].id)
            
            # Add association from core to semantic
            await core_memory.add_association(core_id, semantic_records[0].id)
            
            # Get associations
            associations = await core_memory.get_associations(core_id)
            assert len(associations) == 2
    
    @pytest.mark.asyncio
    async def test_memory_system_performance(self, complete_system):
        """Test memory system performance with larger dataset."""
        manager = complete_system["manager"]
        search_engine = complete_system["search_engine"]
        
        # Add larger dataset
        start_time = datetime.now(UTC)
        
        # Add 100 records to each layer
        for i in range(100):
            await manager.add_memory(
                content=f"Core information {i}: Agent capability and state",
                memory_type=MemoryType.CORE,
                importance=MemoryImportance.MEDIUM
            )
            
            await manager.add_memory(
                content=f"Event {i}: User interaction and task completion",
                memory_type=MemoryType.EPISODIC,
                importance=MemoryImportance.LOW
            )
            
            await manager.add_memory(
                content=f"Fact {i}: Scientific knowledge and research findings",
                memory_type=MemoryType.SEMANTIC,
                importance=MemoryImportance.HIGH
            )
        
        # Measure insertion time
        insertion_time = (datetime.now(UTC) - start_time).total_seconds()
        assert insertion_time < 10  # Should complete within 10 seconds
        
        # Index all records
        start_time = datetime.now(UTC)
        
        for memory_type in [MemoryType.CORE, MemoryType.EPISODIC, MemoryType.SEMANTIC]:
            layer = manager.get_layer(memory_type)
            records = await layer.list_all()
            for record in records:
                await search_engine.index_record(record)
        
        # Measure indexing time
        indexing_time = (datetime.now(UTC) - start_time).total_seconds()
        assert indexing_time < 15  # Should complete within 15 seconds
        
        # Perform searches
        start_time = datetime.now(UTC)
        
        for i in range(10):
            results = await search_engine.search(f"information {i}", limit=10)
            assert len(results) > 0
        
        # Measure search time
        search_time = (datetime.now(UTC) - start_time).total_seconds()
        assert search_time < 5  # Should complete within 5 seconds
        
        # Verify final statistics
        stats = await manager.get_memory_stats()
        assert stats["core"]["total_records"] == 101  # 100 added + 1 auto-created agent profile
        assert stats["episodic"]["total_records"] == 100
        assert stats["semantic"]["total_records"] == 100


if __name__ == "__main__":
    pytest.main([__file__, "-v"])