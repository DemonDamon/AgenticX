"""
AgenticX Key-Value Storage Base Class

参考camel设计，提供统一的键值存储抽象接口。
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BaseKeyValueStorage(ABC):
    """键值存储抽象基类
    
    提供统一的键值存储接口，支持Redis、SQLite、PostgreSQL、MongoDB等。
    参考camel设计，确保接口一致性和可扩展性。
    """

    @abstractmethod
    def save(self, records: List[Dict[str, Any]]) -> None:
        """保存一批记录到键值存储系统
        
        Args:
            records: 要存储的记录列表，每个记录是一个字典
        """
        pass

    @abstractmethod
    def load(self) -> List[Dict[str, Any]]:
        """从键值存储系统加载所有记录
        
        Returns:
            存储的记录列表
        """
        pass

    @abstractmethod
    def clear(self) -> None:
        """清空所有记录"""
        pass

    @abstractmethod
    def get(self, key: str) -> Optional[Any]:
        """根据键获取值
        
        Args:
            key: 键名
            
        Returns:
            对应的值，如果不存在返回None
        """
        pass

    @abstractmethod
    def set(self, key: str, value: Any) -> None:
        """设置键值对
        
        Args:
            key: 键名
            value: 值
        """
        pass

    @abstractmethod
    def delete(self, key: str) -> bool:
        """删除指定键
        
        Args:
            key: 要删除的键名
            
        Returns:
            是否删除成功
        """
        pass

    @abstractmethod
    def exists(self, key: str) -> bool:
        """检查键是否存在
        
        Args:
            key: 键名
            
        Returns:
            键是否存在
        """
        pass

    @abstractmethod
    def keys(self) -> List[str]:
        """获取所有键名
        
        Returns:
            键名列表
        """
        pass

    @abstractmethod
    def values(self) -> List[Any]:
        """获取所有值
        
        Returns:
            值列表
        """
        pass

    @abstractmethod
    def items(self) -> List[tuple]:
        """获取所有键值对
        
        Returns:
            键值对列表
        """
        pass

    @abstractmethod
    def count(self) -> int:
        """获取记录总数
        
        Returns:
            记录数量
        """
        pass

    @abstractmethod
    def close(self) -> None:
        """关闭存储连接"""
        pass

    def __enter__(self):
        """上下文管理器入口"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口"""
        self.close() 