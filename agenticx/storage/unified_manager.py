"""
AgenticX Unified Storage Manager

统一存储管理器，整合四种存储类型：
- Key-Value Storage: 键值存储
- Vector Storage: 向量存储  
- Graph Storage: 图存储
- Object Storage: 对象存储

参考camel设计，提供统一的存储管理接口。
"""

from typing import Any, Dict, List, Optional, Union
from pathlib import Path, PurePath

from .key_value_storages.base import BaseKeyValueStorage
from .vectordb_storages.base import BaseVectorStorage, VectorRecord, VectorDBQuery
from .graph_storages.base import BaseGraphStorage
from .object_storages.base import BaseObjectStorage, File
from .errors import StorageError


class UnifiedStorageManager:
    """统一存储管理器
    
    整合四种存储类型，提供统一的存储管理接口。
    参考camel设计，支持完整的存储生态。
    """

    def __init__(
        self,
        kv_storage: Optional[BaseKeyValueStorage] = None,
        vector_storage: Optional[BaseVectorStorage] = None,
        graph_storage: Optional[BaseGraphStorage] = None,
        object_storage: Optional[BaseObjectStorage] = None,
    ):
        """初始化统一存储管理器
        
        Args:
            kv_storage: 键值存储实例
            vector_storage: 向量存储实例
            graph_storage: 图存储实例
            object_storage: 对象存储实例
        """
        self.kv_storage = kv_storage
        self.vector_storage = vector_storage
        self.graph_storage = graph_storage
        self.object_storage = object_storage

    # ========= Key-Value Storage Methods =========

    def kv_save(self, records: List[Dict[str, Any]]) -> None:
        """保存键值记录
        
        Args:
            records: 要保存的记录列表
        """
        if not self.kv_storage:
            raise StorageError("键值存储未配置")
        self.kv_storage.save(records)

    def kv_load(self) -> List[Dict[str, Any]]:
        """加载键值记录
        
        Returns:
            记录列表
        """
        if not self.kv_storage:
            raise StorageError("键值存储未配置")
        return self.kv_storage.load()

    def kv_get(self, key: str) -> Optional[Any]:
        """获取键值
        
        Args:
            key: 键名
            
        Returns:
            对应的值
        """
        if not self.kv_storage:
            raise StorageError("键值存储未配置")
        return self.kv_storage.get(key)

    def kv_set(self, key: str, value: Any) -> None:
        """设置键值
        
        Args:
            key: 键名
            value: 值
        """
        if not self.kv_storage:
            raise StorageError("键值存储未配置")
        self.kv_storage.set(key, value)

    def kv_delete(self, key: str) -> bool:
        """删除键值
        
        Args:
            key: 键名
            
        Returns:
            是否删除成功
        """
        if not self.kv_storage:
            raise StorageError("键值存储未配置")
        return self.kv_storage.delete(key)

    # ========= Vector Storage Methods =========

    def vector_add(self, records: List[VectorRecord]) -> None:
        """添加向量记录
        
        Args:
            records: 向量记录列表
        """
        if not self.vector_storage:
            raise StorageError("向量存储未配置")
        self.vector_storage.add(records)

    def vector_query(self, query: VectorDBQuery) -> List[Any]:
        """查询向量
        
        Args:
            query: 查询对象
            
        Returns:
            查询结果列表
        """
        if not self.vector_storage:
            raise StorageError("向量存储未配置")
        return self.vector_storage.query(query)

    def vector_delete(self, ids: List[str]) -> None:
        """删除向量
        
        Args:
            ids: 向量ID列表
        """
        if not self.vector_storage:
            raise StorageError("向量存储未配置")
        self.vector_storage.delete(ids)

    def vector_status(self) -> Any:
        """获取向量存储状态
        
        Returns:
            存储状态
        """
        if not self.vector_storage:
            raise StorageError("向量存储未配置")
        return self.vector_storage.status()

    # ========= Graph Storage Methods =========

    def graph_add_triplet(self, subj: str, obj: str, rel: str) -> None:
        """添加三元组
        
        Args:
            subj: 主体
            obj: 客体
            rel: 关系
        """
        if not self.graph_storage:
            raise StorageError("图存储未配置")
        self.graph_storage.add_triplet(subj, obj, rel)

    def graph_query(self, query: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """图查询
        
        Args:
            query: 查询语句
            params: 查询参数
            
        Returns:
            查询结果列表
        """
        if not self.graph_storage:
            raise StorageError("图存储未配置")
        return self.graph_storage.query(query, params)

    def graph_add_node(self, node_id: str, properties: Optional[Dict[str, Any]] = None) -> None:
        """添加节点
        
        Args:
            node_id: 节点ID
            properties: 节点属性
        """
        if not self.graph_storage:
            raise StorageError("图存储未配置")
        self.graph_storage.add_node(node_id, properties)

    def graph_add_edge(
        self, 
        from_node: str, 
        to_node: str, 
        edge_type: str, 
        properties: Optional[Dict[str, Any]] = None
    ) -> None:
        """添加边
        
        Args:
            from_node: 起始节点
            to_node: 目标节点
            edge_type: 边类型
            properties: 边属性
        """
        if not self.graph_storage:
            raise StorageError("图存储未配置")
        self.graph_storage.add_edge(from_node, to_node, edge_type, properties)

    # ========= Object Storage Methods =========

    def object_put_file(self, file_path: PurePath, file: File) -> None:
        """上传文件
        
        Args:
            file_path: 文件路径
            file: 文件对象
        """
        if not self.object_storage:
            raise StorageError("对象存储未配置")
        self.object_storage.put_file(file_path, file)

    def object_get_file(self, file_path: PurePath) -> File:
        """下载文件
        
        Args:
            file_path: 文件路径
            
        Returns:
            文件对象
        """
        if not self.object_storage:
            raise StorageError("对象存储未配置")
        return self.object_storage.get_file(file_path)

    def object_upload_file(self, local_file_path: Path, remote_file_path: PurePath) -> None:
        """上传本地文件
        
        Args:
            local_file_path: 本地文件路径
            remote_file_path: 远程文件路径
        """
        if not self.object_storage:
            raise StorageError("对象存储未配置")
        self.object_storage.upload_file(local_file_path, remote_file_path)

    def object_download_file(self, local_file_path: Path, remote_file_path: PurePath) -> None:
        """下载文件到本地
        
        Args:
            local_file_path: 本地文件路径
            remote_file_path: 远程文件路径
        """
        if not self.object_storage:
            raise StorageError("对象存储未配置")
        self.object_storage.download_file(local_file_path, remote_file_path)

    def object_list(self, prefix: str = "") -> List[str]:
        """列出对象
        
        Args:
            prefix: 前缀
            
        Returns:
            对象列表
        """
        if not self.object_storage:
            raise StorageError("对象存储未配置")
        return self.object_storage.list_objects(prefix)

    # ========= Unified Methods =========

    def get_storage_info(self) -> Dict[str, Any]:
        """获取存储信息
        
        Returns:
            存储信息字典
        """
        info: Dict[str, Any] = {
            "kv_storage": self.kv_storage is not None,
            "vector_storage": self.vector_storage is not None,
            "graph_storage": self.graph_storage is not None,
            "object_storage": self.object_storage is not None,
        }
        
        if self.vector_storage:
            try:
                status = self.vector_storage.status()
                info["vector_status"] = {
                    "dimension": status.vector_dim,
                    "count": status.vector_count
                }
            except Exception as e:
                info["vector_status"] = {"error": str(e)}
        
        return info

    def close_all(self) -> None:
        """关闭所有存储连接"""
        if self.kv_storage:
            self.kv_storage.close()
        if self.vector_storage:
            self.vector_storage.close()
        if self.graph_storage:
            self.graph_storage.close()
        if self.object_storage:
            self.object_storage.close()

    def __enter__(self):
        """上下文管理器入口"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口"""
        self.close_all() 