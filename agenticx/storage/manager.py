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
        import logging
        logger = logging.getLogger(__name__)
        
        logger.info(f"开始初始化 {len(self.configs)} 个存储配置")
        
        for i, config in enumerate(self.configs):
            try:
                logger.info(f"初始化存储 {i+1}: {config.storage_type.value}")
                storage = self._create_storage(config)
                # TODO: Implement async connect for different storage types
                self.storages.append(storage)
                
                # 检查存储类型和方法
                storage_methods = [method for method in dir(storage) if not method.startswith('_')]
                logger.debug(f"  存储方法: {storage_methods}")
                
                # 特别检查图存储方法
                if isinstance(storage, BaseGraphStorage):
                    if hasattr(storage, 'store_graph'):
                        logger.info(f"  ✅ 图存储方法可用: store_graph")
                    else:
                        logger.warning(f"  ❌ 图存储方法不可用: store_graph")
                    
            except Exception as e:
                logger.error(f"❌ 初始化存储 {i+1} 失败: {e}")
                raise
        
        self.router = StorageRouter(self.storages)
        self._initialized = True
        logger.info(f"✅ 存储管理器初始化完成，共 {len(self.storages)} 个存储实例")
    
    def get_storage(self, storage_type: StorageType) -> Optional[Union[BaseKeyValueStorage, BaseVectorStorage, BaseGraphStorage, BaseObjectStorage]]:
        """Get a storage instance by its StorageType enum."""
        if not self.initialized:
            return None
        for i, config in enumerate(self.configs):
            if config.storage_type == storage_type:
                if i < len(self.storages):
                    return self.storages[i]
        return None
    
    async def get_graph_storage(self, name: str = 'default') -> Optional['BaseGraphStorage']:
        """Get graph storage instance"""
        if not self._initialized:
            return None
        
        # Look for graph storage by checking if it's a BaseGraphStorage instance
        for storage in self.storages:
            # Check if it's a graph storage by looking for graph-specific methods
            if (hasattr(storage, 'store_graph') and 
                hasattr(storage, 'add_triplet') and 
                hasattr(storage, 'add_node')):
                return storage
        
        # If no graph storage found, return None
        return None
    
    async def get_vector_storage(self, name: str = 'default') -> Optional['BaseVectorStorage']:
        """Get vector storage instance"""
        if not self._initialized:
            return None
        
        # Look for vector storage
        for storage in self.storages:
            if hasattr(storage, 'add') and hasattr(storage, 'query'):  # Check if it's a vector storage
                return storage
        
        return None

    async def get_key_value_storage(self, name: str = 'default') -> Optional['BaseKeyValueStorage']:
        """Get key-value storage instance"""
        if not self._initialized:
            return None
        
        # Look for key-value storage
        for storage in self.storages:
            if hasattr(storage, 'set') and hasattr(storage, 'get'):  # Check if it's a key-value storage
                return storage
        
        return None
    
    def _create_storage(self, config: StorageConfig) -> Any:
        """Create a storage instance based on the provided configuration."""
        storage_type = config.storage_type

        # Key-Value Storage
        if config.storage_type == StorageType.REDIS:
            from .key_value_storages.redis import RedisStorage
            return RedisStorage(config)
        
        elif config.storage_type == StorageType.SQLITE:
            from .key_value_storages.sqlite import SQLiteStorage
            return SQLiteStorage(db_path=config.connection_string or "./agenticx.db")
        
        elif config.storage_type == StorageType.POSTGRES:
            from .key_value_storages.postgres import PostgresStorage
            if config.connection_string:
                conn_str = config.connection_string
            else:
                user = config.username or 'postgres'
                password = config.password or 'password'
                host = config.host or 'localhost'
                port = config.port or 5432
                db = config.database or 'agenticx'
                conn_str = f"postgresql://{user}:{password}@{host}:{port}/{db}"
            return PostgresStorage(connection_string=conn_str)
        
        elif config.storage_type == StorageType.MONGODB:
            from .key_value_storages.mongodb import MongoDBStorage
            return MongoDBStorage(connection_string=config.connection_string or "mongodb://localhost:27017/agenticx")
        
        elif config.storage_type == StorageType.IN_MEMORY:
            from .key_value_storages.in_memory import InMemoryStorage
            return InMemoryStorage()
        
        # Vector Storage
        elif config.storage_type == StorageType.FAISS:
            from .vectordb_storages.faiss import FaissStorage
            return FaissStorage(dimension=config.extra_params.get("dimension"))
        
        elif config.storage_type == StorageType.MILVUS:
            from .vectordb_storages.milvus import MilvusStorage
            # 处理嵌套的extra_params结构
            extra_params = config.extra_params
            if 'extra_params' in extra_params:
                extra_params = extra_params['extra_params']
            
            dimension = extra_params.get("dimension")
            if dimension is None:
                raise ValueError(f"Milvus storage requires 'dimension' parameter. Got: {config.extra_params}")
            return MilvusStorage(
                dimension=dimension,  # dimension作为第一个参数
                host=config.host or "localhost",
                port=config.port or 19530,
                collection_name=extra_params.get("collection_name", "agenticx_vectors"),
                **{k: v for k, v in extra_params.items() if k not in ["dimension", "collection_name"]}
            )
        
        elif config.storage_type == StorageType.QDRANT:
            from .vectordb_storages.qdrant import QdrantStorage
            return QdrantStorage(
                host=config.host or "localhost",
                port=config.port or 6333,
                dimension=config.extra_params.get("dimension")
            )
        
        elif config.storage_type == StorageType.PGVECTOR:
            from .vectordb_storages.pgvector import PgVectorStorage
            return PgVectorStorage(
                connection_string=config.connection_string or "",
                dimension=config.extra_params.get("dimension")
            )
        
        elif config.storage_type == StorageType.CHROMA:
            from .vectordb_storages.chroma import ChromaStorage
            return ChromaStorage(
                persist_directory=config.extra_params.get("persist_directory", "./chroma_db") or "./chroma_db",
                dimension=config.extra_params.get("dimension")
            )
        
        elif config.storage_type == StorageType.WEAVIATE:
            from .vectordb_storages.weaviate import WeaviateStorage
            return WeaviateStorage(
                url=config.connection_string or "http://localhost:8080",
                dimension=config.extra_params.get("dimension")
            )
        
        elif config.storage_type == StorageType.PINECONE:
            from .vectordb_storages.pinecone import PineconeStorage
            return PineconeStorage(
                api_key=config.extra_params.get("api_key") or "",
                environment=config.extra_params.get("environment") or "",
                index_name=config.extra_params.get("index_name") or "",
                dimension=config.extra_params.get("dimension")
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