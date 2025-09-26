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
    
    def embed_text(self, text: str, **kwargs) -> List[float]:
        """嵌入单个文本"""
        result = self.embed([text], **kwargs)
        return result[0] if result else []
    
    def embed_texts(self, texts: List[str], **kwargs) -> List[List[float]]:
        """嵌入多个文本（别名方法）"""
        return self.embed(texts, **kwargs)
    
    async def aembed(self, texts: List[str], **kwargs) -> List[List[float]]:
        """异步嵌入多个文本"""
        target_dim = self.get_embedding_dim()
        last_err = None
        for provider in self.providers:
            try:
                embeddings = await provider.aembed(texts, **kwargs)
                # 检查并修正维度
                for i, emb in enumerate(embeddings):
                    if len(emb) != target_dim:
                        # 在这里可以添加更复杂的处理逻辑，例如填充或截断
                        # 为了简单起见，我们只记录一个警告
                        print(f"Warning: Embedding from {type(provider).__name__} has incorrect dimension. Expected {target_dim}, got {len(emb)}.")
                        # 简单的截断/填充
                        if len(emb) > target_dim:
                            embeddings[i] = emb[:target_dim]
                        else:
                            embeddings[i] = emb + [0.0] * (target_dim - len(emb))
                return embeddings
            except Exception as e:
                last_err = e
                continue
        raise EmbeddingError(f"All embedding providers failed: {last_err}")
    
    async def aembed_text(self, text: str, **kwargs) -> List[float]:
        """异步嵌入单个文本"""
        result = await self.aembed([text], **kwargs)
        return result[0] if result else []
    
    async def aembed_texts(self, texts: List[str], **kwargs) -> List[List[float]]:
        """异步嵌入多个文本（别名方法）"""
        return await self.aembed(texts, **kwargs)