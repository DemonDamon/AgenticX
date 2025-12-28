import pytest
from unittest.mock import MagicMock, patch

from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse
from agenticx.memory.mem0_memory import Mem0
from agenticx.integrations.mem0.configs.base import MemoryConfig

# Mock AgenticX LLM for testing purposes
class MockAgenticXLLM(BaseLLMProvider):
    def __init__(self):
        super().__init__(model="mock_model")
    
    def invoke(self, messages, **kwargs):
        return LLMResponse(
            content=f"Mock response to: {messages[-1]['content']}",
            model="mock_model",
            cost=0.0,
            token_usage={"input": 10, "output": 10}
        )
    
    async def ainvoke(self, messages, **kwargs):
        return self.invoke(messages, **kwargs)
    
    def stream(self, messages, **kwargs):
        yield "Mock stream response"
    
    async def astream(self, messages, **kwargs):
        yield "Mock async stream response"

@pytest.fixture
def mock_llm():
    """Provides a mock LLM instance for tests."""
    return MockAgenticXLLM()

class TestMem0Integration:
    """Test cases for the source-integrated Mem0 memory component."""

    def test_initialization(self, mock_llm):
        """Test that Mem0 can be initialized correctly with an AgenticX LLM."""
        with patch('agenticx.integrations.mem0.memory.main.Memory.__init__', return_value=None) as mock_mem0_init:
            memory = Mem0(llm=mock_llm)
            assert memory is not None
            assert memory._llm is mock_llm
            
            # Verify that the underlying mem0 Memory class was initialized with the correct config
            mock_mem0_init.assert_called_once()
            args, kwargs = mock_mem0_init.call_args
            config_arg = kwargs.get('config')
            
            assert isinstance(config_arg, MemoryConfig)
            assert config_arg.llm.provider == "agenticx"
            assert config_arg.llm.config['llm_instance'] is mock_llm

    @patch('agenticx.integrations.mem0.memory.main.Memory.add')
    def test_add_method(self, mock_mem0_add, mock_llm):
        """Test that the add method calls the underlying mem0 add with correct parameters."""
        memory = Mem0(llm=mock_llm)
        
        content = "I have a penicillin allergy."
        user_id = "test_user_123"
        
        memory.add(content, metadata={"user_id": user_id})
        
        # Check that the underlying mem0's add method was called
        mock_mem0_add.assert_called_once()
        args, kwargs = mock_mem0_add.call_args
        
        # Verify arguments passed to mem0's add method
        assert kwargs['messages'] == [{"role": "user", "content": content}]
        assert kwargs['user_id'] == user_id

    @patch('agenticx.integrations.mem0.memory.main.Memory.search')
    def test_get_method(self, mock_mem0_search, mock_llm):
        """Test that the get (search) method calls the underlying mem0 search."""
        mock_mem0_search.return_value = {"results": [{"id": "mem_abc", "memory": "some memory"}]}
        memory = Mem0(llm=mock_llm)
        
        query = "What are my allergies?"
        user_id = "test_user_123"
        
        results = memory.get(query, metadata={"user_id": user_id})
        
        # Check that the underlying mem0's search method was called
        mock_mem0_search.assert_called_once()
        args, kwargs = mock_mem0_search.call_args
        
        # Verify arguments passed to mem0's search method
        assert kwargs['query'] == query
        assert kwargs['user_id'] == user_id
        
        # Check that the results are passed through
        assert results == {"results": [{"id": "mem_abc", "memory": "some memory"}]}

    def test_add_without_userid_raises_error(self, mock_llm):
        """Test that calling add without a user_id or agent_id raises a ValueError."""
        memory = Mem0(llm=mock_llm)
        
        with pytest.raises(ValueError, match="Mem0 requires 'user_id' or 'agent_id' in metadata"):
            memory.add("some content", metadata={"other_key": "value"})

    @patch('agenticx.integrations.mem0.memory.main.Memory.reset')
    def test_clear_method(self, mock_mem0_reset, mock_llm):
        """Test that the clear method calls the underlying mem0 reset."""
        memory = Mem0(llm=mock_llm)
        memory.clear()
        mock_mem0_reset.assert_called_once() 