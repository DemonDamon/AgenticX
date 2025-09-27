#!/usr/bin/env python3
"""
修复Milvus维度问题
删除旧的768维度集合，创建新的1536维度集合
"""
import os
import sys
import yaml
from pathlib import Path
from dotenv import load_dotenv

# 加载环境变量
script_dir = Path(__file__).parent
env_path = script_dir / ".env"
load_dotenv(env_path)

# 添加AgenticX路径
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

try:
    from pymilvus import connections, utility, Collection, CollectionSchema, FieldSchema, DataType
    MILVUS_AVAILABLE = True
except ImportError:
    MILVUS_AVAILABLE = False
    print("❌ Milvus SDK 未安装，请运行: pip install pymilvus")
    sys.exit(1)

def fix_milvus_dimension():
    """修复Milvus维度问题"""
    print("🔧 修复Milvus维度问题...")
    
    if not MILVUS_AVAILABLE:
        print("❌ Milvus SDK 不可用")
        return
    
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
    
    # 获取Milvus配置
    milvus_config = config['storage']['vector']['milvus']
    host = milvus_config.get('host', 'localhost')
    port = milvus_config.get('port', 19530)
    collection_name = milvus_config.get('collection_name', 'agenticx_graphrag')
    
    # 新的维度（从百炼配置获取）
    new_dimension = config['embeddings']['bailian']['dimensions']
    
    print(f"📋 Milvus配置:")
    print(f"  主机: {host}:{port}")
    print(f"  集合名称: {collection_name}")
    print(f"  新维度: {new_dimension}")
    
    try:
        # 连接到Milvus
        print(f"\n🔌 连接到Milvus...")
        connections.connect("default", host=host, port=port)
        print("✅ 连接成功")
        
        # 检查集合是否存在
        if utility.has_collection(collection_name):
            print(f"\n🔍 发现现有集合: {collection_name}")
            
            # 获取现有集合信息
            collection = Collection(collection_name)
            schema = collection.schema
            
            # 查找向量字段的维度
            vector_field = None
            for field in schema.fields:
                if field.dtype == DataType.FLOAT_VECTOR:
                    vector_field = field
                    break
            
            if vector_field:
                current_dimension = vector_field.params.get('dim', 'unknown')
                print(f"📊 当前维度: {current_dimension}")
                
                if current_dimension != new_dimension:
                    print(f"⚠️ 维度不匹配！当前: {current_dimension}, 需要: {new_dimension}")
                    
                    # 删除现有集合
                    print(f"🗑️ 删除现有集合...")
                    utility.drop_collection(collection_name)
                    print("✅ 集合删除成功")
                    
                    # 创建新集合
                    print(f"🆕 创建新集合（维度: {new_dimension}）...")
                    create_new_collection(collection_name, new_dimension)
                    
                else:
                    print("✅ 维度匹配，无需修复")
            else:
                print("❌ 未找到向量字段")
        else:
            print(f"\n🆕 集合不存在，创建新集合...")
            create_new_collection(collection_name, new_dimension)
        
        # 断开连接
        connections.disconnect("default")
        print("\n✅ Milvus维度修复完成")
        
    except Exception as e:
        print(f"❌ 修复失败: {e}")
        import traceback
        print(f"详细错误: {traceback.format_exc()}")

def create_new_collection(collection_name: str, dimension: int):
    """创建新的Milvus集合"""
    try:
        # 定义字段
        fields = [
            FieldSchema(name="id", dtype=DataType.VARCHAR, max_length=255, is_primary=True),
            FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=dimension),
            FieldSchema(name="metadata", dtype=DataType.JSON)  # 移除default_value
        ]
        
        # 创建schema
        schema = CollectionSchema(fields, description="AgenticX vector collection", enable_dynamic_field=True)
        
        # 创建集合
        collection = Collection(collection_name, schema)
        
        # 创建索引
        index_params = {
            "metric_type": "COSINE",
            "index_type": "IVF_FLAT",
            "params": {"nlist": 128}
        }
        collection.create_index("vector", index_params)
        
        # 加载集合
        collection.load()
        
        print(f"✅ 新集合创建成功: {collection_name} (维度: {dimension})")
        
    except Exception as e:
        print(f"❌ 创建集合失败: {e}")
        raise

if __name__ == "__main__":
    fix_milvus_dimension()