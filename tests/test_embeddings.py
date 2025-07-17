import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest

from agenticx.embeddings.siliconflow import SiliconFlowEmbeddingProvider
from agenticx.embeddings.router import EmbeddingRouter

class MockSiliconFlowProvider(SiliconFlowEmbeddingProvider):
    def __init__(self):
        pass
    def embed(self, texts, **kwargs):
        # 返回固定向量，便于测试
        return [[float(i)] * 5 for i, _ in enumerate(texts)]

def test_siliconflow_embed():
    provider = MockSiliconFlowProvider()
    result = provider.embed(["你好", "世界"])
    assert len(result) == 2
    assert all(len(vec) == 5 for vec in result)

def test_router_fallback():
    class FailingProvider:
        def embed(self, texts, **kwargs):
            raise Exception("fail")
    router = EmbeddingRouter([FailingProvider(), MockSiliconFlowProvider()])
    result = router.embed(["a", "b"])
    assert len(result) == 2 