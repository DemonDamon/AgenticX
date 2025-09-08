from typing import Any, Dict, List, Optional
from datetime import datetime
import uuid

from agenticx.llms.base import BaseLLMProvider
from agenticx.memory.base import BaseMemory, MemoryRecord, SearchResult
from agenticx.integrations.mem0.memory.main import Memory
from mem0.configs.base import MemoryConfig  # Use mem0's MemoryConfig instead
from mem0.llms.configs import LlmConfig
from agenticx.integrations.mem0.llms.agenticx_llm import register_agenticx_llm, AgenticXLLM

class Mem0(BaseMemory):
    def __init__(self, llm: BaseLLMProvider, tenant_id: str = "default", config: Optional[Dict[str, Any]] = None):
        """
        Initialize the Mem0 memory component.

        This component uses a source-integrated version of mem0 to allow for custom LLM providers.

        :param llm: An instance of a class that inherits from agenticx.llms.base.BaseLLMProvider.
                    This LLM instance will be used by mem0 for its internal operations.
        :param tenant_id: Tenant ID for isolation (default: "default")
        :param config: An optional dictionary for advanced mem0 configuration.
        """
        super().__init__(tenant_id=tenant_id)
        self._llm = llm
        
        # Prepare the configuration for mem0
        mem0_config = self._create_mem0_config(llm, config)
        
        # Instantiate the integrated mem0 Memory class
        self._memory = Memory(config=mem0_config)

    def _create_mem0_config(self, llm: BaseLLMProvider, user_config: Optional[Dict[str, Any]]) -> MemoryConfig:
        """Helper to construct the MemoryConfig for mem0."""
        
        # Register the AgenticX LLM instance in the global registry
        register_agenticx_llm(llm, f"tenant_{self.tenant_id}")
        
        # Register our custom LLM class with the factory using the 'openai' slot
        # This is a hack but simpler than patching validators
        from mem0.utils.factory import LlmFactory
        
        # Store the original openai class for restoration if needed
        original_openai_class = LlmFactory.provider_to_class.get("openai")
        
        # Replace the openai provider with our custom class
        LlmFactory.provider_to_class["openai"] = "agenticx.integrations.mem0.llms.agenticx_llm.AgenticXLLM"
        
        # Create an LlmConfig with openai provider (which now points to our custom class)
        llm_config = LlmConfig(
            provider="openai",
            config={}  # Empty config since we use the registry
        )

        # Create the main memory configuration
        # We can expose more options from user_config if needed in the future
        mem0_config = MemoryConfig(
            llm=llm_config
        )

        return mem0_config

    async def add(self, content: str, metadata: Optional[Dict[str, Any]] = None, record_id: Optional[str] = None) -> str:
        """
        Add a memory to mem0.

        :param content: The string content to add as a memory.
        :param metadata: Optional metadata. For mem0, this often includes a 'user_id' or 'agent_id'.
        :param record_id: Optional custom record ID (not used by mem0, auto-generated)
        :return: The ID of the created memory record
        """
        if not metadata or not ('user_id' in metadata or 'agent_id' in metadata):
            raise ValueError("Mem0 requires 'user_id' or 'agent_id' in metadata to add a memory.")
        
        # Ensure tenant isolation
        metadata = self._ensure_tenant_isolation(metadata)
        
        # Extract known parameters for mem0.add()
        user_id = metadata.get('user_id')
        agent_id = metadata.get('agent_id')
        run_id = metadata.get('run_id')
        memory_type = metadata.get('memory_type')
        
        # Put other metadata in the metadata dict
        other_metadata = {k: v for k, v in metadata.items() 
                         if k not in ['user_id', 'agent_id', 'run_id', 'memory_type']}
        
        # Mem0 doesn't return IDs directly, so we generate one
        record_id = record_id or self._generate_record_id()
        
        # Call mem0.add with correct parameters
        self._memory.add(
            messages=[{"role": "user", "content": content}],
            user_id=user_id,
            agent_id=agent_id,
            run_id=run_id,
            metadata=other_metadata if other_metadata else None,
            memory_type=memory_type
        )
        return record_id

    async def search(self, query: str, limit: int = 10, metadata_filter: Optional[Dict[str, Any]] = None, min_score: float = 0.0) -> List[SearchResult]:
        """
        Search for memories in mem0.

        :param query: The query string to search for.
        :param limit: Maximum number of results to return
        :param metadata_filter: Optional metadata for filtering, e.g., {'user_id': 'some_user'}.
        :param min_score: Minimum relevance score threshold
        :return: A list of SearchResult objects.
        """
        if not metadata_filter or not ('user_id' in metadata_filter or 'agent_id' in metadata_filter):
            raise ValueError("Mem0 requires 'user_id' or 'agent_id' in metadata to search memories.")
        
        # Ensure tenant isolation
        metadata_filter = self._ensure_tenant_isolation(metadata_filter)
        
        # Extract known parameters for mem0.search()
        user_id = metadata_filter.get('user_id')
        agent_id = metadata_filter.get('agent_id')
        run_id = metadata_filter.get('run_id')
        
        # Put other metadata in the filters dict
        other_filters = {k: v for k, v in metadata_filter.items() 
                        if k not in ['user_id', 'agent_id', 'run_id', 'tenant_id']}
        
        # Call mem0.search with correct parameters
        results = self._memory.search(
            query=query, 
            limit=limit, 
            user_id=user_id,
            agent_id=agent_id,
            run_id=run_id,
            filters=other_filters if other_filters else None,
            threshold=min_score if min_score > 0 else None
        )
        
        # Convert mem0 results to SearchResult objects
        search_results = []
        for result in results.get("results", []):
            record = MemoryRecord(
                id=result.get("id", str(uuid.uuid4())),
                content=result.get("memory", ""),
                metadata=result.get("metadata", {}),
                tenant_id=self.tenant_id,
                created_at=datetime.now(),
                updated_at=datetime.now()
            )
            score = result.get("score", 1.0)
            search_results.append(SearchResult(record=record, score=score))
        
        return search_results

    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        """
        Get a specific memory record by ID.
        Note: Mem0 doesn't support direct ID lookup, so this returns None.
        """
        # Mem0 doesn't provide direct ID-based retrieval
        return None

    async def update(self, record_id: str, content: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """
        Update an existing memory record.
        Note: Mem0 doesn't support direct updates, so this returns False.
        """
        # Mem0 doesn't provide direct update functionality
        return False

    async def delete(self, record_id: str) -> bool:
        """
        Delete a memory record.
        Note: Mem0 doesn't support direct deletion by ID, so this returns False.
        """
        # Mem0 doesn't provide direct deletion by ID
        return False

    async def list_all(self, limit: int = 100, offset: int = 0, metadata_filter: Optional[Dict[str, Any]] = None) -> List[MemoryRecord]:
        """
        List all memory records.
        Note: Mem0 doesn't provide a list all functionality, so we return empty list.
        """
        # Mem0 doesn't provide a way to list all memories
        return []

    async def clear(self) -> int:
        """
        Clears all memories from the store.
        """
        # Mem0's reset doesn't return count, so we return 0
        self._memory.reset()
        return 0 