from typing import List
from .base import BaseEmbeddingProvider, EmbeddingError

class BailianEmbeddingProvider(BaseEmbeddingProvider):
    def __init__(self, api_key: str, model: str, api_url: str, **kwargs):
        super().__init__(kwargs)
        self.api_key = api_key
        self.model = model
        self.api_url = api_url

    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        raise NotImplementedError("Bailian embedding provider not implemented yet.") 