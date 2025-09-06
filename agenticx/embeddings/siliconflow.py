import requests
from typing import List, Optional
from .base import BaseEmbeddingProvider, EmbeddingError

class SiliconFlowEmbeddingProvider(BaseEmbeddingProvider):
    def __init__(self, api_key: str, model: str = "BAAI/bge-large-zh-v1.5", api_url: str = "https://api.siliconflow.cn/v1/embeddings", **kwargs):
        super().__init__(kwargs)
        self.api_key = api_key
        self.model = model
        self.api_url = api_url

    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        encoding_format = kwargs.get("encoding_format", "float")
        dimensions = kwargs.get("dimensions", None)
        
        payload = {
            "model": self.model,
            "input": texts if len(texts) > 1 else texts[0],
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