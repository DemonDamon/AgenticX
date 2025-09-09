"""
Storage manager and configuration

参考camel设计，支持四层存储架构的统一管理。
"""

from typing import Any, Dict, List, Optional, Union
from enum import Enum

from .key_value_storages.base import BaseKeyValueStorage
from .vectordb_storages.base import BaseVectorStorage
from .graph_storages.base import BaseGraphStorage
from .object_storages.base import BaseObjectStorage
from .errors import StorageError


class StorageType(str, Enum):
    """Storage type enumeration"""
    # Key-Value Storage
    REDIS = "redis"
    SQLITE = "sqlite"
    POSTGRES = "postgres"
    MONGODB = "mongodb"
    IN_MEMORY = "in_memory"
    
    # Vector Storage
    FAISS = "faiss"
    MILVUS = "milvus"
    QDRANT = "qdrant"
    PGVECTOR = "pgvector"
    CHROMA = "chroma"
    WEAVIATE = "weaviate"
    PINECONE = "pinecone"
    
    # Graph Storage
    NEO4J = "neo4j"
    NEBULA = "nebula"
    
    # Object Storage
    S3 = "s3"
    GCS = "gcs"
    AZURE = "azure"


class StorageConfig:
    """Storage configuration model"""
    
    def __init__(
        self,
        storage_type: StorageType,
        connection_string: Optional[str] = None,
        host: Optional[str] = None,
        port: Optional[int] = None,
        database: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        pool_size: int = 10,
        max_overflow: int = 20,
        timeout: int = 30,
        retry_attempts: int = 3,
        retry_delay: float = 1.0,
        **kwargs
    ):
        self.storage_type = storage_type
        self.connection_string = connection_string
        self.host = host
        self.port = port
        self.database = database
        self.username = username
        self.password = password
        self.pool_size = pool_size
        self.max_overflow = max_overflow
        self.timeout = timeout
        self.retry_attempts = retry_attempts
        self.retry_delay = retry_delay
        self.extra_params = kwargs
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary"""
        return {
            "storage_type": self.storage_type.value,
            "connection_string": self.connection_string,
            "host": self.host,
            "port": self.port,
            "database": self.database,
            "username": self.username,
            "password": self.password,
            "pool_size": self.pool_size,
            "max_overflow": self.max_overflow,
            "timeout": self.timeout,
            "retry_attempts": self.retry_attempts,
            "retry_delay": self.retry_delay,
            **self.extra_params
        }
    
    @classmethod
    def from_dict(cls, config_dict: Dict[str, Any]) -> 'StorageConfig':
        """Create config from dictionary"""
        storage_type = StorageType(config_dict.get("storage_type", "postgres"))
        
        return cls(
            storage_type=storage_type,
            connection_string=config_dict.get("connection_string"),
            host=config_dict.get("host"),
            port=config_dict.get("port"),
            database=config_dict.get("database"),
            username=config_dict.get("username"),
            password=config_dict.get("password"),
            pool_size=config_dict.get("pool_size", 10),
            max_overflow=config_dict.get("max_overflow", 20),
            timeout=config_dict.get("timeout", 30),
            retry_attempts=config_dict.get("retry_attempts", 3),
            retry_delay=config_dict.get("retry_delay", 1.0),
            **{k: v for k, v in config_dict.items() if k not in [
                "storage_type", "connection_string", "host", "port", "database",
                "username", "password", "pool_size", "max_overflow",
                "timeout", "retry_attempts", "retry_delay"
            ]}
        )


class StorageRouter:
    """Storage router for intelligent storage selection"""
    
    def __init__(self, storages: List[Union[BaseKeyValueStorage, BaseVectorStorage, BaseGraphStorage, BaseObjectStorage]]):
        self.storages = storages
        self._active_storage: Optional[Union[BaseKeyValueStorage, BaseVectorStorage, BaseGraphStorage, BaseObjectStorage]] = None
    
    @property
    def active_storage(self) -> Optional[Union[BaseKeyValueStorage, BaseVectorStorage, BaseGraphStorage, BaseObjectStorage]]:
        """Get active storage"""
        return self._active_storage
    
    def select_storage(self, operation: str, data_type: str = "session") -> Union[BaseKeyValueStorage, BaseVectorStorage, BaseGraphStorage, BaseObjectStorage]:
        """Select appropriate storage for operation"""
        # Simple selection logic - can be enhanced with ML-based selection
        if not self.storages:
            raise StorageError("No storages available")
        
        # For now, return the first available storage
        # TODO: Implement intelligent storage selection based on:
        # - Operation type (read/write/vector_search)
        # - Data type (session/document/vector)
        # - Storage capabilities
        # - Current load and performance
        return self.storages[0]
    
    async def health_check(self) -> Dict[str, Any]:
        """Check health of all storages"""
        results = {}
        for i, storage in enumerate(self.storages):
            try:
                # TODO: Implement health check for different storage types
                results[f"storage_{i}"] = {"status": "unknown", "type": type(storage).__name__}
            except Exception as e:
                results[f"storage_{i}"] = {"status": "error", "error": str(e)}
        return results


class StorageManager:
    """Unified storage manager"""
    
    def __init__(self, configs: List[StorageConfig]):
        self.configs = configs
        self.storages: List[Union[BaseKeyValueStorage, BaseVectorStorage, BaseGraphStorage, BaseObjectStorage]] = []
        self.router: Optional[StorageRouter] = None
        self._initialized = False
    
    async def initialize(self) -> None:
        """Initialize all storages"""
        for config in self.configs:
            storage = self._create_storage(config)
            # TODO: Implement async connect for different storage types
            self.storages.append(storage)
        
        self.router = StorageRouter(self.storages)
        self._initialized = True
    
    def _create_storage(self, config: StorageConfig) -> Union[BaseKeyValueStorage, BaseVectorStorage, BaseGraphStorage, BaseObjectStorage]:
        """Create storage instance from config"""
        
        # Key-Value Storage
        if config.storage_type == StorageType.REDIS:
            from .key_value_storages.redis import RedisStorage
            return RedisStorage(redis_url=config.connection_string or "redis://localhost:6379")
        
        elif config.storage_type == StorageType.SQLITE:
            from .key_value_storages.sqlite import SQLiteStorage
            return SQLiteStorage(db_path=config.connection_string or "./agenticx.db")
        
        elif config.storage_type == StorageType.POSTGRES:
            from .key_value_storages.postgres import PostgresStorage
            return PostgresStorage(connection_string=config.connection_string or "postgresql://localhost:5432/agenticx")
        
        elif config.storage_type == StorageType.MONGODB:
            from .key_value_storages.mongodb import MongoDBStorage
            return MongoDBStorage(connection_string=config.connection_string or "mongodb://localhost:27017/agenticx")
        
        elif config.storage_type == StorageType.IN_MEMORY:
            from .key_value_storages.in_memory import InMemoryStorage
            return InMemoryStorage()
        
        # Vector Storage
        elif config.storage_type == StorageType.FAISS:
            from .vectordb_storages.faiss import FaissStorage
            return FaissStorage(dimension=config.extra_params.get("dimension", 768))
        
        elif config.storage_type == StorageType.MILVUS:
            from .vectordb_storages.milvus import MilvusStorage
            return MilvusStorage(
                host=config.host or "localhost",
                port=config.port or 19530,
                dimension=config.extra_params.get("dimension", 768)
            )
        
        elif config.storage_type == StorageType.QDRANT:
            from .vectordb_storages.qdrant import QdrantStorage
            return QdrantStorage(
                host=config.host or "localhost",
                port=config.port or 6333,
                dimension=config.extra_params.get("dimension", 768)
            )
        
        elif config.storage_type == StorageType.PGVECTOR:
            from .vectordb_storages.pgvector import PgVectorStorage
            return PgVectorStorage(
                connection_string=config.connection_string or "",
                dimension=config.extra_params.get("dimension", 768)
            )
        
        elif config.storage_type == StorageType.CHROMA:
            from .vectordb_storages.chroma import ChromaStorage
            return ChromaStorage(
                persist_directory=config.extra_params.get("persist_directory", "./chroma_db") or "./chroma_db",
                dimension=config.extra_params.get("dimension", 768)
            )
        
        elif config.storage_type == StorageType.WEAVIATE:
            from .vectordb_storages.weaviate import WeaviateStorage
            return WeaviateStorage(
                url=config.connection_string or "http://localhost:8080",
                dimension=config.extra_params.get("dimension", 768)
            )
        
        elif config.storage_type == StorageType.PINECONE:
            from .vectordb_storages.pinecone import PineconeStorage
            return PineconeStorage(
                api_key=config.extra_params.get("api_key") or "",
                environment=config.extra_params.get("environment") or "",
                index_name=config.extra_params.get("index_name") or "",
                dimension=config.extra_params.get("dimension", 768)
            )
        
        # Graph Storage
        elif config.storage_type == StorageType.NEO4J:
            from .graph_storages.neo4j import Neo4jStorage
            return Neo4jStorage(
                uri=config.connection_string or "bolt://localhost:7687",
                username=config.username or "neo4j",
                password=config.password or "password"
            )
        
        elif config.storage_type == StorageType.NEBULA:
            from .graph_storages.nebula import NebulaStorage
            return NebulaStorage(
                host=config.host or "localhost",
                port=config.port or 9669,
                username=config.username or "root",
                password=config.password or "nebula"
            )
        
        # Object Storage
        elif config.storage_type == StorageType.S3:
            from .object_storages.s3 import S3Storage
            return S3Storage(
                bucket_name=config.extra_params.get("bucket_name") or "",
                aws_access_key_id=config.username or "",
                aws_secret_access_key=config.password or "",
                region_name=config.extra_params.get("region_name", "us-east-1")
            )
        
        elif config.storage_type == StorageType.GCS:
            from .object_storages.gcs import GCSStorage
            return GCSStorage(
                bucket_name=config.extra_params.get("bucket_name") or "",
                credentials_path=config.extra_params.get("credentials_path") or ""
            )
        
        elif config.storage_type == StorageType.AZURE:
            from .object_storages.azure import AzureStorage
            return AzureStorage(
                container_name=config.extra_params.get("container_name") or "",
                connection_string=config.connection_string or ""
            )
        
        else:
            raise StorageError(f"Unsupported storage type: {config.storage_type}")
    
    async def close(self) -> None:
        """Close all storages"""
        for storage in self.storages:
            try:
                storage.close()
            except Exception as e:
                print(f"Error closing storage {type(storage).__name__}: {e}")
        self.storages.clear()
        self._initialized = False
    
    @property
    def initialized(self) -> bool:
        """Check if manager is initialized"""
        return self._initialized
    
    async def get_statistics(self) -> Dict[str, Any]:
        """Get statistics from all storages"""
        if not self._initialized:
            return {"error": "Storage manager not initialized"}
        
        stats = {}
        for i, storage in enumerate(self.storages):
            try:
                # TODO: Implement statistics for different storage types
                stats[f"storage_{i}"] = {
                    "type": type(storage).__name__,
                    "status": "unknown"
                }
            except Exception as e:
                stats[f"storage_{i}"] = {"error": str(e)}
        
        return stats 