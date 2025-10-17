"""
AgenticX × MinerU 后端适配层

提供统一的文档解析适配器接口，支持本地 pipeline 和远程 VLM HTTP 客户端。
"""

from .base import DocumentAdapter, ParsedArtifacts
from .pipeline import PipelineAdapter
from .vlm_client import VLMHttpClientAdapter
from .utils import PageRangeParser
from .mineru import MinerUAdapter, BackendType, ParseResult

__all__ = [
    "DocumentAdapter",
    "ParsedArtifacts", 
    "PipelineAdapter",
    "VLMHttpClientAdapter",
    "PageRangeParser",
    "MinerUAdapter",
    "BackendType",
    "ParseResult",
]