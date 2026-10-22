# AgenticX Docker 数据库部署方案

## 📋 概述

本项目提供了完整的Docker部署方案，支持AgenticX框架所需的各种数据库和存储服务。

## 🗂️ 目录结构

```
deploy/
├── README.md                    # 本文档
├── docker-compose.yml           # 主配置文件
├── env.example                  # 环境变量示例
├── test_connectivity.py         # 连接测试脚本
├── configs/                     # 配置文件
│   ├── redis.conf              # Redis配置
│   ├── postgresql.conf         # PostgreSQL配置
│   └── prometheus.yml          # Prometheus配置
└── data/                       # 数据卷目录
    ├── postgres/               # PostgreSQL数据
    ├── redis/                  # Redis数据
    ├── mongodb/                # MongoDB数据
    ├── milvus/                 # Milvus数据
    ├── qdrant/                 # Qdrant数据
    ├── neo4j/                  # Neo4j数据
    ├── elasticsearch/          # Elasticsearch数据
    └── minio/                  # MinIO数据
```

## 🚀 快速开始

### 1. 克隆项目
```bash
git clone <your-repo>
cd AgenticX
```

### 2. 配置环境变量
```bash
cp deploy/env.example deploy/.env
# 编辑 .env 文件，设置必要的环境变量
```

### 3. 启动所有服务
```bash
cd deploy
docker-compose up -d
```

### 4. 检查服务状态
```bash
# 查看所有服务状态
docker-compose ps

# 运行连接测试
python test_connectivity.py
```

## 📊 支持的数据库服务

### Key-Value Storage
- **Redis** (7.2-alpine): 高性能缓存和会话存储
- **PostgreSQL** (15-alpine): 关系型数据库
- **MongoDB** (7.0): 文档型数据库
- **SQLite**: 轻量级本地数据库

### Vector Storage
- **Milvus** (2.3.3): 向量数据库
- **Qdrant** (1.7.4): 向量搜索引擎
- **Chroma** (0.4.22): 向量数据库
- **Weaviate** (1.39.13): 向量搜索引擎
- **Elasticsearch** (8.11.3): 搜索引擎 + 向量搜索

### Graph Storage
- **Neo4j** (5.15.0): 图数据库
- **Nebula Graph** (3.6.0): 分布式图数据库

### Object Storage
- **MinIO** (RELEASE.2024-01-16T16-07-38Z): S3兼容对象存储

### 监控和日志
- **Prometheus** (2.48.1): 监控系统
- **Grafana** (10.2.3): 可视化面板
- **Jaeger** (1.48.0): 分布式追踪

## 🛠️ 部署操作

### 启动所有服务
```bash
cd deploy
docker-compose up -d
```

### 停止所有服务
```bash
cd deploy
docker-compose down
```

### 重启服务
```bash
cd deploy
docker-compose restart
```

### 查看服务状态
```bash
# 查看所有服务状态
docker-compose ps

# 查看服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f postgres
docker-compose logs -f redis
docker-compose logs -f milvus
```

### 健康检查
```bash
# 运行连接测试脚本
python test_connectivity.py

# 手动检查服务状态
docker-compose exec postgres pg_isready -U postgres
docker-compose exec redis redis-cli ping
docker-compose exec mongodb mongosh --eval "db.adminCommand('ping')"
```

## 🔧 详细配置

### 环境变量配置

```bash
# 数据库连接配置
POSTGRES_DB=agenticx
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_HOST=postgres
POSTGRES_PORT=5432

REDIS_PASSWORD=password
REDIS_HOST=redis
REDIS_PORT=6379

MONGODB_DB=agenticx
MONGODB_USER=admin
MONGODB_PASSWORD=password
MONGODB_HOST=mongodb
MONGODB_PORT=27017

# 向量数据库配置
MILVUS_HOST=milvus
MILVUS_PORT=19530
QDANT_HOST=qdrant
QDANT_PORT=6333
CHROMA_HOST=chroma
CHROMA_PORT=8000
WEAVIATE_HOST=weaviate
WEAVIATE_PORT=8080

# 图数据库配置
NEO4J_PASSWORD=password
NEO4J_HOST=neo4j
NEO4J_PORT=7687

# 对象存储配置
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=password
MINIO_HOST=minio
MINIO_PORT=9000

# 监控配置
PROMETHEUS_PORT=9090
GRAFANA_PORT=3000
JAEGER_PORT=16686
```

### 端口映射

| 服务 | 端口 | 说明 |
|------|------|------|
| PostgreSQL | 5432 | 关系型数据库 |
| Redis | 6379 | 缓存数据库 |
| MongoDB | 27017 | 文档数据库 |
| Milvus | 19530 | 向量数据库 |
| Qdrant | 6333 | 向量搜索引擎 |
| Chroma | 8000 | 向量数据库 |
| Weaviate | 8080 | 向量搜索引擎 |
| Weaviate gRPC | 50051 | Python v4 客户端必需 |
| Neo4j | 7687 | 图数据库 |
| Elasticsearch | 9200 | 搜索引擎 |
| MinIO | 9000 | 对象存储 |
| Prometheus | 9090 | 监控系统 |
| Grafana | 3000 | 可视化面板 |
| Jaeger | 16686 | 分布式追踪 |

### 升级 Weaviate

Weaviate 只支持逐个小版本升级（1.22 → 1.23 → … → 1.39），不能直接从 1.22.4 跳到 1.39.13。如果 `./data/weaviate` 里已有数据：

- 数据可以重建（例如只是开发测试数据）：`docker-compose stop weaviate`，删除 `./data/weaviate`，再 `docker-compose up -d weaviate`。
- 需要保留数据：先导出数据再在新版本中重新导入，或者依次把镜像切换到每个小版本的最新补丁版并启动一次，直到 1.39.13。

参见 [Weaviate 升级说明](https://docs.weaviate.io/deploy/migration)。

## 📈 监控和可视化

### Prometheus + Grafana
- 访问 Grafana: http://localhost:3000
- 默认用户名/密码: admin/admin
- 数据源: Prometheus (http://prometheus:9090)

### Jaeger 分布式追踪
- 访问 Jaeger UI: http://localhost:16686

## 🔍 数据库连接测试

### PostgreSQL
```bash
docker exec -it deploy-postgres-1 psql -U postgres -d agenticx
```

### Redis
```bash
docker exec -it deploy-redis-1 redis-cli -a password
```

### MongoDB
```bash
docker exec -it deploy-mongodb-1 mongosh -u admin -p password
```

### Milvus
```bash
docker exec -it deploy-milvus-1 milvus_cli
```

### Neo4j
Neo4j是AgenticX知识图谱的主要存储后端，支持复杂的图查询和可视化。

#### 连接Neo4j
```bash
# 使用cypher-shell连接
docker exec -it deploy-neo4j-1 cypher-shell -u neo4j -p password

# 或者通过Web界面访问
# 浏览器打开: http://localhost:7474
# 用户名: neo4j
# 密码: password (或环境变量中设置的密码)
```

#### 知识图谱配置
在 `agenticx/configs/knowledge_graphers_config.yml` 中配置Neo4j：

```yaml
grapher:
  graphrag:
    neo4j:
      enabled: true  # 启用Neo4j导出
      uri: "bolt://localhost:7687"
      username: "neo4j"
      password: "password"
      database: "neo4j"
      auto_export: true  # 自动导出构建的图谱
      clear_on_export: true  # 导出前清空现有数据
```

#### 使用示例
```python
from agenticx.knowledge.graphers import KnowledgeGraphBuilder

# 构建知识图谱
builder = KnowledgeGraphBuilder(config, llm_config)
graph = builder.build_from_texts(texts)

# 导出到Neo4j
graph.export_to_neo4j(
    uri="bolt://localhost:7687",
    username="neo4j", 
    password="password"
)
```

#### 常用Cypher查询
```cypher
// 查看所有节点类型
MATCH (n) RETURN DISTINCT labels(n), count(n)

// 查看所有关系类型
MATCH ()-[r]-() RETURN DISTINCT type(r), count(r)

// 查找特定实体
MATCH (p:Person {name: "张三"}) RETURN p

// 查找关系路径
MATCH path = (a:Person)-[*1..3]-(b:Organization)
WHERE a.name = "张三"
RETURN path LIMIT 10
```

## 🚨 故障排除

### 常见问题

1. **端口冲突**
   ```bash
   # 检查端口占用
   netstat -tulpn | grep :5432
   # 修改 docker-compose.yml 中的端口映射
   ```

2. **数据卷权限问题**
   ```bash
   # 修复数据卷权限
   sudo chown -R 1000:1000 data/
   ```

3. **内存不足**
   ```bash
   # 增加Docker内存限制
   # 在Docker Desktop设置中调整内存限制
   ```

4. **服务启动失败**
   ```bash
   # 查看详细日志
   docker-compose logs -f [service-name]
   
   # 重新构建服务
   docker-compose up -d --build [service-name]
   ```

### 性能优化

1. **调整内存限制**
   ```yaml
   # 在 docker-compose.yml 中为服务添加资源限制
   deploy:
     resources:
       limits:
         memory: 2G
         cpus: '2.0'
   ```

2. **启用数据持久化**
   ```yaml
   # 确保数据卷正确挂载
   volumes:
     - ./data/postgres:/var/lib/postgresql/data
     - ./data/redis:/data
   ```

## 📚 参考资料

- [Docker Compose 官方文档](https://docs.docker.com/compose/)
- [PostgreSQL Docker 镜像](https://hub.docker.com/_/postgres)
- [Redis Docker 镜像](https://hub.docker.com/_/redis)
- [Milvus 官方文档](https://milvus.io/docs)
- [Qdrant 官方文档](https://qdrant.tech/documentation/)
- [Neo4j Docker 镜像](https://hub.docker.com/_/neo4j)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个部署方案！

## 📄 许可证

本项目采用 MIT 许可证。