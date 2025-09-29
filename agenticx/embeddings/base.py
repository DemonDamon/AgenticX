from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any

class EmbeddingError(Exception):
    """统一的嵌入服务异常类型"""
    pass

class BaseEmbeddingProvider(ABC):
    """嵌入服务的抽象基类"""
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}

    @abstractmethod
    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        """将文本列表转为向量列表"""
        pass
    
    async def aembed(self, texts: List[str], **kwargs) -> List[List[float]]:
        """Asynchronous embedding interface"""
        raise NotImplementedError("Provider does not support async embedding")