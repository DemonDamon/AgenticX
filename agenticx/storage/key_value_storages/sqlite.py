"""
AgenticX SQLite Key-Value Storage

SQLite键值存储实现，支持轻量级本地存储。
"""

import sqlite3
import json
from typing import Any, Dict, List, Optional, Tuple
from .base import BaseKeyValueStorage


class SQLiteStorage(BaseKeyValueStorage):
    """SQLite键值存储实现
    
    使用SQLite进行轻量级的本地键值存储。
    """

    def __init__(self, db_path: str = "agenticx.db"):
        """初始化SQLite存储
        
        Args:
            db_path: SQLite数据库文件路径
        """
        self.db_path = db_path
        self._connection = sqlite3.connect(db_path, check_same_thread=False)
        self._cursor = self._connection.cursor()
        self._cursor.execute(
            'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)'
        )
        self._connection.commit()

    def save(self, records: List[Dict[str, Any]]) -> None:
        """保存一批记录到键值存储系统
        
        Args:
            records: 要存储的记录列表，每个记录是一个字典
        """
        for record in records:
            for key, value in record.items():
                self.set(key, value)

    def load(self) -> List[Dict[str, Any]]:
        """从键值存储系统加载所有记录
        
        Returns:
            存储的记录列表
        """
        self._cursor.execute('SELECT key, value FROM kv')
        return [{row[0]: json.loads(row[1])} for row in self._cursor.fetchall()]

    def clear(self) -> None:
        """清空所有记录"""
        self._cursor.execute('DELETE FROM kv')
        if self._connection:
            self._connection.commit()

    def get(self, key: str) -> Optional[Any]:
        """根据键获取值
        
        Args:
            key: 键名
            
        Returns:
            对应的值，如果不存在返回None
        """
        self._cursor.execute('SELECT value FROM kv WHERE key = ?', (key,))
        row = self._cursor.fetchone()
        if row:
            return json.loads(row[0])
        return None

    def set(self, key: str, value: Any) -> None:
        """设置键值对
        
        Args:
            key: 键名
            value: 值
        """
        value_json = json.dumps(value)
        self._cursor.execute(
            'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', (key, value_json)
        )
        if self._connection:
            self._connection.commit()

    def delete(self, key: str) -> bool:
        """删除指定键
        
        Args:
            key: 要删除的键名
            
        Returns:
            是否删除成功
        """
        self._cursor.execute('DELETE FROM kv WHERE key = ?', (key,))
        if self._connection:
            self._connection.commit()
        return self._cursor.rowcount > 0

    def exists(self, key: str) -> bool:
        """检查键是否存在
        
        Args:
            key: 键名
            
        Returns:
            键是否存在
        """
        self._cursor.execute('SELECT 1 FROM kv WHERE key = ?', (key,))
        return self._cursor.fetchone() is not None

    def keys(self) -> List[str]:
        """获取所有键名
        
        Returns:
            键名列表
        """
        self._cursor.execute('SELECT key FROM kv')
        return [row[0] for row in self._cursor.fetchall()]

    def values(self) -> List[Any]:
        """获取所有值
        
        Returns:
            值列表
        """
        self._cursor.execute('SELECT value FROM kv')
        return [json.loads(row[0]) for row in self._cursor.fetchall()]

    def items(self) -> List[Tuple[str, Any]]:
        """获取所有键值对
        
        Returns:
            键值对列表
        """
        self._cursor.execute('SELECT key, value FROM kv')
        return [(row[0], json.loads(row[1])) for row in self._cursor.fetchall()]

    def count(self) -> int:
        """获取记录总数
        
        Returns:
            记录数量
        """
        self._cursor.execute('SELECT COUNT(*) FROM kv')
        return self._cursor.fetchone()[0]

    def close(self) -> None:
        """关闭SQLite连接"""
        if self._connection:
            self._connection.close()
            self._connection = None