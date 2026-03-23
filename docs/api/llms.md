# agenticx.llms

## BaseLLMProvider

All providers implement the `BaseLLMProvider` interface:

```python
class BaseLLMProvider(ABC):
    @abstractmethod
    def complete(self, messages: list[Message], **kwargs) -> LLMResponse: ...

    @abstractmethod
    async def acomplete(self, messages: list[Message], **kwargs) -> LLMResponse: ...

    @abstractmethod
    def stream(self, messages: list[Message], **kwargs) -> Iterator[str]: ...
```

## Available Providers

| Class | Import |
|-------|--------|
| `OpenAIProvider` | `from agenticx.llms import OpenAIProvider` |
| `AnthropicProvider` | `from agenticx.llms import AnthropicProvider` |
| `OllamaProvider` | `from agenticx.llms import OllamaProvider` |
| `GeminiProvider` | `from agenticx.llms import GeminiProvider` |
| `MinimaxProvider` | `from agenticx.llms import MinimaxProvider` |
| `MoonshotProvider` | `from agenticx.llms import MoonshotProvider` |
| `ArkProvider` | `from agenticx.llms import ArkProvider` |
| `ZhipuProvider` | `from agenticx.llms import ZhipuProvider` |
| `QianfanProvider` | `from agenticx.llms import QianfanProvider` |
| `DashscopeProvider` | `from agenticx.llms import DashscopeProvider` |
| `FailoverProvider` | `from agenticx.llms import FailoverProvider` |

!!! tip "Full API Reference"
    See [source on GitHub](https://github.com/DemonDamon/AgenticX/tree/main/agenticx/llms).
