from typing import List, Dict, Any, Optional
from .base import BaseEmbeddingProvider, EmbeddingError

class EmbeddingRouter:
    """动态路由多个嵌入服务"""
    def __init__(self, providers: List[BaseEmbeddingProvider]):
        self.providers = providers

    def get_embedding_dim(self) -> int:
        """获取主要嵌入模型的维度"""
        if not self.providers:
            raise EmbeddingError("No embedding providers configured.")
        
        primary_provider = self.providers[0]
        if hasattr(primary_provider, 'get_embedding_dim'):
            return primary_provider.get_embedding_dim()
        
        # 回退机制：如果主要提供者没有get_embedding_dim方法，则尝试从dimension属性获取
        if hasattr(primary_provider, 'dimension'):
            return primary_provider.dimension
            
        raise EmbeddingError(f"Primary provider {type(primary_provider).__name__} does not have a get_embedding_dim method or a dimension attribute.")

    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        last_err = None
        for provider in self.providers:
            try:
                return provider.embed(texts, **kwargs)
            except Exception as e:
                last_err = e
                continue
        raise EmbeddingError(f"All embedding providers failed: {last_err}")

    async def _aembed_batch(self, texts: List[str], **kwargs) -> List[List[float]]:
        last_err = None
        for provider in self.providers:
            try:
                return await provider.aembed(texts, **kwargs)
            except Exception as e:
                last_err = e
                continue
        raise EmbeddingError(f"All embedding providers failed: {last_err}")

    def embed_text(self, text: str, **kwargs) -> List[float]:
        """嵌入单个文本"""
        result = self.embed([text], **kwargs)
        return result[0] if result else []

    def embed_texts(self, texts: List[str], **kwargs) -> List[List[float]]:
        """嵌入多个文本（别名方法）"""
        return self.embed(texts, **kwargs)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Embed a list of documents."""
        return self.embed_texts(texts)

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        """Embed a list of documents asynchronously."""
        return await self.aembed_texts(texts)

    def embed_query(self, text: str) -> list[float]:
        """Embed a query."""
        result = self.embed([text])
        return result[0] if result else []

    async def aembed_text(self, text: str, **kwargs) -> List[float]:
        """异步嵌入单个文本"""
        result = await self._aembed_batch([text], **kwargs)
        return result[0] if result else []

    async def aembed(self, text: str) -> list[float]:
        """Asynchronously embed a single text."""
        return await self.aembed_text(text)

    async def aembed_texts(self, texts: list[str]) -> list[list[float]]:
        """Asynchronously embed a list of texts."""
        return await self._aembed_batch(texts)