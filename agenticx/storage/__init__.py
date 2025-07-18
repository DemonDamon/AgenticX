"""
AgenticX Storage Module

统一的数据存储抽象层，参考camel设计，支持四种存储类型：
- Key-Value Storage: 键值存储 (Redis, SQLite, PostgreSQL, MongoDB)
- Vector Storage: 向量存储 (Milvus, Qdrant, FAISS, pgvector, Chroma, Weaviate)
- Graph Storage: 图存储 (Neo4j, Nebula Graph)
- Object Storage: 对象存储 (S3, GCS, Azure Blob)

设计原则：
1. 标准化数据模型 (VectorRecord, VectorDBQuery, VectorDBQueryResult)
2. 统一抽象接口 (BaseKeyValueStorage, BaseVectorStorage, BaseGraphStorage, BaseObjectStorage)
3. 完整存储生态 (支持主流数据库和云服务)
4. 易于扩展和维护
"""

# ========= Key-Value Storage =========
from .key_value_storages.base import BaseKeyValueStorage
from .key_value_storages.redis import RedisStorage
from .key_value_storages.sqlite import SQLiteStorage
from .key_value_storages.postgres import PostgresStorage
from .key_value_storages.mongodb import MongoDBStorage
from .key_value_storages.in_memory import InMemoryStorage

# ========= Vector Storage =========
from .vectordb_storages.base import (
    BaseVectorStorage,
    VectorRecord,
    VectorDBQuery,
    VectorDBQueryResult,
    VectorDBStatus
)
from .vectordb_storages.milvus import MilvusStorage
from .vectordb_storages.qdrant import QdrantStorage
from .vectordb_storages.faiss import FaissStorage
from .vectordb_storages.pgvector import PgVectorStorage
from .vectordb_storages.chroma import ChromaStorage
from .vectordb_storages.weaviate import WeaviateStorage
from .vectordb_storages.pinecone import PineconeStorage

# ========= Graph Storage =========
from .graph_storages.base import BaseGraphStorage
from .graph_storages.neo4j import Neo4jStorage
from .graph_storages.nebula import NebulaStorage

# ========= Object Storage =========
from .object_storages.base import BaseObjectStorage
from .object_storages.s3 import S3Storage
from .object_storages.gcs import GCSStorage
from .object_storages.azure import AzureStorage

# ========= Unified Storage Manager =========
from .manager import StorageManager, StorageConfig, StorageRouter, StorageType
from .migration import StorageMigration
from .errors import StorageError, ConnectionError, QueryError

__all__ = [
    # Key-Value Storage
    "BaseKeyValueStorage",
    "RedisStorage",
    "SQLiteStorage", 
    "PostgresStorage",
    "MongoDBStorage",
    "InMemoryStorage",
    
    # Vector Storage
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
    
    # Graph Storage
    "BaseGraphStorage",
    "Neo4jStorage",
    "NebulaStorage",
    
    # Object Storage
    "BaseObjectStorage",
    "S3Storage",
    "GCSStorage",
    "AzureStorage",
    
    # Manager & Utils
    "StorageManager",
    "StorageConfig",
    "StorageRouter",
    "StorageType",
    "StorageMigration",
    
    # Errors
    "StorageError",
    "ConnectionError",
    "QueryError",
] 