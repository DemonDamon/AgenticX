"""
AgenticX Redis Key-Value Storage

Redis键值存储实现，支持高性能缓存和会话存储。
"""

from typing import Any, Dict, List, Optional
import redis
from .base import BaseKeyValueStorage
import logging
from agenticx.storage.manager import StorageConfig

logger = logging.getLogger(__name__)


class RedisStorage(BaseKeyValueStorage):
    """Redis键值存储实现
    
    使用Redis进行高性能的键值存储，支持缓存和会话管理。
    """

    def __init__(self, config: StorageConfig):
        """初始化Redis存储
        
        Args:
            config: 存储配置对象
        """
        self.config = config
        self._client: Optional[redis.Redis] = None
        self.in_memory_fallback = False
        self._in_memory_storage: Dict[str, Any] = {}
        
        try:
            self._client = redis.Redis(
                host=self.config.host,
                port=self.config.port,
                password=self.config.password,
                db=0,
                decode_responses=True
            )
            self._client.ping()
            logger.info(f"✅ Successfully connected to Redis at {self.config.host}:{self.config.port}")
        except redis.exceptions.AuthenticationError as e:
            logger.warning(
                f"⚠️ Could not connect to Redis at redis://{self.config.host}:{self.config.port}: {e}. "
                f"Falling back to in-memory storage."
            )
            self._client = None
            self.in_memory_fallback = True
        except Exception as e:
            logger.warning(
                f"⚠️ Could not connect to Redis at {self.config.host}:{self.config.port}: {e}. "
                f"Falling back to in-memory storage."
            )
            self._client = None
            self.in_memory_fallback = True

    def save(self, records: List[Dict[str, Any]]) -> None:
        """保存记录到Redis
        
        Args:
            records: 要保存的记录列表
        """
        if self.in_memory_fallback:
            for record in records:
                if 'key' in record:
                    self._in_memory_storage[record['key']] = record
            print(f"✅ (In-memory) Saved {len(records)} records.")
            return

        if not self._client:
            return
        # TODO: Implement proper batch saving if needed
        with self._client.pipeline() as pipe:
            for record in records:
                if 'key' in record and 'value' in record:
                    pipe.set(record['key'], str(record['value']))
            pipe.execute()
        logger.info(f"✅ Saved {len(records)} records to Redis")

    def load(self) -> List[Dict[str, Any]]:
        """从Redis加载所有记录
        
        Returns:
            存储的记录列表
        """
        if self.in_memory_fallback:
            print("✅ (In-memory) Loading records.")
            return list(self._in_memory_storage.values())

        if not self._client:
            return []
        # This is potentially dangerous for large DBs.
        # Consider using scan_iter for production environments.
        keys = self._client.keys('*')
        values = self._client.mget(keys) if keys else []
        logger.info("✅ Loaded records from Redis")
        return [{key: value} for key, value in zip(keys, values)]


    def clear(self) -> None:
        """清空所有记录"""
        if self.in_memory_fallback:
            self._in_memory_storage.clear()
            print("✅ (In-memory) Cleared all records.")
            return
        if self._client:
            self._client.flushdb()
        logger.info("✅ Cleared all records from Redis")

    def get(self, key: str) -> Optional[Any]:
        """根据键获取值
        
        Args:
            key: 键名
            
        Returns:
            对应的值，如果不存在返回None
        """
        if self.in_memory_fallback:
            value = self._in_memory_storage.get(key)
            print(f"✅ (In-memory) Got value for key: {key}")
            return value

        if not self._client:
            return None
        value = self._client.get(key)
        print(f"✅ TODO: Got value for key: {key} from Redis")
        return value

    def set(self, key: str, value: Any) -> None:
        """设置键值对
        
        Args:
            key: 键名
            value: 值
        """
        if self.in_memory_fallback:
            self._in_memory_storage[key] = value
            print(f"✅ (In-memory) Set value for key: {key}")
            return
        if self._client:
            self._client.set(key, value)
        logger.info(f"✅ Set value for key: {key} in Redis")

    def delete(self, key: str) -> bool:
        """删除指定键
        
        Args:
            key: 要删除的键名
            
        Returns:
            是否删除成功
        """
        if self.in_memory_fallback:
            if key in self._in_memory_storage:
                del self._in_memory_storage[key]
                print(f"✅ (In-memory) Deleted key: {key}")
                return True
            return False

        if not self._client:
            return False
        deleted_count = self._client.delete(key)
        logger.info(f"✅ Deleted key: {key} from Redis")
        return deleted_count > 0

    def exists(self, key: str) -> bool:
        """检查键是否存在
        
        Args:
            key: 键名
            
        Returns:
            键是否存在
        """
        if self.in_memory_fallback:
            exists = key in self._in_memory_storage
            print(f"✅ (In-memory) Checked existence of key: {key}")
            return exists

        if not self._client:
            return False
        exists = self._client.exists(key) > 0
        logger.info(f"✅ Checked existence of key: {key} in Redis")
        return exists

    def keys(self) -> List[str]:
        """获取所有键名
        
        Returns:
            键名列表
        """
        if self.in_memory_fallback:
            keys = list(self._in_memory_storage.keys())
            print("✅ (In-memory) Got all keys.")
            return keys

        if not self._client:
            return []
        keys = self._client.keys('*')
        logger.info("✅ Got all keys from Redis")
        return keys

    def values(self) -> List[Any]:
        """获取所有值
        
        Returns:
            值列表
        """
        if self.in_memory_fallback:
            values = list(self._in_memory_storage.values())
            print("✅ (In-memory) Got all values.")
            return values

        if not self._client:
            return []
        keys = self._client.keys('*')
        values = self._client.mget(keys) if keys else []
        logger.info("✅ Got all values from Redis")
        return values

    def items(self) -> List[tuple]:
        """获取所有键值对
        
        Returns:
            键值对列表
        """
        if self.in_memory_fallback:
            items = list(self._in_memory_storage.items())
            print("✅ (In-memory) Got all items.")
            return items

        if not self._client:
            return []
        keys = self._client.keys('*')
        values = self._client.mget(keys) if keys else []
        logger.info("✅ Got all items from Redis")
        return list(zip(keys, values))

    def count(self) -> int:
        """获取记录总数
        
        Returns:
            记录数量
        """
        if self.in_memory_fallback:
            count = len(self._in_memory_storage)
            print("✅ (In-memory) Got count of records.")
            return count

        if not self._client:
            return 0
        count = self._client.dbsize()
        logger.info("✅ Got count of records from Redis")
        return count

    def close(self) -> None:
        """关闭Redis连接"""
        if self._client and not self.in_memory_fallback:
            self._client.close()
            print("✅ Closed Redis connection")
            self._client = None