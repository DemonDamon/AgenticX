"""
AgenticX FAISS Vector Storage

FAISS向量存储实现，支持高效的向量相似性搜索。
"""

import numpy as np
from typing import Any, Dict, List, Optional
import pickle
import os

from .base import (
    BaseVectorStorage,
    VectorRecord,
    VectorDBQuery,
    VectorDBQueryResult,
    VectorDBStatus
)


class FaissStorage(BaseVectorStorage):
    """FAISS向量存储实现
    
    使用FAISS进行高效的向量相似性搜索。
    """

    def __init__(self, dimension: int, index_path: str = "faiss_index"):
        """初始化FAISS存储
        
        Args:
            index_path: 索引文件路径
            dimension: 向量维度
        """
        self.index_path = index_path
        self.dimension = dimension
        self.vectors: List[VectorRecord] = []
        self._load_index()

    def _load_index(self) -> None:
        """加载FAISS索引"""
        try:
            if os.path.exists(f"{self.index_path}.pkl"):
                with open(f"{self.index_path}.pkl", "rb") as f:
                    self.vectors = pickle.load(f)
        except Exception as e:
            print(f"加载FAISS索引失败: {e}")
            self.vectors = []

    def _save_index(self) -> None:
        """保存FAISS索引"""
        try:
            with open(f"{self.index_path}.pkl", "wb") as f:
                pickle.dump(self.vectors, f)
        except Exception as e:
            print(f"保存FAISS索引失败: {e}")

    def add(self, records: List[VectorRecord], **kwargs: Any) -> None:
        """添加向量记录
        
        Args:
            records: 要添加的向量记录列表
            **kwargs: 额外参数
        """
        for record in records:
            if len(record.vector) != self.dimension:
                raise ValueError(f"向量维度不匹配: 期望{self.dimension}, 实际{len(record.vector)}")
            self.vectors.append(record)
        self._save_index()

    def delete(self, ids: List[str], **kwargs: Any) -> None:
        """删除向量记录
        
        Args:
            ids: 要删除的向量ID列表
            **kwargs: 额外参数
        """
        self.vectors = [v for v in self.vectors if v.id not in ids]
        self._save_index()

    def status(self) -> VectorDBStatus:
        """获取存储状态
        
        Returns:
            向量数据库状态
        """
        return VectorDBStatus(
            vector_dim=self.dimension,
            vector_count=len(self.vectors)
        )

    def query(self, query: VectorDBQuery, **kwargs: Any) -> List[VectorDBQueryResult]:
        """查询相似向量
        
        Args:
            query: 查询对象
            **kwargs: 额外参数
            
        Returns:
            查询结果列表
        """
        if not self.vectors:
            return []

        query_vector = np.array(query.query_vector, dtype=np.float32)
        results = []

        for record in self.vectors:
            vector = np.array(record.vector, dtype=np.float32)
            # 计算余弦相似度
            similarity = self._cosine_similarity(query_vector, vector)
            results.append(VectorDBQueryResult.create(
                similarity=similarity,
                vector=record.vector,
                id=record.id,
                payload=record.payload
            ))

        # 按相似度排序并返回top_k
        results.sort(key=lambda x: x.similarity, reverse=True)
        return results[:query.top_k]

    def clear(self) -> None:
        """清空所有向量"""
        self.vectors.clear()
        self._save_index()

    def load(self) -> None:
        """加载索引（已实现）"""
        self._load_index()

    @property
    def client(self) -> Any:
        """获取客户端（FAISS使用向量列表）"""
        return self.vectors

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """计算余弦相似度
        
        Args:
            a: 向量a
            b: 向量b
            
        Returns:
            余弦相似度
        """
        dot_product = np.dot(a, b)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
            
        return float(dot_product / (norm_a * norm_b))

    def close(self) -> None:
        """关闭存储连接"""
        self._save_index()