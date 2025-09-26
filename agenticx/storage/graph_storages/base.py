"""
AgenticX Graph Storage Base Class

参考camel设计，提供统一的图存储抽象接口。
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BaseGraphStorage(ABC):
    """图存储抽象基类
    
    参考camel设计，提供统一的图存储接口。
    """

    @property
    @abstractmethod
    def get_client(self) -> Any:
        """获取底层图存储客户端"""
        pass

    @property
    @abstractmethod
    def get_schema(self) -> str:
        """获取图存储的schema"""
        pass

    @property
    @abstractmethod
    def get_structured_schema(self) -> Dict[str, Any]:
        """获取图存储的结构化schema"""
        pass

    @abstractmethod
    def refresh_schema(self) -> None:
        """刷新图schema信息"""
        pass

    @abstractmethod
    def add_triplet(self, subj: str, obj: str, rel: str) -> None:
        """在数据库中添加两个实体之间的关系（三元组）
        
        Args:
            subj: 主体实体的标识符
            obj: 客体实体的标识符
            rel: 主体和客体之间的关系
        """
        pass

    @abstractmethod
    def delete_triplet(self, subj: str, obj: str, rel: str) -> None:
        """从图中删除特定的三元组，包括主体、客体和关系
        
        Args:
            subj: 主体实体的标识符
            obj: 客体实体的标识符
            rel: 主体和客体之间的关系
        """
        pass

    @abstractmethod
    def query(
        self, query: str, params: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """使用语句和参数查询图存储
        
        Args:
            query: 要执行的查询
            params: 查询中使用的参数字典，默认为None
            
        Returns:
            字典列表，每个字典代表查询结果的一行
        """
        pass

    @abstractmethod
    def add_node(self, node_id: str, properties: Optional[Dict[str, Any]] = None) -> None:
        """添加节点到图中
        
        Args:
            node_id: 节点ID
            properties: 节点属性字典
        """
        pass

    @abstractmethod
    def delete_node(self, node_id: str) -> None:
        """从图中删除节点
        
        Args:
            node_id: 要删除的节点ID
        """
        pass

    @abstractmethod
    def add_edge(
        self, 
        from_node: str, 
        to_node: str, 
        edge_type: str, 
        properties: Optional[Dict[str, Any]] = None
    ) -> None:
        """添加边到图中
        
        Args:
            from_node: 起始节点ID
            to_node: 目标节点ID
            edge_type: 边类型
            properties: 边属性字典
        """
        pass

    @abstractmethod
    def delete_edge(self, from_node: str, to_node: str, edge_type: str) -> None:
        """从图中删除边
        
        Args:
            from_node: 起始节点ID
            to_node: 目标节点ID
            edge_type: 边类型
        """
        pass

    @abstractmethod
    def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        """获取节点信息
        
        Args:
            node_id: 节点ID
            
        Returns:
            节点信息字典，如果不存在返回None
        """
        pass

    @abstractmethod
    def get_neighbors(self, node_id: str) -> List[Dict[str, Any]]:
        """获取节点的邻居
        
        Args:
            node_id: 节点ID
            
        Returns:
            邻居节点列表
        """
        pass

    @abstractmethod
    def get_path(
        self, 
        from_node: str, 
        to_node: str, 
        max_depth: int = 3
    ) -> List[Dict[str, Any]]:
        """获取两个节点之间的路径
        
        Args:
            from_node: 起始节点ID
            to_node: 目标节点ID
            max_depth: 最大路径深度
            
        Returns:
            路径信息列表
        """
        pass

    @abstractmethod
    def clear(self) -> None:
        """清空图存储"""
        pass

    @abstractmethod
    def close(self) -> None:
        """关闭图存储连接"""
        pass

    @abstractmethod
    def store_graph(self, knowledge_graph) -> None:
        """存储知识图谱到图数据库
        
        Args:
            knowledge_graph: 知识图谱对象
        """
        pass

    def __enter__(self):
        """上下文管理器入口"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口"""
        self.close()