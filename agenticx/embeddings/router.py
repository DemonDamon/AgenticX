from typing import List, Dict, Any, Optional
from .base import BaseEmbeddingProvider, EmbeddingError

class EmbeddingRouter:
    """动态路由多个嵌入服务"""
    def __init__(self, providers: List[BaseEmbeddingProvider]):
        self.providers = providers

    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        last_err = None
        for provider in self.providers:
            try:
                return provider.embed(texts, **kwargs)
            except Exception as e:
                last_err = e
                continue
        raise EmbeddingError(f"All embedding providers failed: {last_err}") 