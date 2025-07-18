"""
AgenticX Vector Database Storage Module

向量数据库存储抽象层，支持Milvus、Qdrant、FAISS、pgvector、Chroma、Weaviate等。
参考camel设计，提供标准化的向量存储接口。
"""

from .base import (
    BaseVectorStorage,
    VectorRecord,
    VectorDBQuery,
    VectorDBQueryResult,
    VectorDBStatus
)
from .milvus import MilvusStorage
from .qdrant import QdrantStorage
from .faiss import FaissStorage
from .pgvector import PgVectorStorage
from .chroma import ChromaStorage
from .weaviate import WeaviateStorage
from .pinecone import PineconeStorage

__all__ = [
    "BaseVectorStorage",
    "VectorRecord",
    "VectorDBQuery",
    "VectorDBQueryResult", 
    "VectorDBStatus",
    "MilvusStorage",
    "QdrantStorage",
    "FaissStorage",
    "PgVectorStorage",
    "ChromaStorage",
    "WeaviateStorage",
    "PineconeStorage",
] 