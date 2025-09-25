#!/usr/bin/env python3
"""Neo4j连接测试脚本

测试Neo4j服务的基础连通性。

Usage:
    python deploy/test_neo4j.py
"""

import os
from pathlib import Path
from loguru import logger
from dotenv import load_dotenv

# 加载环境变量
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    load_dotenv(env_path)
    logger.info(f"📋 已加载环境变量文件: {env_path}")
else:
    logger.warning(f"⚠️ 环境变量文件不存在: {env_path}")

# 配置loguru日志
logger.remove()
logger.add(
    sink=lambda msg: print(msg, end=""),
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan> - <level>{message}</level>",
    level="INFO",
    colorize=True
)

try:
    from neo4j import GraphDatabase
    NEO4J_AVAILABLE = True
except ImportError:
    NEO4J_AVAILABLE = False
    logger.error("❌ Neo4j驱动未安装，请运行: pip install neo4j")


def get_neo4j_config():
    """从环境变量获取Neo4j配置"""
    # 在测试脚本中，我们使用localhost而不是容器名
    host = os.getenv('NEO4J_HOST', 'localhost')
    if host == 'neo4j':  # 如果是容器名，改为localhost用于外部访问
        host = 'localhost'
    
    config = {
        "uri": f"bolt://{host}:{os.getenv('NEO4J_PORT', '7687')}",
        "username": os.getenv('NEO4J_USER', 'neo4j'),
        "password": os.getenv('NEO4J_PASSWORD', 'password'),
        "database": "neo4j"
    }
    
    logger.info("🔧 Neo4j连接配置:")
    logger.info(f"  - URI: {config['uri']}")
    logger.info(f"  - 用户名: {config['username']}")
    logger.info(f"  - 密码: {'*' * len(config['password'])}")
    logger.info(f"  - 数据库: {config['database']}")
    
    return config


def test_neo4j_connection(config):
    """测试Neo4j连接"""
    logger.info(f"🔌 测试Neo4j连接: {config['uri']}")
    
    if not NEO4J_AVAILABLE:
        logger.error("❌ Neo4j驱动不可用")
        return False
    
    try:
        driver = GraphDatabase.driver(config['uri'], auth=(config['username'], config['password']))
        
        with driver.session(database=config['database']) as session:
            # 简单的连接测试
            result = session.run("RETURN 1 as test")
            record = result.single()
            
            if record and record["test"] == 1:
                logger.success("✅ Neo4j连接成功")
                
                # 获取基本数据库信息
                try:
                    db_info = session.run("CALL dbms.components() YIELD name, versions, edition LIMIT 1")
                    record = db_info.single()
                    if record:
                        logger.info(f"📊 数据库版本: {record['name']} {record['versions'][0]} ({record['edition']})")
                except Exception:
                    logger.info("📊 数据库信息获取跳过（权限限制）")
                
                driver.close()
                return True
            else:
                logger.error("❌ Neo4j连接测试失败")
                driver.close()
                return False
                
    except Exception as e:
        logger.error(f"❌ Neo4j连接失败: {e}")
        return False


def test_docker_service():
    """测试Docker服务状态"""
    logger.info("🐳 检查Docker服务状态")
    
    try:
        import subprocess
        
        # 检查docker-compose服务状态
        result = subprocess.run(
            ["docker-compose", "ps", "neo4j"],
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            output = result.stdout.strip()
            if "Up" in output:
                logger.success("✅ Neo4j Docker服务正在运行")
                return True
            else:
                logger.warning("⚠️ Neo4j Docker服务未运行")
                logger.info("💡 启动服务: cd deploy && docker-compose up -d neo4j")
                return False
        else:
            logger.error(f"❌ 检查Docker服务失败: {result.stderr}")
            return False
            
    except FileNotFoundError:
        logger.error("❌ docker-compose命令未找到")
        return False
    except Exception as e:
        logger.error(f"❌ 检查Docker服务时出错: {e}")
        return False


def main():
    """主测试函数"""
    logger.info("🚀 Neo4j基础连通性测试")
    logger.info("=" * 50)
    
    # 测试结果统计
    tests = []
    
    # 1. 测试Docker服务状态
    docker_ok = test_docker_service()
    tests.append(("Docker服务状态", docker_ok))
    
    # 2. 获取Neo4j配置
    config = get_neo4j_config()
    
    # 3. 测试Neo4j连接
    logger.info("\n🔧 开始连接测试")
    neo4j_ok = test_neo4j_connection(config)
    tests.append(("Neo4j连接", neo4j_ok))
    
    # 输出测试结果
    logger.info("\n" + "=" * 50)
    logger.info("📊 测试结果汇总:")
    
    passed = 0
    total = len(tests)
    
    for test_name, result in tests:
        status = "✅ 通过" if result else "❌ 失败"
        logger.info(f"  {test_name}: {status}")
        if result:
            passed += 1
    
    logger.info(f"\n🎯 总体结果: {passed}/{total} 项测试通过")
    
    if passed == total:
        logger.success("🎉 所有测试通过！Neo4j连接正常")
    else:
        logger.warning("⚠️ 部分测试失败，请检查配置和服务状态")
        
        # 提供故障排除建议
        logger.info("\n💡 故障排除建议:")
        logger.info("1. 确保Docker服务正在运行: docker-compose ps")
        logger.info("2. 启动Neo4j服务: cd deploy && docker-compose up -d neo4j")
        logger.info("3. 检查Neo4j日志: docker-compose logs neo4j")
        logger.info("4. 验证端口访问: curl http://localhost:7474")
        logger.info("5. 检查环境变量配置: .env文件")


if __name__ == "__main__":
    main()