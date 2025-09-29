"""
AgenticX Vector Database Storage Base Class

参考camel设计，提供标准化的向量存储抽象接口和数据模型。
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class VectorRecord(BaseModel):
    """向量记录模型
    
    封装向量的唯一标识符和载荷信息，主要用于向量存储的数据传输对象。
    
    Attributes:
        vector: 向量的数值表示
        id: 向量的唯一标识符，如果不提供则自动生成UUID
        payload: 与向量相关的额外元数据或信息
    """
    
    vector: List[float]
    id: str = Field(default_factory=lambda: str(uuid4()))
    payload: Optional[Dict[str, Any]] = None


class VectorDBQuery(BaseModel):
    """向量数据库查询模型
    
    表示对向量数据库的查询。
    
    Attributes:
        query_vector: 查询向量的数值表示
        top_k: 从数据库中检索的相似向量数量，默认为1
    """
    
    query_vector: List[float]
    """查询向量的数值表示"""
    top_k: int = 1
    """从数据库中检索的相似向量数量"""

    def __init__(self, query_vector: List[float], top_k: int = 1, **kwargs: Any) -> None:
        """初始化查询
        
        Args:
            query_vector: 查询向量的数值表示
            top_k: 要检索的相似向量数量，默认为1
        """
        super().__init__(query_vector=query_vector, top_k=top_k, **kwargs)


class VectorDBQueryResult(BaseModel):
    """向量数据库查询结果模型
    
    封装向量数据库查询的结果。
    
    Attributes:
        record: 目标向量记录
        similarity: 查询向量与记录之间的相似度分数
    """
    
    record: VectorRecord
    similarity: float

    @classmethod
    def create(
        cls,
        similarity: float,
        vector: List[float],
        id: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> "VectorDBQueryResult":
        """创建VectorDBQueryResult实例的类方法"""
        return cls(
            record=VectorRecord(
                vector=vector,
                id=id,
                payload=payload,
            ),
            similarity=similarity,
        )


class VectorDBStatus(BaseModel):
    """向量数据库状态模型
    
    Attributes:
        vector_dim: 存储向量的维度
        vector_count: 存储向量的数量
    """
    
    vector_dim: int
    vector_count: int


class BaseVectorStorage(ABC):
    """向量存储抽象基类
    
    参考camel设计，提供统一的向量存储接口。
    """

    @abstractmethod
    async def add(self, records: List[VectorRecord], **kwargs: Any) -> None:
        """保存向量记录列表到存储
        
        Args:
            records: 要保存的向量记录列表
            **kwargs: 额外的关键字参数
            
        Raises:
            RuntimeError: 保存过程中出现错误时抛出
        """
        pass

    @abstractmethod
    def delete(self, ids: List[str], **kwargs: Any) -> None:
        """根据ID列表删除向量
        
        Args:
            ids: 要删除的向量的唯一标识符列表
            **kwargs: 额外的关键字参数
            
        Raises:
            RuntimeError: 删除过程中出现错误时抛出
        """
        pass

    @abstractmethod
    def status(self) -> VectorDBStatus:
        """返回向量数据库状态
        
        Returns:
            向量数据库状态
        """
        pass

    @abstractmethod
    def query(self, query: VectorDBQuery, **kwargs: Any) -> List[VectorDBQueryResult]:
        """基于提供的查询搜索相似向量
        
        Args:
            query: 包含搜索向量和要检索的相似向量数量的查询对象
            **kwargs: 额外的关键字参数
            
        Returns:
            基于与查询向量相似性从存储中检索的向量列表
        """
        pass

    @abstractmethod
    def clear(self) -> None:
        """清空存储中的所有向量"""
        pass

    @abstractmethod
    def load(self) -> None:
        """加载云服务上托管的集合"""
        pass

    @property
    @abstractmethod
    def client(self) -> Any:
        """提供对底层向量数据库客户端的访问"""
        pass

    def get_payloads_by_vector(
        self,
        vector: List[float],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        """返回与给定向量最接近的top_k个向量记录的载荷
        
        Args:
            vector: 查询向量
            top_k: 要检索的相似向量数量
            
        Returns:
            载荷字典列表
        """
        query = VectorDBQuery(query_vector=vector, top_k=top_k)
        results = self.query(query)
        return [result.record.payload for result in results if result.record.payload]

    def get_vectors_by_vector(
        self,
        vector: List[float],
        top_k: int,
    ) -> List[List[float]]:
        """返回与给定向量最接近的top_k个向量
        
        Args:
            vector: 查询向量
            top_k: 要检索的相似向量数量
            
        Returns:
            向量列表
        """
        query = VectorDBQuery(query_vector=vector, top_k=top_k)
        results = self.query(query)
        return [result.record.vector for result in results]

    def get_ids_by_vector(
        self,
        vector: List[float],
        top_k: int,
    ) -> List[str]:
        """返回与给定向量最接近的top_k个向量的ID
        
        Args:
            vector: 查询向量
            top_k: 要检索的相似向量数量
            
        Returns:
            ID列表
        """
        query = VectorDBQuery(query_vector=vector, top_k=top_k)
        results = self.query(query)
        return [result.record.id for result in results]

    def __enter__(self):
        """上下文管理器入口"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口"""
        self.close()

    def close(self) -> None:
        """关闭向量存储连接"""
        pass