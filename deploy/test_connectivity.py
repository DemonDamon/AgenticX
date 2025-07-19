#!/usr/bin/env python3
"""
AgenticX Docker 数据库连通性测试脚本

测试所有数据库服务的连接状态和基本功能。
"""

import sys
import os
import time
import subprocess
import requests
from pathlib import Path

# 添加项目根目录到Python路径
sys.path.insert(0, str(Path(__file__).parent.parent))

def test_postgresql():
    """测试PostgreSQL连接"""
    print("🔍 测试 PostgreSQL 连接...")
    try:
        import socket
        
        # 先测试端口连接
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        result = sock.connect_ex(('localhost', 5432))
        sock.close()
        
        if result == 0:
            print("✅ PostgreSQL: 端口可访问")
            return True
        else:
            print("❌ PostgreSQL: 端口不可访问")
            return False
            
    except Exception as e:
        print(f"❌ PostgreSQL: 连接失败 - {e}")
        return False

def test_redis():
    """测试Redis连接"""
    print("🔍 测试 Redis 连接...")
    try:
        import redis
        r = redis.Redis(
            host="localhost",
            port=6379,
            password="password",
            decode_responses=True
        )
        r.ping()
        print("✅ Redis: 连接成功")
        return True
    except Exception as e:
        print(f"❌ Redis: 连接失败 - {e}")
        return False

def test_mongodb():
    """测试MongoDB连接"""
    print("🔍 测试 MongoDB 连接...")
    try:
        from pymongo import MongoClient
        client = MongoClient(
            "mongodb://admin:password@localhost:27017/agenticx?authSource=admin"
        )
        db = client.agenticx
        db.command("ping")
        print("✅ MongoDB: 连接成功")
        return True
    except Exception as e:
        print(f"❌ MongoDB: 连接失败 - {e}")
        return False

def test_milvus():
    """测试Milvus连接"""
    print("🔍 测试 Milvus 连接...")
    try:
        from pymilvus import connections, Collection, FieldSchema, CollectionSchema, DataType, utility
        connections.connect("default", host="localhost", port="19530")
        print("✅ Milvus: 连接成功")
        return True
    except Exception as e:
        print(f"❌ Milvus: 连接失败 - {e}")
        return False

def test_qdrant():
    """测试Qdrant连接"""
    print("🔍 测试 Qdrant 连接...")
    try:
        import qdrant_client
        client = qdrant_client.QdrantClient("localhost", port=6333, check_compatibility=False)
        collections = client.get_collections()
        print("✅ Qdrant: 连接成功")
        return True
    except Exception as e:
        print(f"❌ Qdrant: 连接失败 - {e}")
        return False

def test_neo4j():
    """测试Neo4j连接"""
    print("🔍 测试 Neo4j 连接...")
    try:
        from neo4j import GraphDatabase
        driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "password"))
        with driver.session() as session:
            result = session.run("RETURN 1 as num")
            record = result.single()
        driver.close()
        print("✅ Neo4j: 连接成功")
        return True
    except Exception as e:
        print(f"❌ Neo4j: 连接失败 - {e}")
        return False

def test_minio():
    """测试MinIO连接"""
    print("🔍 测试 MinIO 连接...")
    try:
        from minio import Minio
        client = Minio(
            "localhost:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
            secure=False
        )
        buckets = client.list_buckets()
        print("✅ MinIO: 连接成功")
        return True
    except Exception as e:
        print(f"❌ MinIO: 连接失败 - {e}")
        return False

def test_http_endpoints():
    """测试HTTP端点"""
    print("🔍 测试 HTTP 端点...")
    
    endpoints = [
        ("http://localhost:7474", "Neo4j Web UI"),
        ("http://localhost:9001", "MinIO Web UI"),
        ("http://localhost:9091/healthz", "Milvus Health"),
        ("http://localhost:6333", "Qdrant API"),
    ]
    
    success_count = 0
    for url, name in endpoints:
        try:
            response = requests.get(url, timeout=5)
            if response.status_code in [200, 404]:  # 404也算成功，说明服务在运行
                print(f"✅ {name}: 可访问")
                success_count += 1
            else:
                print(f"⚠️  {name}: HTTP {response.status_code}")
        except Exception as e:
            print(f"❌ {name}: 不可访问 - {e}")
    
    return success_count == len(endpoints)

def check_docker_services():
    """检查Docker服务状态"""
    print("🔍 检查 Docker 服务状态...")
    
    services = [
        "agenticx-postgres",
        "agenticx-redis", 
        "agenticx-mongodb",
        "agenticx-milvus",
        "agenticx-qdrant",
        "agenticx-neo4j",
        "agenticx-minio",
        "agenticx-etcd"
    ]
    
    running_count = 0
    for service in services:
        try:
            result = subprocess.run(
                ["docker", "ps", "--filter", f"name={service}", "--format", "{{.Names}}"],
                capture_output=True, text=True
            )
            if service in result.stdout:
                print(f"✅ {service}: 运行中")
                running_count += 1
            else:
                print(f"❌ {service}: 未运行")
        except Exception as e:
            print(f"❌ {service}: 检查失败 - {e}")
    
    return running_count == len(services)

def main():
    """主函数"""
    print("🚀 AgenticX Docker 数据库连通性测试")
    print("=" * 50)
    
    # 检查Docker服务
    docker_ok = check_docker_services()
    print()
    
    # 测试数据库连接
    tests = [
        ("PostgreSQL", test_postgresql),
        ("Redis", test_redis),
        ("MongoDB", test_mongodb),
        ("Milvus", test_milvus),
        ("Qdrant", test_qdrant),
        ("Neo4j", test_neo4j),
        ("MinIO", test_minio),
    ]
    
    results = {}
    for name, test_func in tests:
        try:
            results[name] = test_func()
        except ImportError as e:
            print(f"⚠️  {name}: 缺少依赖 - {e}")
            results[name] = False
        except Exception as e:
            print(f"❌ {name}: 测试异常 - {e}")
            results[name] = False
        time.sleep(1)  # 避免请求过快
    
    print()
    print("🔍 测试 HTTP 端点...")
    http_ok = test_http_endpoints()
    
    # 总结
    print()
    print("=" * 50)
    print("📊 测试结果总结")
    print("=" * 50)
    
    success_count = sum(results.values())
    total_count = len(results)
    
    print(f"Docker 服务: {'✅ 正常' if docker_ok else '❌ 异常'}")
    print(f"数据库连接: {success_count}/{total_count} 成功")
    print(f"HTTP 端点: {'✅ 正常' if http_ok else '❌ 异常'}")
    
    print()
    print("详细结果:")
    for name, result in results.items():
        status = "✅ 成功" if result else "❌ 失败"
        print(f"  - {name}: {status}")
    
    print()
    if success_count == total_count and docker_ok and http_ok:
        print("🎉 所有测试通过！数据库服务运行正常。")
        return 0
    else:
        print("⚠️  部分测试失败，请检查服务状态。")
        return 1

if __name__ == "__main__":
    exit(main()) 