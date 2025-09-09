"""
Storage migration utilities
"""

from typing import Any, Dict, List, Optional, cast
from datetime import datetime

from .base import BaseStorage, BaseVectorStorage
from .models import StorageSession, StorageDocument, StorageVector
from .errors import MigrationError


class StorageMigration:
    """Storage migration utility"""
    
    def __init__(self, source_storage: BaseStorage, target_storage: BaseStorage):
        self.source_storage = source_storage
        self.target_storage = target_storage
        self.migration_log: List[Dict[str, Any]] = []
    
    async def migrate_sessions(
        self, 
        user_id: Optional[str] = None,
        batch_size: int = 100,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """Migrate sessions from source to target storage"""
        try:
            # Get sessions from source
            sessions = await self.source_storage.list_sessions(user_id=user_id)
            
            if dry_run:
                return {
                    "operation": "migrate_sessions",
                    "status": "dry_run",
                    "total_sessions": len(sessions),
                    "source_storage": str(type(self.source_storage).__name__),
                    "target_storage": str(type(self.target_storage).__name__)
                }
            
            migrated_count = 0
            failed_count = 0
            
            for session in sessions:
                try:
                    await self.target_storage.create_session(session)
                    migrated_count += 1
                    self.migration_log.append({
                        "timestamp": datetime.now().isoformat(),
                        "operation": "migrate_session",
                        "session_id": session.session_id,
                        "status": "success"
                    })
                except Exception as e:
                    failed_count += 1
                    self.migration_log.append({
                        "timestamp": datetime.now().isoformat(),
                        "operation": "migrate_session",
                        "session_id": session.session_id,
                        "status": "failed",
                        "error": str(e)
                    })
            
            return {
                "operation": "migrate_sessions",
                "status": "completed",
                "total_sessions": len(sessions),
                "migrated_count": migrated_count,
                "failed_count": failed_count,
                "source_storage": str(type(self.source_storage).__name__),
                "target_storage": str(type(self.target_storage).__name__)
            }
            
        except Exception as e:
            raise MigrationError(
                f"Failed to migrate sessions: {str(e)}",
                storage_type=str(type(self.source_storage).__name__),
                from_version=1,
                to_version=1
            )
    
    async def migrate_documents(
        self,
        collection: str,
        batch_size: int = 100,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """Migrate documents from source to target storage"""
        try:
            # Get documents from source
            documents = await self.source_storage.list_documents(collection)
            
            if dry_run:
                return {
                    "operation": "migrate_documents",
                    "status": "dry_run",
                    "collection": collection,
                    "total_documents": len(documents),
                    "source_storage": str(type(self.source_storage).__name__),
                    "target_storage": str(type(self.target_storage).__name__)
                }
            
            migrated_count = 0
            failed_count = 0
            
            for document in documents:
                try:
                    await self.target_storage.create_document(document)
                    migrated_count += 1
                    self.migration_log.append({
                        "timestamp": datetime.now().isoformat(),
                        "operation": "migrate_document",
                        "document_id": document.document_id,
                        "collection": collection,
                        "status": "success"
                    })
                except Exception as e:
                    failed_count += 1
                    self.migration_log.append({
                        "timestamp": datetime.now().isoformat(),
                        "operation": "migrate_document",
                        "document_id": document.document_id,
                        "collection": collection,
                        "status": "failed",
                        "error": str(e)
                    })
            
            return {
                "operation": "migrate_documents",
                "status": "completed",
                "collection": collection,
                "total_documents": len(documents),
                "migrated_count": migrated_count,
                "failed_count": failed_count,
                "source_storage": str(type(self.source_storage).__name__),
                "target_storage": str(type(self.target_storage).__name__)
            }
            
        except Exception as e:
            raise MigrationError(
                f"Failed to migrate documents: {str(e)}",
                storage_type=str(type(self.source_storage).__name__),
                from_version=1,
                to_version=1
            )
    
    async def migrate_vectors(
        self,
        collection: str,
        batch_size: int = 100,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """Migrate vectors from source to target storage"""
        try:
            # Check if source storage supports vectors
            if not hasattr(self.source_storage, 'list_vectors'):
                raise MigrationError(
                    "Source storage does not support vector operations",
                    storage_type=str(type(self.source_storage).__name__)
                )
            
            # Check if target storage supports vectors
            if not hasattr(self.target_storage, 'list_vectors'):
                raise MigrationError(
                    "Target storage does not support vector operations",
                    storage_type=str(type(self.target_storage).__name__)
                )
            
            # Cast to BaseVectorStorage for type checking
            source_vector_storage = cast(BaseVectorStorage, self.source_storage)
            target_vector_storage = cast(BaseVectorStorage, self.target_storage)
            
            # Get vectors from source
            vectors = await source_vector_storage.list_vectors(collection)
            
            if dry_run:
                return {
                    "operation": "migrate_vectors",
                    "status": "dry_run",
                    "collection": collection,
                    "total_vectors": len(vectors),
                    "source_storage": str(type(self.source_storage).__name__),
                    "target_storage": str(type(self.target_storage).__name__)
                }
            
            migrated_count = 0
            failed_count = 0
            
            for vector in vectors:
                try:
                    await target_vector_storage.create_vector(vector)
                    migrated_count += 1
                    self.migration_log.append({
                        "timestamp": datetime.now().isoformat(),
                        "operation": "migrate_vector",
                        "vector_id": vector.vector_id,
                        "collection": collection,
                        "status": "success"
                    })
                except Exception as e:
                    failed_count += 1
                    self.migration_log.append({
                        "timestamp": datetime.now().isoformat(),
                        "operation": "migrate_vector",
                        "vector_id": vector.vector_id,
                        "collection": collection,
                        "status": "failed",
                        "error": str(e)
                    })
            
            return {
                "operation": "migrate_vectors",
                "status": "completed",
                "collection": collection,
                "total_vectors": len(vectors),
                "migrated_count": migrated_count,
                "failed_count": failed_count,
                "source_storage": str(type(self.source_storage).__name__),
                "target_storage": str(type(self.target_storage).__name__)
            }
            
        except Exception as e:
            raise MigrationError(
                f"Failed to migrate vectors: {str(e)}",
                storage_type=str(type(self.source_storage).__name__),
                from_version=1,
                to_version=1
            )
    
    async def validate_migration(self, data_type: str = "sessions") -> Dict[str, Any]:
        """Validate migration by comparing source and target data"""
        try:
            if data_type == "sessions":
                source_sessions = await self.source_storage.list_sessions()
                target_sessions = await self.target_storage.list_sessions()
                
                source_count = len(source_sessions)
                target_count = len(target_sessions)
                
                return {
                    "data_type": "sessions",
                    "source_count": source_count,
                    "target_count": target_count,
                    "match": source_count == target_count,
                    "difference": abs(source_count - target_count)
                }
            
            elif data_type == "documents":
                # This would need collection parameter
                return {"error": "Document validation requires collection parameter"}
            
            elif data_type == "vectors":
                # This would need collection parameter
                return {"error": "Vector validation requires collection parameter"}
            
            else:
                return {"error": f"Unknown data type: {data_type}"}
                
        except Exception as e:
            return {"error": f"Validation failed: {str(e)}"}
    
    def get_migration_log(self) -> List[Dict[str, Any]]:
        """Get migration log"""
        return self.migration_log
    
    def clear_migration_log(self) -> None:
        """Clear migration log"""
        self.migration_log.clear()