import requests
import asyncio
from typing import List, Optional
from .base import BaseEmbeddingProvider, EmbeddingError

class SiliconFlowEmbeddingProvider(BaseEmbeddingProvider):
    def __init__(self, api_key: str, model: str = "BAAI/bge-large-zh-v1.5", api_url: str = "https://api.siliconflow.cn/v1/embeddings", dimensions: Optional[int] = None, **kwargs):
        super().__init__(kwargs)
        self.api_key = api_key
        self.model = model
        self.api_url = api_url
        self.dimensions = dimensions

    def get_embedding_dim(self) -> int:
        """获取嵌入维度"""
        return self.dimensions or 1024  # 默认返回1024维度

    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        encoding_format = kwargs.get("encoding_format", "float")
        # 使用实例的dimensions或kwargs中的dimensions
        dimensions = kwargs.get("dimensions", self.dimensions)
        
        payload = {
            "model": self.model,
            "input": texts,  # 始终传递列表格式
            "encoding_format": encoding_format
        }
        if dimensions:
            payload["dimensions"] = dimensions
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        try:
            resp = requests.post(self.api_url, json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if "data" not in data:
                raise EmbeddingError(f"No 'data' in response: {data}")
            return [item["embedding"] for item in data["data"]]
        except Exception as e:
            raise EmbeddingError(f"SiliconFlow embedding error: {e}")

    async def aembed(self, texts: List[str], **kwargs) -> List[List[float]]:
        """异步embedding接口"""
        # 在线程池中运行同步的embed方法
        loop = asyncio.get_event_loop()
        # 使用 functools.partial 来正确传递 kwargs
        import functools
        func = functools.partial(self.embed, texts, **kwargs)
        return await loop.run_in_executor(None, func)