"""
Storage module error types
"""

from typing import Optional


class StorageError(Exception):
    """Base exception for storage operations"""
    
    def __init__(self, message: str, storage_type: Optional[str] = None, operation: Optional[str] = None):
        self.message = message
        self.storage_type = storage_type
        self.operation = operation
        super().__init__(self.message)
    
    def __str__(self):
        error_msg = f"Storage error: {self.message}"
        if self.storage_type:
            error_msg += f" (Storage: {self.storage_type})"
        if self.operation:
            error_msg += f" (Operation: {self.operation})"
        return error_msg


class ConnectionError(StorageError):
    """Exception raised for connection-related errors"""
    
    def __init__(self, message: str, storage_type: Optional[str] = None, connection_string: Optional[str] = None):
        self.connection_string = connection_string
        super().__init__(message, storage_type, "connection")
    
    def __str__(self):
        error_msg = f"Connection error: {self.message}"
        if self.storage_type:
            error_msg += f" (Storage: {self.storage_type})"
        if self.connection_string:
            # 隐藏敏感信息
            safe_conn = self.connection_string.split('@')[0] if '@' in self.connection_string else self.connection_string
            error_msg += f" (Connection: {safe_conn})"
        return error_msg


class QueryError(StorageError):
    """Exception raised for query-related errors"""
    
    def __init__(self, message: str, storage_type: Optional[str] = None, query: Optional[str] = None):
        self.query = query
        super().__init__(message, storage_type, "query")
    
    def __str__(self):
        error_msg = f"Query error: {self.message}"
        if self.storage_type:
            error_msg += f" (Storage: {self.storage_type})"
        if self.query:
            # 限制查询长度显示
            query_preview = self.query[:100] + "..." if len(self.query) > 100 else self.query
            error_msg += f" (Query: {query_preview})"
        return error_msg


class SchemaError(StorageError):
    """Exception raised for schema-related errors"""
    
    def __init__(self, message: str, storage_type: Optional[str] = None, schema_version: Optional[int] = None):
        self.schema_version = schema_version
        super().__init__(message, storage_type, "schema")
    
    def __str__(self):
        error_msg = f"Schema error: {self.message}"
        if self.storage_type:
            error_msg += f" (Storage: {self.storage_type})"
        if self.schema_version:
            error_msg += f" (Version: {self.schema_version})"
        return error_msg


class MigrationError(StorageError):
    """Exception raised for migration-related errors"""
    
    def __init__(self, message: str, storage_type: Optional[str] = None, from_version: Optional[int] = None, to_version: Optional[int] = None):
        self.from_version = from_version
        self.to_version = to_version
        super().__init__(message, storage_type, "migration")
    
    def __str__(self):
        error_msg = f"Migration error: {self.message}"
        if self.storage_type:
            error_msg += f" (Storage: {self.storage_type})"
        if self.from_version and self.to_version:
            error_msg += f" (Version: {self.from_version} -> {self.to_version})"
        return error_msg


class VectorError(StorageError):
    """Exception raised for vector-related errors"""
    
    def __init__(self, message: str, storage_type: Optional[str] = None, dimension: Optional[int] = None):
        self.dimension = dimension
        super().__init__(message, storage_type, "vector")
    
    def __str__(self):
        error_msg = f"Vector error: {self.message}"
        if self.storage_type:
            error_msg += f" (Storage: {self.storage_type})"
        if self.dimension:
            error_msg += f" (Dimension: {self.dimension})"
        return error_msg


class IndexError(StorageError):
    """Exception raised for index-related errors"""
    
    def __init__(self, message: str, storage_type: Optional[str] = None, index_type: Optional[str] = None):
        self.index_type = index_type
        super().__init__(message, storage_type, "index")
    
    def __str__(self):
        error_msg = f"Index error: {self.message}"
        if self.storage_type:
            error_msg += f" (Storage: {self.storage_type})"
        if self.index_type:
            error_msg += f" (Index: {self.index_type})"
        return error_msg 