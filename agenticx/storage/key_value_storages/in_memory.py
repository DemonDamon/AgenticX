"""
AgenticX In-Memory Key-Value Storage

内存键值存储实现，用于测试和开发环境。
"""

from typing import Any, Dict, List, Optional
from .base import BaseKeyValueStorage


class InMemoryStorage(BaseKeyValueStorage):
    """内存键值存储实现
    
    使用Python字典在内存中存储数据，主要用于测试和开发环境。
    """

    def __init__(self):
        """初始化内存存储"""
        self._data: Dict[str, Any] = {}

    def save(self, records: List[Dict[str, Any]]) -> None:
        """保存记录到内存
        
        Args:
            records: 要保存的记录列表
        """
        for record in records:
            if isinstance(record, dict) and 'key' in record:
                self._data[record['key']] = record.get('value')
            else:
                # 如果没有key字段，使用整个记录作为值
                self._data[str(hash(str(record)))] = record

    def load(self) -> List[Dict[str, Any]]:
        """从内存加载所有记录
        
        Returns:
            存储的记录列表
        """
        return [{'key': k, 'value': v} for k, v in self._data.items()]

    def clear(self) -> None:
        """清空所有记录"""
        self._data.clear()

    def get(self, key: str) -> Optional[Any]:
        """根据键获取值
        
        Args:
            key: 键名
            
        Returns:
            对应的值，如果不存在返回None
        """
        return self._data.get(key)

    def set(self, key: str, value: Any) -> None:
        """设置键值对
        
        Args:
            key: 键名
            value: 值
        """
        self._data[key] = value

    def delete(self, key: str) -> bool:
        """删除指定键
        
        Args:
            key: 要删除的键名
            
        Returns:
            是否删除成功
        """
        if key in self._data:
            del self._data[key]
            return True
        return False

    def exists(self, key: str) -> bool:
        """检查键是否存在
        
        Args:
            key: 键名
            
        Returns:
            键是否存在
        """
        return key in self._data

    def keys(self) -> List[str]:
        """获取所有键名
        
        Returns:
            键名列表
        """
        return list(self._data.keys())

    def values(self) -> List[Any]:
        """获取所有值
        
        Returns:
            值列表
        """
        return list(self._data.values())

    def items(self) -> List[tuple]:
        """获取所有键值对
        
        Returns:
            键值对列表
        """
        return list(self._data.items())

    def count(self) -> int:
        """获取记录总数
        
        Returns:
            记录数量
        """
        return len(self._data)

    def close(self) -> None:
        """关闭存储连接（内存存储无需关闭）"""
        pass 