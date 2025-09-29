"""
AgenticX Milvus Vector Storage

Milvus向量存储实现，支持高性能向量搜索引擎。
"""

from typing import Any, Dict, List, Optional
from .base import BaseVectorStorage, VectorRecord, VectorDBQuery, VectorDBQueryResult, VectorDBStatus
import logging

logger = logging.getLogger(__name__)

try:
    from pymilvus import connections, utility, Collection, CollectionSchema, FieldSchema, DataType
    MILVUS_AVAILABLE = True
except ImportError:
    MILVUS_AVAILABLE = False
    logger.warning("⚠️ Milvus SDK 未安装，请运行: pip install pymilvus")


class MilvusStorage(BaseVectorStorage):
    """Milvus向量存储实现
    
    使用Milvus进行高性能向量搜索引擎存储。
    """

    def __init__(self, dimension: int, host: str = "localhost", port: int = 19530, collection_name: str = "agenticx_vectors", **kwargs):
        """初始化Milvus存储
        
        Args:
            host: Milvus主机地址
            port: Milvus端口
            dimension: 向量维度
            collection_name: 集合名称
        """
        self.host = host
        self.port = port
        self.dimension = dimension
        self.collection_name = collection_name
        # 从kwargs获取参数
        self.recreate_if_exists = kwargs.get('recreate_if_exists', False)
        self.username = kwargs.get('username')
        self.password = kwargs.get('password')
        self.database = kwargs.get('database', 'default')
        self._client = None
        self.collection = None
        
        if not MILVUS_AVAILABLE:
            logger.warning("⚠️ Milvus SDK 不可用，使用模拟模式")
            return
            
        try:
            # 构建连接参数
            connect_params = {
                "host": self.host,
                "port": str(self.port)  # 端口应该是字符串
            }
            
            # 只在有认证信息时才添加
            if self.username:
                connect_params["user"] = self.username
            if self.password:
                connect_params["password"] = self.password
            if self.database and self.database != 'default':
                connect_params["db_name"] = self.database
            
            # 连接到Milvus
            logger.info(f"Milvus连接参数: {connect_params}")
            connections.connect("default", **connect_params)
            logger.info("✅ Successfully connected to Milvus.")
            self._client = "default"
            
            # 创建或获取集合
            self._create_collection()
            
        except Exception as e:
            logger.warning(f"⚠️ Milvus connection failed: {e}")
            logger.warning("⚠️ Falling back to simulation mode.")
            self._client = None
    
    def _create_collection(self):
        """创建或获取Milvus集合"""
        if not self._client:
            return
            
        try:
            # 如果设置了 recreate_if_exists，则删除现有集合
            if self.recreate_if_exists and utility.has_collection(self.collection_name):
                utility.drop_collection(self.collection_name)
                logger.info(f"✅ 已删除现有集合: {self.collection_name}")

            # 检查集合是否存在
            if utility.has_collection(self.collection_name):
                self.collection = Collection(self.collection_name)
                logger.info(f"✅ 使用现有集合: {self.collection_name}")
            else:
                # 创建新集合
                logger.info(f"创建集合参数: collection_name={self.collection_name}, dimension={self.dimension}")
                
                # 确保dimension是整数
                if not isinstance(self.dimension, int) or self.dimension <= 0:
                    raise ValueError(f"Invalid dimension: {self.dimension}, must be positive integer")
                
                fields = [
                    FieldSchema(name="id", dtype=DataType.VARCHAR, max_length=255, is_primary=True),
                    FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=int(self.dimension)),
                    FieldSchema(name="metadata", dtype=DataType.VARCHAR, max_length=65535)  # 改为VARCHAR避免JSON兼容性问题
                ]
                schema = CollectionSchema(fields, description="AgenticX vector collection")  # 移除enable_dynamic_field
                logger.info(f"创建集合Schema完成")
                self.collection = Collection(self.collection_name, schema)
                
                # 创建索引
                index_params = {
                    "metric_type": "COSINE",
                    "index_type": "IVF_FLAT",
                    "params": {"nlist": 128}
                }
                self.collection.create_index("vector", index_params)
                logger.info(f"✅ 创建新集合: {self.collection_name}")
                
            # 加载集合到内存
            self.collection.load()
            
        except Exception as e:
            logger.error(f"❌ 创建/获取集合失败: {e}")
            self.collection = None

    async def add(self, records: List[VectorRecord], **kwargs: Any) -> None:
        """添加向量记录
        
        Args:
            records: 要添加的向量记录列表
            **kwargs: 额外参数
        """
        if not self.collection:
            logger.info(f"✅ 模拟添加 {len(records)} 个向量到Milvus")
            return
            
        try:
            # 准备数据
            import json
            data_to_insert = []
            for record in records:
                # 将metadata序列化为JSON字符串
                metadata_str = json.dumps(record.payload or {}, ensure_ascii=False)
                data_to_insert.append({
                    "id": record.id,
                    "vector": record.vector,
                    "metadata": metadata_str
                })

            # 插入数据
            self.collection.insert(data_to_insert)
            
            # 刷新以确保数据持久化
            self.collection.flush()
            
            logger.info(f"✅ 成功添加 {len(records)} 个向量到Milvus")
            
        except Exception as e:
            logger.error(f"❌ 添加向量到Milvus失败: {e}")
            # 回退到模拟模式
            logger.info(f"✅ 模拟添加 {len(records)} 个向量到Milvus（回退）")

    def delete(self, ids: List[str], **kwargs: Any) -> None:
        """删除向量记录
        
        Args:
            ids: 要删除的向量ID列表
            **kwargs: 额外参数
        """
        if not self.collection:
            logger.info(f"✅ 模拟从Milvus删除 {len(ids)} 个向量")
            return
            
        try:
            # 构建删除表达式
            expr = f'id in {ids}'
            self.collection.delete(expr)
            logger.info(f"✅ 成功从Milvus删除 {len(ids)} 个向量")
        except Exception as e:
            logger.error(f"❌ 从Milvus删除向量失败: {e}")
            logger.info(f"✅ 模拟从Milvus删除 {len(ids)} 个向量（回退）")

    def status(self) -> VectorDBStatus:
        """获取存储状态
        
        Returns:
            向量数据库状态
        """
        if not self.collection:
            logger.info("✅ 模拟获取Milvus状态")
            return VectorDBStatus(vector_dim=self.dimension, vector_count=0)
            
        try:
            # 获取集合统计信息
            row_count = self.collection.num_entities
            logger.info(f"✅ 获取Milvus状态成功: {row_count} 条记录")
            return VectorDBStatus(vector_dim=self.dimension, vector_count=row_count)
        except Exception as e:
            logger.error(f"❌ 获取Milvus状态失败: {e}")
            return VectorDBStatus(vector_dim=self.dimension, vector_count=0)

    def query(self, query: VectorDBQuery, **kwargs: Any) -> List[VectorDBQueryResult]:
        """查询相似向量
        
        Args:
            query: 查询对象
            **kwargs: 额外参数
            
        Returns:
            查询结果列表
        """
        if not self.collection:
            logger.info(f"✅ 模拟Milvus查询，top_k={query.top_k}")
            return []
            
        try:
            # 执行向量搜索
            search_params = {"metric_type": "COSINE", "params": {"nprobe": 10}}
            results = self.collection.search(
                data=[query.query_vector],
                anns_field="vector",
                param=search_params,
                limit=query.top_k,
                output_fields=["id", "metadata"]
            )
            
            # 转换结果
            import json
            query_results = []
            if results:
                for hit in results[0]:
                    # 反序列化metadata JSON字符串
                    metadata_str = hit.entity.get("metadata", "{}")
                    try:
                        metadata_dict = json.loads(metadata_str) if isinstance(metadata_str, str) else metadata_str
                    except (json.JSONDecodeError, TypeError):
                        metadata_dict = {}
                    
                    record = VectorRecord(
                        id=hit.entity.get("id"),
                        vector=query.query_vector,  # 查询向量本身
                        payload=metadata_dict
                    )
                    result = VectorDBQueryResult(
                        record=record,
                        similarity=hit.distance # 使用 distance 而不是 score
                    )
                    query_results.append(result)
            
            logger.info(f"✅ Milvus查询成功，返回 {len(query_results)} 个结果")
            return query_results
            
        except Exception as e:
            logger.error(f"❌ Milvus查询失败: {e}")
            logger.info(f"✅ 模拟Milvus查询，top_k={query.top_k}（回退）")
            return []

    def clear(self) -> None:
        """清空所有向量"""
        if not self.collection:
            logger.info("✅ 模拟清空Milvus所有向量")
            return
            
        try:
            # 删除并重建集合
            utility.drop_collection(self.collection_name)
            self._create_collection()
            logger.info("✅ 成功清空Milvus所有向量")
        except Exception as e:
            logger.error(f"❌ 清空Milvus向量失败: {e}")
            logger.info("✅ 模拟清空Milvus所有向量（回退）")

    def load(self) -> None:
        """加载云服务上托管的集合"""
        if not self.collection:
            logger.info("✅ 模拟加载Milvus集合")
            return
            
        try:
            self.collection.load()
            logger.info("✅ 成功加载Milvus集合")
        except Exception as e:
            logger.error(f"❌ 加载Milvus集合失败: {e}")
            logger.info("✅ 模拟加载Milvus集合（回退）")

    @property
    def client(self) -> Any:
        """提供对底层向量数据库客户端的访问"""
        return self._client

    def close(self) -> None:
        """关闭Milvus连接"""
        if self._client:
            try:
                connections.disconnect(self._client)
                print("✅ Closed Milvus connection.")
            except Exception as e:
                print(f"⚠️  Error closing Milvus connection: {e}")
            self._client = None