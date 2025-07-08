from typing import Dict, List, Optional
from agenticx.llms.base import BaseLLM
from mem0.llms.base import LLMBase

class AgenticXLLM(LLMBase):
    def __init__(self, llm_instance: BaseLLM, config: Optional[Dict] = None):
        """
        Initialize the AgenticXLLM adapter.

        :param llm_instance: An instance of a class that inherits from agenticx.llms.base.BaseLLM.
        :param config: Configuration dictionary.
        """
        super().__init__(config)
        if not isinstance(llm_instance, BaseLLM):
            raise ValueError("llm_instance must be an instance of agenticx.llms.base.BaseLLM")
        self.llm = llm_instance

    def generate_response(self, messages: List[Dict], tools: Optional[List[Dict]] = None, tool_choice: str = "auto"):
        """
        Generate a response using the AgenticX LLM instance.

        :param messages: List of message dicts, e.g., [{"role": "user", "content": "Hello"}].
        :param tools: Optional list of tools.
        :param tool_choice: Tool choice strategy.
        :return: The generated response from the LLM.
        """
        # Note: This is a simplified example. We might need to adapt the `tools` and `tool_choice` formats
        # if they differ between mem0's expectations and AgenticX's implementation.
        # For now, we pass them through directly if they are not None.
        
        # Assuming the AgenticX LLM has a method like `invoke` or similar.
        # We will call the `invoke` method on the llm instance.
        response = self.llm.invoke(messages, tools=tools, tool_choice=tool_choice)

        # Assuming response object has a `content` attribute with the text response.
        return response.content 