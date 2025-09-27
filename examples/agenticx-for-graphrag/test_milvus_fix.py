#!/usr/bin/env python3
"""
测试Milvus维度修复
验证向量存储是否可以正常工作
"""
import os
import sys
import yaml
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# 加载环境变量
script_dir = Path(__file__).parent
env_path = script_dir / ".env"
load_dotenv(env_path)

# 添加AgenticX路径
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from agenticx.storage import StorageManager, StorageConfig, StorageType, VectorRecord
from agenticx.embeddings import BailianEmbeddingProvider

async def test_milvus_fix():
    """测试Milvus维度修复"""
    print("🔍 测试Milvus维度修复...")
    
    # 加载配置
    config_file = Path("configs.yml")
    with open(config_file, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)
    
    # 替换环境变量
    def replace_env_vars(obj):
        if isinstance(obj, dict):
            for key, value in obj.items():
                if isinstance(value, str) and value.startswith('${') and value.endswith('}'):
                    env_var = value[2:-1]
                    obj[key] = os.getenv(env_var, value)
                else:
                    replace_env_vars(value)
        elif isinstance(obj, list):
            for item in obj:
                replace_env_vars(item)
    
    replace_env_vars(config)
    
    # 创建嵌入提供商
    bailian_config = config['embeddings']['bailian']
    embedding_provider = BailianEmbeddingProvider(
        api_key=bailian_config['api_key'],
        model=bailian_config['model'],
        api_url=bailian_config['base_url'],
        dimensions=bailian_config['dimensions'],
        batch_size=bailian_config['batch_size']
    )
    
    print(f"📊 嵌入维度: {embedding_provider.dimension}")
    
    # 创建存储管理器
    milvus_config = config['storage']['vector']['milvus']
    storage_config = StorageConfig(
        storage_type=StorageType.MILVUS,
        host=milvus_config.get('host', 'localhost'),
        port=milvus_config.get('port', 19530),
        extra_params={
            'dimension': embedding_provider.dimension,
            'collection_name': milvus_config.get('collection_name', 'agenticx_graphrag'),
            'recreate_if_exists': False  # 使用现有集合
        }
    )
    
    storage_manager = StorageManager(configs=[storage_config])
    await storage_manager.initialize()
    
    # 获取向量存储
    vector_storage = storage_manager.get_storage(StorageType.MILVUS)
    if not vector_storage:
        print("❌ 无法获取Milvus存储")
        return
    
    print("✅ Milvus存储初始化成功")
    
    # 测试嵌入和存储
    test_texts = ["测试文本1", "测试文本2", "测试文本3"]
    print(f"\n🧪 测试嵌入和存储（{len(test_texts)}个文本）...")
    
    try:
        # 生成嵌入
        embeddings = await embedding_provider.aembed(test_texts)
        print(f"✅ 嵌入生成成功，维度: {len(embeddings[0])}")
        
        # 创建向量记录
        records = []
        for i, (text, embedding) in enumerate(zip(test_texts, embeddings)):
            record = VectorRecord(
                id=f"test_{i}",
                vector=embedding,
                payload={"text": text, "index": i}
            )
            records.append(record)
        
        # 添加到Milvus
        print(f"💾 添加向量到Milvus...")
        vector_storage.add(records)
        print("✅ 向量添加成功")
        
        # 查询测试
        print(f"\n🔍 测试向量查询...")
        from agenticx.storage.vectordb_storages.base import VectorDBQuery
        
        query = VectorDBQuery(
            query_vector=embeddings[0],  # 使用第一个向量作为查询
            top_k=2
        )
        
        results = vector_storage.query(query)
        print(f"✅ 查询成功，返回 {len(results)} 个结果")
        
        for i, result in enumerate(results):
            print(f"  结果 {i+1}: ID={result.id}, 相似度={result.score:.3f}")
        
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        print(f"详细错误: {traceback.format_exc()}")
    
    print("\n✅ Milvus维度修复测试完成")

if __name__ == "__main__":
    asyncio.run(test_milvus_fix())