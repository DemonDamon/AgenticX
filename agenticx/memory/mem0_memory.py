from typing import Any, Dict, List, Optional

from agenticx.llms.base import BaseLLM
from agenticx.memory.base import BaseMemory
from agenticx.integrations.mem0.memory.main import Memory
from agenticx.integrations.mem0.configs.base import MemoryConfig
from agenticx.integrations.mem0.configs.llms.base import BaseLlmConfig

class Mem0(BaseMemory):
    def __init__(self, llm: BaseLLM, config: Optional[Dict[str, Any]] = None):
        """
        Initialize the Mem0 memory component.

        This component uses a source-integrated version of mem0 to allow for custom LLM providers.

        :param llm: An instance of a class that inherits from agenticx.llms.base.BaseLLM.
                    This LLM instance will be used by mem0 for its internal operations.
        :param config: An optional dictionary for advanced mem0 configuration.
        """
        super().__init__()
        self._llm = llm
        
        # Prepare the configuration for mem0
        mem0_config = self._create_mem0_config(llm, config)
        
        # Instantiate the integrated mem0 Memory class
        self._memory = Memory(config=mem0_config)

    def _create_mem0_config(self, llm: BaseLLM, user_config: Optional[Dict[str, Any]]) -> MemoryConfig:
        """Helper to construct the MemoryConfig for mem0."""
        
        # Start with a base LLM config for our custom provider
        llm_config = BaseLlmConfig(
            provider="agenticx",
            config={"llm_instance": llm} # Pass the agenticx llm instance
        )

        # Create the main memory configuration
        # We can expose more options from user_config if needed in the future
        mem0_config = MemoryConfig(
            llm=llm_config
        )

        return mem0_config

    def add(self, content: str, metadata: Optional[Dict[str, Any]] = None):
        """
        Add a memory to mem0.

        :param content: The string content to add as a memory.
        :param metadata: Optional metadata. For mem0, this often includes a 'user_id' or 'agent_id'.
        """
        if not metadata or not ('user_id' in metadata or 'agent_id' in metadata):
            raise ValueError("Mem0 requires 'user_id' or 'agent_id' in metadata to add a memory.")
        
        self._memory.add(messages=[{"role": "user", "content": content}], **metadata)

    def get(self, query: str, metadata: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Search for memories in mem0.

        :param query: The query string to search for.
        :param metadata: Optional metadata for filtering, e.g., {'user_id': 'some_user'}.
        :return: A list of search results.
        """
        if not metadata or not ('user_id' in metadata or 'agent_id' in metadata):
            raise ValueError("Mem0 requires 'user_id' or 'agent_id' in metadata to search memories.")
            
        return self._memory.search(query=query, **metadata)

    def clear(self):
        """

        Clears all memories from the store.
        """
        self._memory.reset() 