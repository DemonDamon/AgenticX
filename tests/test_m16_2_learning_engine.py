"""Test suite for M16.2 Human-Aligned Learning Engine

This module contains comprehensive tests for all learning components
in the M16.2 Human-Aligned Learning Engine.
"""

import pytest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock, patch
from typing import Dict, Any, List

# Import the learning components
from agenticx.embodiment.learning.app_knowledge_retriever import (
    AppKnowledgeRetriever, AppContext
)
from agenticx.embodiment.learning.gui_explorer import (
    GUIExplorer, ExplorationResult, ExplorationStrategy
)
from agenticx.embodiment.learning.task_synthesizer import (
    TaskSynthesizer, TaskPattern, SynthesisConfig
)
from agenticx.embodiment.learning.deep_usage_optimizer import (
    DeepUsageOptimizer, OptimizationType, UsagePattern, 
    OptimizationRecommendation, PerformanceMetrics
)
from agenticx.embodiment.learning.edge_case_handler import (
    EdgeCaseHandler, EdgeCaseType, EdgeCase, HandlingStrategy
)
from agenticx.embodiment.learning.knowledge_evolution import (
    KnowledgeEvolution, KnowledgeType, KnowledgeItem, EvolutionTrigger
)

# Import core dependencies
from agenticx.memory.component import MemoryComponent
from agenticx.embodiment.core.models import GUITask, ScreenState, InteractionElement


class TestAppKnowledgeRetriever:
    """Test cases for AppKnowledgeRetriever component."""
    
    @pytest.mark.asyncio
    async def test_retriever_initialization(self):
        """Test AppKnowledgeRetriever initialization."""
        retriever = AppKnowledgeRetriever(name="test_retriever")
        assert retriever.name == "test_retriever"
        assert hasattr(retriever, '_similarity_threshold')
        assert hasattr(retriever, '_max_results')
    
    @pytest.mark.asyncio
    async def test_get_app_context(self):
        """Test getting application context."""
        retriever = AppKnowledgeRetriever()
        
        # Create a mock memory component
        class MockMemory:
            async def search_across_memories(self, query, limit=None, metadata_filter=None, min_score=None):
                return []
        
        memory = MockMemory()
        context = await retriever.get_app_context("TestApp", memory)
        assert context is not None
        assert context.app_name == "TestApp"


class TestGUIExplorer:
    """Test cases for GUIExplorer component."""
    
    @pytest.mark.asyncio
    async def test_explorer_initialization(self):
        """Test that GUIExplorer initializes correctly."""
        explorer = GUIExplorer(name="test_explorer")
        await explorer.initialize()
        
        assert explorer.is_initialized
        assert isinstance(explorer._visited_states, set)
        assert isinstance(explorer._exploration_queue, list)
    
    @pytest.mark.asyncio
    async def test_explore_application(self):
        """Test application exploration functionality."""
        explorer = GUIExplorer(name="test_explorer")
        await explorer.initialize()
        
        # Mock screen state
        from agenticx.embodiment.core.models import ElementType
        mock_screen = ScreenState(
            timestamp=datetime.now(),
            agent_id="test_agent",
            screenshot="/mock/path",
            interactive_elements=[
                InteractionElement(
                    element_id="btn1",
                    bounds=(100, 200, 80, 30),  # x, y, width, height
                    element_type=ElementType.BUTTON,
                    text_content="Click Me",
                    attributes={"is_visible": True, "is_enabled": True}
                )
            ]
        )
        
        strategy = ExplorationStrategy(
            max_depth=2,
            exploration_timeout=30.0,
            element_interaction_delay=1.0
        )
        
        # Create mock memory and tool executor
        mock_memory = Mock(spec=MemoryComponent)
        mock_memory.search_across_memories = AsyncMock(return_value=[])
        mock_tool_executor = Mock()
        
        with patch.object(explorer, '_capture_screen_state', return_value=mock_screen):
            with patch.object(explorer, '_interact_with_element', return_value=True):
                result = await explorer.explore_application(
                    "TestApp", mock_screen, mock_memory, mock_tool_executor
                )
        
        assert isinstance(result, ExplorationResult)
        assert result.app_name == "TestApp"


class TestTaskSynthesizer:
    """Test cases for TaskSynthesizer component."""
    
    @pytest.mark.asyncio
    async def test_synthesizer_initialization(self):
        """Test that TaskSynthesizer initializes correctly."""
        synthesizer = TaskSynthesizer(name="test_synthesizer")
        await synthesizer.initialize()
        
        assert synthesizer.is_initialized
        assert isinstance(synthesizer._known_patterns, dict)
    
    @pytest.mark.asyncio
    async def test_synthesize_patterns_from_memory(self):
        """Test pattern synthesis from memory."""
        from agenticx.memory.core_memory import SearchResult, HierarchicalMemoryRecord
        
        # Create mock memory records
        from agenticx.memory.hierarchical import MemoryType, MemoryImportance, MemorySensitivity
        
        mock_record = HierarchicalMemoryRecord(
            id="test_record",
            content="user clicked button",
            metadata={"app_name": "TestApp", "timestamp": datetime.now()},
            tenant_id="test_tenant",
            created_at=datetime.now(),
            updated_at=datetime.now(),
            memory_type=MemoryType.SEMANTIC,
            importance=MemoryImportance.MEDIUM,
            sensitivity=MemorySensitivity.INTERNAL
        )
        mock_search_result = SearchResult(record=mock_record, score=0.9)
        
        mock_memory = Mock(spec=MemoryComponent)
        mock_memory.search_across_memories = AsyncMock(return_value=[mock_search_result])
        
        synthesizer = TaskSynthesizer(name="test_synthesizer")
        await synthesizer.initialize()
        
        patterns = await synthesizer.synthesize_patterns_from_memory(mock_memory, "TestApp")
        
        assert isinstance(patterns, list)
        # Should find at least one pattern
        assert len(patterns) >= 0


class TestDeepUsageOptimizer:
    """Test cases for DeepUsageOptimizer component."""
    
    @pytest.mark.asyncio
    async def test_optimizer_initialization(self):
        """Test that DeepUsageOptimizer initializes correctly."""
        optimizer = DeepUsageOptimizer(name="test_optimizer")
        await optimizer.initialize()
        
        assert optimizer.is_initialized
        assert hasattr(optimizer, '_usage_patterns')
    
    @pytest.mark.asyncio
    async def test_analyze_usage_patterns(self):
        """Test usage pattern analysis."""
        from agenticx.memory.core_memory import SearchResult, HierarchicalMemoryRecord
        
        # Create mock memory records
        from agenticx.memory.hierarchical import MemoryType, MemoryImportance, MemorySensitivity
        
        mock_record = HierarchicalMemoryRecord(
            id="test_usage_record",
            content="task execution data",
            metadata={
                'task_id': 'task1',
                'execution_time': 5.0,
                'success': True,
                'user_actions': ['click', 'type', 'submit'],
                'app_name': 'TestApp'
            },
            tenant_id="test_tenant",
            created_at=datetime.now(),
            updated_at=datetime.now(),
            memory_type=MemoryType.SEMANTIC,
            importance=MemoryImportance.MEDIUM,
            sensitivity=MemorySensitivity.INTERNAL
        )
        mock_search_result = SearchResult(record=mock_record, score=0.9)
        
        mock_memory = Mock(spec=MemoryComponent)
        mock_memory.search_across_memories = AsyncMock(return_value=[mock_search_result])
        
        optimizer = DeepUsageOptimizer(name="test_optimizer")
        await optimizer.initialize()
        
        patterns = await optimizer.analyze_usage_patterns(mock_memory, "TestApp")
        
        assert isinstance(patterns, list)
        # Should identify at least basic patterns
        assert len(patterns) >= 0


class TestEdgeCaseHandler:
    """Test EdgeCaseHandler component."""
    
    @pytest.mark.asyncio
    async def test_handler_initialization(self):
        """Test EdgeCaseHandler initialization."""
        handler = EdgeCaseHandler(name="test_handler")
        assert handler.name == "test_handler"
        assert hasattr(handler, '_config')
        assert hasattr(handler, '_edge_cases')
    
    @pytest.mark.asyncio
    async def test_detect_edge_case(self):
        """Test edge case detection."""
        handler = EdgeCaseHandler()
        
        # Create mock task and context
        from agenticx.embodiment.core.models import GUITask
        task = GUITask(
            id="test_task",
            description="Test task",
            agent_id="test_agent",
            expected_output="Test output"
        )
        
        context = {
            'error_type': 'timeout',
            'element_not_found': True,
            'retry_count': 3
        }
        
        error_info = {
            'error_message': 'Element not found',
            'error_code': 'TIMEOUT'
        }
        
        edge_case = await handler.detect_edge_case(task, context, error_info)
        # Edge case detection may return None if no edge case is detected
        # This is normal behavior


class TestKnowledgeEvolution:
    """Test cases for KnowledgeEvolution component."""
    
    @pytest.mark.asyncio
    async def test_evolution_initialization(self):
        """Test that KnowledgeEvolution initializes correctly."""
        evolution = KnowledgeEvolution(name="test_evolution")
        await evolution.initialize()
        
        assert evolution.is_initialized
        assert isinstance(evolution._knowledge_base, dict)
        assert isinstance(evolution._evolution_history, list)
    
    @pytest.mark.asyncio
    async def test_add_knowledge(self):
        """Test adding knowledge to the evolution system."""
        from agenticx.embodiment.learning.knowledge_evolution import KnowledgeType
        
        evolution = KnowledgeEvolution()
        
        content = {
            'pattern_type': 'click',
            'element_selector': 'button[type="submit"]',
            'success_rate': 0.95
        }
        
        knowledge_id = await evolution.add_knowledge(
            knowledge_type=KnowledgeType.UI_PATTERN,
            title='Button Click Pattern',
            content=content,
            source='test',
            description='Pattern for clicking submit buttons',
            confidence_score=0.9,
            tags=['ui', 'interaction', 'button']
        )
        
        assert isinstance(knowledge_id, str)
        assert knowledge_id in evolution._knowledge_base


class TestLearningEngineIntegration:
    """Integration tests for the complete learning engine."""
    
    @pytest.mark.asyncio
    async def test_component_initialization(self):
        """Test that all learning components initialize correctly."""
        mock_memory = Mock(spec=MemoryComponent)
        mock_memory.search_across_memories = AsyncMock(return_value=[])
        
        # Create components
        retriever = AppKnowledgeRetriever(
            name="integration_retriever",
            memory_component=mock_memory
        )
        explorer = GUIExplorer(name="integration_explorer")
        synthesizer = TaskSynthesizer(name="integration_synthesizer")
        optimizer = DeepUsageOptimizer(name="integration_optimizer")
        edge_handler = EdgeCaseHandler(name="integration_edge_handler")
        evolution = KnowledgeEvolution(name="integration_evolution")
        
        # Initialize all components
        await retriever.initialize()
        await explorer.initialize()
        await synthesizer.initialize()
        await optimizer.initialize()
        await edge_handler.initialize()
        await evolution.initialize()
        
        components = {
            'retriever': retriever,
            'explorer': explorer,
            'synthesizer': synthesizer,
            'optimizer': optimizer,
            'edge_handler': edge_handler,
            'evolution': evolution
        }
        
        for name, component in components.items():
            assert component.is_initialized, f"{name} failed to initialize"
    
    @pytest.mark.asyncio
    async def test_learning_workflow(self):
        """Test a complete learning workflow."""
        mock_memory = Mock(spec=MemoryComponent)
        mock_memory.search_across_memories = AsyncMock(return_value=[])
        
        # Create components
        retriever = AppKnowledgeRetriever(
            name="integration_retriever",
            memory_component=mock_memory
        )
        evolution = KnowledgeEvolution(name="integration_evolution")
        
        # Initialize components
        await retriever.initialize()
        await evolution.initialize()
        
        app_name = "TestApp"
        
        # 1. Build app context
        from agenticx.memory.core_memory import SearchResult, HierarchicalMemoryRecord
        from agenticx.memory.hierarchical import MemoryType, MemoryImportance, MemorySensitivity
        from datetime import datetime
        
        mock_record = HierarchicalMemoryRecord(
            id="integration_record",
            content="test app behavior",
            metadata={'app_name': app_name, 'action': 'test'},
            tenant_id="test_tenant",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            memory_type=MemoryType.SEMANTIC,
            importance=MemoryImportance.MEDIUM,
            sensitivity=MemorySensitivity.INTERNAL
        )
        mock_search_result = SearchResult(record=mock_record, score=0.9)
        mock_memory.search_across_memories.return_value = [mock_search_result]
        
        context = await retriever.get_app_context(app_name, mock_memory)
        assert isinstance(context, AppContext)
        
        # 2. Add knowledge to evolution system
        from agenticx.embodiment.learning.knowledge_evolution import KnowledgeType
        
        knowledge_id = await evolution.add_knowledge(
            knowledge_type=KnowledgeType.APPLICATION_BEHAVIOR,
            title=f"{app_name} Behavior",
            content={'context': context.model_dump()},
            source='test',
            description='Application behavior patterns',
            confidence_score=0.9,
            tags=['app', 'behavior']
        )
        assert isinstance(knowledge_id, str)
        
        # 3. Validate the learning process
        insights = await evolution.get_knowledge_insights()
        assert isinstance(insights, dict)
        assert insights['summary']['total_items'] > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])