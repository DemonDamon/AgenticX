from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Generator, Union, Dict, List
from pydantic import BaseModel, Field, ConfigDict

from .response import LLMResponse

class BaseLLMProvider(ABC, BaseModel):
    """
    Abstract base class for all LLM providers in the AgenticX framework.
    """
    model: str = Field(description="The model name to use for the provider.")

    model_config = ConfigDict(arbitrary_types_allowed=True)
    
    @abstractmethod
    def invoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        """
        Invoke the language model synchronously.
        
        Args:
            prompt: The input prompt for the model.
            **kwargs: Additional provider-specific arguments.
            
        Returns:
            An LLMResponse object with the model's output.
        """
        pass

    @abstractmethod
    async def ainvoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        """
        Invoke the language model asynchronously.

        Args:
            prompt: The input prompt for the model.
            **kwargs: Additional provider-specific arguments.

        Returns:
            An LLMResponse object with the model's output.
        """
        pass

    @abstractmethod
    def stream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> Generator[Union[str, Dict], None, None]:
        """
        Stream the language model's response synchronously.
        
        Yields:
            Chunks of the response, typically strings.
        """
        pass

    @abstractmethod
    async def astream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> AsyncGenerator[Union[str, Dict], None]:
        """
        Stream the language model's response asynchronously.

        Yields:
            Chunks of the response, typically strings.
        """
        pass 