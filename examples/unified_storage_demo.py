#!/usr/bin/env python3
"""
AgenticX Unified Storage Demo

演示新的四层存储架构：
- Key-Value Storage: 键值存储
- Vector Storage: 向量存储
- Graph Storage: 图存储  
- Object Storage: 对象存储

参考camel设计，展示完整的存储生态。
"""

import sys
import os
from pathlib import Path

# 添加项目根目录到Python路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from agenticx.storage import (
    # Key-Value Storage
    InMemoryStorage,
    
    # Vector Storage
    FaissStorage,
    VectorRecord,
    VectorDBQuery,
    
    # Storage Manager
    StorageManager,
    StorageConfig,
    StorageType,
)


def demo_key_value_storage():
    """演示键值存储"""
    print("=" * 50)
    print("Key-Value Storage Demo")
    print("=" * 50)
    
    # 创建内存键值存储
    kv_storage = InMemoryStorage()
    
    # 保存数据
    records = [
        {"key": "user:1", "value": {"name": "Alice", "age": 25}},
        {"key": "user:2", "value": {"name": "Bob", "age": 30}},
        {"key": "config:app", "value": {"version": "1.0.0", "debug": True}},
    ]
    kv_storage.save(records)
    print(f"✅ 保存了 {len(records)} 条记录")
    
    # 读取数据
    loaded_records = kv_storage.load()
    print(f"✅ 加载了 {len(loaded_records)} 条记录")
    
    # 单个操作
    kv_storage.set("session:123", {"status": "active", "last_access": "2024-01-01"})
    session_data = kv_storage.get("session:123")
    print(f"✅ 获取会话数据: {session_data}")
    
    # 统计信息
    print(f"✅ 总记录数: {kv_storage.count()}")
    print(f"✅ 所有键: {kv_storage.keys()}")
    
    return kv_storage


def demo_vector_storage():
    """演示向量存储"""
    print("\n" + "=" * 50)
    print("Vector Storage Demo")
    print("=" * 50)
    
    # 创建FAISS向量存储
    vector_storage = FaissStorage(dimension=768)
    
    # 创建向量记录
    records = [
        VectorRecord(
            vector=[0.1, 0.2, 0.3] + [0.0] * 765,  # 768维向量
            id="doc_1",
            payload={"title": "机器学习基础", "content": "机器学习是人工智能的一个分支..."}
        ),
        VectorRecord(
            vector=[0.2, 0.3, 0.4] + [0.0] * 765,
            id="doc_2", 
            payload={"title": "深度学习入门", "content": "深度学习是机器学习的一个子领域..."}
        ),
        VectorRecord(
            vector=[0.3, 0.4, 0.5] + [0.0] * 765,
            id="doc_3",
            payload={"title": "自然语言处理", "content": "NLP是人工智能的重要应用..."}
        ),
    ]
    
    # 添加向量
    vector_storage.add(records)
    print(f"✅ 添加了 {len(records)} 个向量")
    
    # 查询相似向量
    query_vector = [0.15, 0.25, 0.35] + [0.0] * 765
    query = VectorDBQuery(query_vector=query_vector, top_k=2)
    results = vector_storage.query(query)
    
    print(f"✅ 查询到 {len(results)} 个相似向量:")
    for i, result in enumerate(results, 1):
        print(f"  {i}. ID: {result.record.id}")
        print(f"     相似度: {result.similarity:.4f}")
        print(f"     标题: {result.record.payload.get('title', 'N/A')}")
    
    # 获取状态
    status = vector_storage.status()
    print(f"✅ 向量存储状态: 维度={status.vector_dim}, 数量={status.vector_count}")
    
    return vector_storage


def demo_storage_manager():
    """演示存储管理器"""
    print("\n" + "=" * 50)
    print("Storage Manager Demo")
    print("=" * 50)
    
    # 创建存储配置
    configs = [
        StorageConfig(
            storage_type=StorageType.IN_MEMORY,
            connection_string="memory://"
        ),
        StorageConfig(
            storage_type=StorageType.FAISS,
            extra_params={"dimension": 768}
        ),
    ]
    
    # 创建存储管理器
    storage_manager = StorageManager(configs)
    
    # 初始化存储
    import asyncio
    asyncio.run(storage_manager.initialize())
    print(f"✅ 初始化了 {len(storage_manager.storages)} 个存储")
    
    # 获取统计信息
    stats = asyncio.run(storage_manager.get_statistics())
    print(f"✅ 存储统计: {stats}")
    
    # 健康检查
    health = asyncio.run(storage_manager.router.health_check())
    print(f"✅ 健康检查: {health}")
    
    # 关闭存储
    asyncio.run(storage_manager.close())
    
    return storage_manager


def demo_storage_comparison():
    """演示存储架构对比"""
    print("\n" + "=" * 50)
    print("Storage Architecture Comparison")
    print("=" * 50)
    
    print("📊 AgenticX vs Camel vs Agno 存储架构对比:")
    print()
    
    print("AgenticX (新架构):")
    print("├── Key-Value Storage (Redis, SQLite, PostgreSQL, MongoDB)")
    print("├── Vector Storage (Milvus, Qdrant, FAISS, pgvector, Chroma, Weaviate)")
    print("├── Graph Storage (Neo4j, Nebula Graph)")
    print("└── Object Storage (S3, GCS, Azure Blob)")
    print()
    
    print("Camel (参考设计):")
    print("├── key_value_storages (Redis, JSON, Mem0, InMemory)")
    print("├── vectordb_storages (Milvus, Qdrant, FAISS, pgvector, Chroma, Weaviate)")
    print("├── graph_storages (Neo4j, Nebula Graph)")
    print("└── object_storages (S3, GCS, Azure)")
    print()
    
    print("Agno (原始设计):")
    print("├── storage (传统存储: PostgreSQL, Redis, MongoDB)")
    print("└── vectordb (向量存储: Milvus, Qdrant, Pinecone)")
    print()
    
    print("🎯 设计优势:")
    print("✅ 标准化数据模型 (VectorRecord, VectorDBQuery, VectorDBQueryResult)")
    print("✅ 统一抽象接口 (BaseKeyValueStorage, BaseVectorStorage, BaseGraphStorage, BaseObjectStorage)")
    print("✅ 完整存储生态 (支持主流数据库和云服务)")
    print("✅ 易于扩展和维护 (模块化设计)")
    print("✅ 上下文管理器支持 (with语句)")
    print("✅ 错误处理机制 (StorageError, ConnectionError, QueryError)")


def main():
    """主函数"""
    print("🚀 AgenticX Unified Storage Demo")
    print("参考camel设计，展示四层存储架构")
    print()
    
    try:
        # 演示键值存储
        kv_storage = demo_key_value_storage()
        
        # 演示向量存储
        vector_storage = demo_vector_storage()
        
        # 演示存储管理器
        storage_manager = demo_storage_manager()
        
        # 演示架构对比
        demo_storage_comparison()
        
        # 清理资源
        kv_storage.close()
        vector_storage.close()
        
        print("\n" + "=" * 50)
        print("✅ 所有演示完成！")
        print("=" * 50)
        
    except Exception as e:
        print(f"❌ 演示过程中出现错误: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main() 