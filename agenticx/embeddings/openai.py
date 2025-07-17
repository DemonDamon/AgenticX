from typing import List, Optional
from .base import BaseEmbeddingProvider, EmbeddingError

class OpenAIEmbeddingProvider(BaseEmbeddingProvider):
    def __init__(self, api_key: str, model: str = "text-embedding-ada-002", api_base: Optional[str] = None, **kwargs):
        super().__init__(kwargs)
        self.api_key = api_key
        self.model = model
        self.api_base = api_base
        try:
            import openai
            self.openai = openai
        except ImportError:
            raise ImportError("openai sdk required")

    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        try:
            client = self.openai.OpenAI(api_key=self.api_key, base_url=self.api_base) if self.api_base else self.openai.OpenAI(api_key=self.api_key)
            resp = client.embeddings.create(model=self.model, input=texts, **kwargs)
            return [item.embedding for item in resp.data]
        except Exception as e:
            raise EmbeddingError(f"OpenAI embedding error: {e}") 