#!/usr/bin/env python3
"""
检查和清理Milvus集合
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# 加载环境变量
script_dir = Path(__file__).parent
env_path = script_dir / ".env"
load_dotenv(env_path)

try:
    from pymilvus import connections, utility, Collection, DataType
    MILVUS_AVAILABLE = True
except ImportError:
    MILVUS_AVAILABLE = False
    print("❌ Milvus SDK 未安装")
    sys.exit(1)

def check_milvus_collections():
    """检查Milvus集合"""
    print("🔍 检查Milvus集合...")
    
    try:
        # 连接到Milvus
        connections.connect("default", host="localhost", port=19530)
        print("✅ 连接成功")
        
        # 列出所有集合
        collections = utility.list_collections()
        print(f"\n📋 发现 {len(collections)} 个集合:")
        
        for collection_name in collections:
            print(f"\n🔍 集合: {collection_name}")
            
            try:
                collection = Collection(collection_name)
                schema = collection.schema
                
                # 查找向量字段
                for field in schema.fields:
                    if field.dtype == DataType.FLOAT_VECTOR:
                        dimension = field.params.get('dim', 'unknown')
                        print(f"  📊 向量维度: {dimension}")
                        
                        # 如果维度是768，询问是否删除
                        if dimension == 768:
                            print(f"  ⚠️ 发现旧维度集合！")
                            response = input(f"  是否删除集合 '{collection_name}'? (y/N): ")
                            if response.lower() == 'y':
                                utility.drop_collection(collection_name)
                                print(f"  ✅ 已删除集合: {collection_name}")
                            else:
                                print(f"  ⏭️ 跳过删除")
                        elif dimension == 1536:
                            print(f"  ✅ 维度正确")
                        else:
                            print(f"  ❓ 未知维度: {dimension}")
                        break
                else:
                    print(f"  ❌ 未找到向量字段")
                    
            except Exception as e:
                print(f"  ❌ 检查集合失败: {e}")
        
        # 断开连接
        connections.disconnect("default")
        print("\n✅ 检查完成")
        
    except Exception as e:
        print(f"❌ 检查失败: {e}")

if __name__ == "__main__":
    check_milvus_collections()