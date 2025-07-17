from typing import List, Optional
from .base import BaseEmbeddingProvider, EmbeddingError

class LiteLLMEmbeddingProvider(BaseEmbeddingProvider):
    def __init__(self, model: str, api_key: Optional[str] = None, api_base: Optional[str] = None, **kwargs):
        super().__init__(kwargs)
        self.model = model
        self.api_key = api_key
        self.api_base = api_base
        try:
            import litellm
            self.litellm = litellm
        except ImportError:
            raise ImportError("litellm sdk required")

    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        try:
            # litellm.embedding 支持 model, input, api_key, api_base 等参数
            resp = self.litellm.embedding(model=self.model, input=texts, api_key=self.api_key, api_base=self.api_base, **kwargs)
            return [item["embedding"] for item in resp["data"]]
        except Exception as e:
            raise EmbeddingError(f"LiteLLM embedding error: {e}") 