"""
AgenticX LLM Provider for Mem0

This module provides a custom LLM provider that integrates AgenticX LLM instances
with the Mem0 memory system.
"""

from typing import Any, Dict, List, Optional
from mem0.llms.base import LLMBase
from mem0.configs.llms.base import BaseLlmConfig


class AgenticXLLM(LLMBase):
    """
    AgenticX LLM provider for Mem0.
    
    This provider allows using AgenticX LLM instances within the Mem0 memory system.
    """
    
    def __init__(self, config: BaseLlmConfig):
        """
        Initialize the AgenticX LLM provider.
        
        Args:
            config: BaseLlmConfig instance containing the AgenticX LLM instance
        """
        super().__init__(config)
        
        # The AgenticX LLM instance should be stored in a global registry
        # or passed through some other mechanism since BaseLlmConfig doesn't support custom fields
        self.llm_instance = getattr(config, 'llm_instance', None)
        
        if self.llm_instance is None:
            # Try to get from global registry with different keys
            self.llm_instance = _get_agenticx_llm_instance("default")
            
            # If not found, try to find any available instance
            if self.llm_instance is None and _agenticx_llm_registry:
                # Get the first available instance
                self.llm_instance = next(iter(_agenticx_llm_registry.values()))
            
        if self.llm_instance is None:
            available_keys = list(_agenticx_llm_registry.keys())
            raise ValueError(f"AgenticX LLM instance not found. Available keys: {available_keys}. Please register it first.")
    
    def generate_response(
        self,
        messages: List[Dict[str, str]],
        response_format: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str] = None,
    ) -> str:
        """
        Generate a response using the AgenticX LLM instance.
        
        Args:
            messages: List of message dictionaries
            response_format: Optional response format (not used)
            tools: Optional tools (not used)
            tool_choice: Optional tool choice (not used)
            
        Returns:
            Generated response string
        """
        try:
            # Convert messages to AgenticX format and call the LLM
            response = self.llm_instance.invoke(messages)
            return response.content
        except Exception as e:
            raise RuntimeError(f"Error generating response with AgenticX LLM: {e}")


# Global registry for AgenticX LLM instances
_agenticx_llm_registry = {}


def register_agenticx_llm(llm_instance, instance_id: str = "default"):
    """
    Register an AgenticX LLM instance for use with Mem0.
    
    Args:
        llm_instance: AgenticX LLM instance
        instance_id: Unique identifier for this instance
    """
    _agenticx_llm_registry[instance_id] = llm_instance


def _get_agenticx_llm_instance(instance_id: str = "default"):
    """
    Get a registered AgenticX LLM instance.
    
    Args:
        instance_id: Unique identifier for the instance
        
    Returns:
        AgenticX LLM instance or None if not found
    """
    return _agenticx_llm_registry.get(instance_id)


def clear_agenticx_llm_registry():
    """Clear the AgenticX LLM registry."""
    global _agenticx_llm_registry
    _agenticx_llm_registry = {} 