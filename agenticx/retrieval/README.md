# M15: 智能检索系统

AgenticX框架的智能检索系统，提供统一、智能、可扩展的检索能力，支持从基础检索到完全Agentic化RAG流程的全栈解决方案。

## 🎯 战略定位

构建一个统一、智能、可扩展的检索系统，为AgenticX框架提供从基础检索能力到完全Agentic化RAG流程的全栈解决方案，实现检索的智能化、模块化和工具化。

## 🏗️ 架构设计

### 核心组件

```
M15 智能检索系统
├── 统一检索抽象层 (M15.1) ✅
├── 多策略检索引擎 (M15.2) ✅
├── 智能检索Agent (M15.3) ✅
├── RAG流程工具 (M15.4) ✅
└── 企业级检索平台 (M15.5) ⏳
```

### 设计优势

- **统一接口**: 所有检索组件使用相同的抽象接口
- **多策略支持**: 向量、BM25、图、混合等多种检索策略
- **智能决策**: Agent可以根据查询特征选择最佳策略
- **工具化集成**: RAG流程的每个环节都工具化
- **企业级特性**: 多租户、权限控制、监控审计
- **高度可扩展**: 支持自定义检索策略和Agent实现

## 📦 核心模块

### 1. 统一检索抽象层 (`agenticx.retrieval.base`)

**实现状态**: ✅ **已完成**

提供检索系统的基础数据结构和接口：

- `BaseRetriever(ABC)`: 所有检索器的抽象基类
- `RetrievalQuery(dataclass)`: 检索查询的数据模型
- `RetrievalResult(dataclass)`: 检索结果的数据模型
- `RetrievalType(Enum)`: 检索策略类型枚举
- `RetrievalError(Exception)`: 检索异常基类

### 2. 多策略检索引擎

**实现状态**: ✅ **已完成**

#### 2.1 向量检索器 (`agenticx.retrieval.vector_retriever`)

```python
from agenticx.retrieval import VectorRetriever

# 初始化向量检索器
retriever = VectorRetriever(
    tenant_id="tenant_1",
    embedding_provider=embedding_provider,
    vector_storage=vector_storage
)

# 添加文档
doc_ids = await retriever.add_documents(documents)

# 检索文档
results = await retriever.retrieve("查询文本")
```

#### 2.2 BM25检索器 (`agenticx.retrieval.bm25_retriever`)

```python
from agenticx.retrieval import BM25Retriever

# 初始化BM25检索器
retriever = BM25Retriever(tenant_id="tenant_1", k1=1.2, b=0.75)

# 添加文档
doc_ids = await retriever.add_documents(documents)

# 检索文档
results = await retriever.retrieve("关键词搜索")
```

#### 2.3 混合检索器 (`agenticx.retrieval.hybrid_retriever`)

```python
from agenticx.retrieval import HybridRetriever, HybridConfig

# 配置混合检索
config = HybridConfig(
    vector_weight=0.6,
    bm25_weight=0.4,
    deduplication_threshold=0.8
)

# 初始化混合检索器
retriever = HybridRetriever(
    vector_retriever=vector_retriever,
    bm25_retriever=bm25_retriever,
    config=config
)

# 混合检索
results = await retriever.retrieve("混合查询")
```

#### 2.4 图检索器 (`agenticx.retrieval.graph_retriever`)

```python
from agenticx.retrieval import GraphRetriever

# 初始化图检索器
retriever = GraphRetriever(
    tenant_id="tenant_1",
    graph_storage=graph_storage
)

# 添加文档（自动提取实体和关系）
doc_ids = await retriever.add_documents(documents)

# 图结构搜索
results = await retriever.retrieve("实体关系查询")
```

#### 2.5 自动检索器 (`agenticx.retrieval.auto_retriever`)

```python
from agenticx.retrieval import AutoRetriever

# 初始化自动检索器
retriever = AutoRetriever(
    retrievers={
        RetrievalType.VECTOR: vector_retriever,
        RetrievalType.BM25: bm25_retriever,
        RetrievalType.GRAPH: graph_retriever
    },
    query_analyzer=query_analyzer
)

# 自动选择最佳策略
results = await retriever.retrieve("智能查询")
```

### 3. 智能检索Agent

**实现状态**: ✅ **已完成**

#### 3.1 查询分析Agent (`agenticx.retrieval.agents.QueryAnalysisAgent`)

```python
from agenticx.retrieval import QueryAnalysisAgent

# 初始化查询分析Agent
agent = QueryAnalysisAgent(llm=llm)

# 分析查询
analysis = await agent.analyze_query("What is Python programming?")
print(f"Intent: {analysis.intent}")
print(f"Keywords: {analysis.keywords}")
print(f"Recommended strategy: {analysis.query_type.value}")
```

#### 3.2 检索Agent (`agenticx.retrieval.agents.RetrievalAgent`)

```python
from agenticx.retrieval import RetrievalAgent

# 初始化检索Agent
agent = RetrievalAgent(
    retrievers=retrievers,
    query_analyzer=query_analyzer
)

# 智能检索
results = await agent.retrieve("查询文本", context={"user_id": "user_1"})
```

#### 3.3 重排序Agent (`agenticx.retrieval.agents.RerankingAgent`)

```python
from agenticx.retrieval import RerankingAgent

# 初始化重排序Agent
agent = RerankingAgent(llm=llm)

# 智能重排序
reranked_results = await agent.rerank(results, "查询文本")
```

#### 3.4 索引Agent (`agenticx.retrieval.agents.IndexingAgent`)

```python
from agenticx.retrieval import IndexingAgent

# 初始化索引Agent
agent = IndexingAgent(llm=llm)

# 智能文档索引
doc_ids = await agent.index_documents(documents, retriever)
```

### 4. RAG流程工具

**实现状态**: ✅ **已完成**

#### 4.1 文档索引工具

```python
from agenticx.retrieval import DocumentIndexingTool

# 创建索引工具
tool = DocumentIndexingTool(
    indexing_agent=indexing_agent,
    retriever=retriever
)

# 执行索引
result = await tool.arun(
    documents=documents,
    collection_name="my_collection"
)
```

#### 4.2 检索工具

```python
from agenticx.retrieval import RetrievalTool

# 创建检索工具
tool = RetrievalTool(retrieval_agent=retrieval_agent)

# 执行检索
result = await tool.arun(
    query_text="查询文本",
    n_results=5
)
```

#### 4.3 重排序工具

```python
from agenticx.retrieval import RerankingTool

# 创建重排序工具
tool = RerankingTool(reranking_agent=reranking_agent)

# 执行重排序
result = await tool.arun(
    results=results,
    query="查询文本"
)
```

#### 4.4 查询修改工具

```python
from agenticx.retrieval import QueryModificationTool

# 创建查询修改工具
tool = QueryModificationTool(query_analyzer=query_analyzer)

# 修改查询
result = await tool.arun(
    original_query="原始查询",
    known_information="已知信息"
)
```

#### 4.5 答案生成工具

```python
from agenticx.retrieval import AnswerGenerationTool

# 创建答案生成工具
tool = AnswerGenerationTool(llm=llm)

# 生成答案
result = await tool.arun(
    original_query="查询",
    supporting_docs="支持文档"
)
```

#### 4.6 可答性判断工具

```python
from agenticx.retrieval import CanAnswerTool

# 创建可答性判断工具
tool = CanAnswerTool(llm=llm)

# 判断是否可回答
result = await tool.arun(
    user_query="用户查询",
    supporting_docs="支持文档"
)
```

### 5. 重排序器

**实现状态**: ✅ **已完成**

```python
from agenticx.retrieval import Reranker, RerankingConfig

# 配置重排序
config = RerankingConfig(
    relevance_weight=0.7,
    diversity_weight=0.3,
    max_results=10
)

# 初始化重排序器
reranker = Reranker(llm=llm, config=config)

# 重排序结果
reranked_results = await reranker.rerank(results, "查询文本")

# 多样性重排序
diverse_results = await reranker.rerank_for_diversity(
    results, "查询文本", diversity_weight=0.5
)

# 相关性重排序
relevant_results = await reranker.rerank_for_relevance(
    results, "查询文本", relevance_weight=0.9
)
```

## 🚀 快速开始

### 安装依赖

```bash
pip install agenticx
```

### 基本使用

```python
import asyncio
from agenticx.retrieval import (
    VectorRetriever, BM25Retriever, HybridRetriever,
    QueryAnalysisAgent, RetrievalAgent, Reranker
)

async def main():
    # 1. 创建检索器
    vector_retriever = VectorRetriever(
        tenant_id="demo",
        embedding_provider=embedding_provider,
        vector_storage=vector_storage
    )
    
    # 2. 添加文档
    documents = [
        {"content": "Python is a programming language", "metadata": {"type": "programming"}},
        {"content": "Machine learning uses Python", "metadata": {"type": "ai"}}
    ]
    await vector_retriever.add_documents(documents)
    
    # 3. 检索文档
    results = await vector_retriever.retrieve("Python programming")
    
    # 4. 重排序
    reranker = Reranker(llm=llm)
    reranked_results = await reranker.rerank(results, "Python programming")
    
    print(f"Found {len(reranked_results)} results")

asyncio.run(main())
```

### 完整RAG工作流

```python
import asyncio
from agenticx.retrieval import (
    DocumentIndexingTool, RetrievalTool, RerankingTool,
    AnswerGenerationTool, CanAnswerTool
)

async def rag_workflow():
    # 1. 文档索引
    indexing_tool = DocumentIndexingTool(indexing_agent, retriever)
    await indexing_tool.arun(documents=documents, collection_name="knowledge_base")
    
    # 2. 检索
    retrieval_tool = RetrievalTool(retrieval_agent)
    results = await retrieval_tool.arun(query_text="用户查询", n_results=5)
    
    # 3. 重排序
    reranking_tool = RerankingTool(reranking_agent)
    reranked_results = await reranking_tool.arun(results=results, query="用户查询")
    
    # 4. 判断可答性
    can_answer_tool = CanAnswerTool(llm)
    can_answer = await can_answer_tool.arun(
        user_query="用户查询",
        supporting_docs=reranked_results
    )
    
    # 5. 生成答案
    if can_answer == "yes":
        answer_tool = AnswerGenerationTool(llm)
        answer = await answer_tool.arun(
            original_query="用户查询",
            supporting_docs=reranked_results
        )
        return answer
    else:
        return "抱歉，我无法回答这个问题。"

asyncio.run(rag_workflow())
```

## 🧪 测试

运行测试套件：

```bash
# 运行所有测试
pytest tests/test_m15_retrieval.py -v

# 运行特定测试
pytest tests/test_m15_retrieval.py::TestM15RetrievalSystem::test_bm25_retriever -v
```

## 📊 性能监控

### 获取统计信息

```python
# 获取检索器统计
stats = await retriever.get_stats()
print(f"Total documents: {stats['total_documents']}")
print(f"Retriever type: {stats['retriever_type']}")

# 获取Agent统计
agent_stats = await agent.get_stats()
print(f"Agent performance: {agent_stats}")
```

### 性能指标

- **检索准确率**: 基于相关性评分
- **响应时间**: 检索和重排序延迟
- **吞吐量**: 每秒查询处理量
- **资源使用**: CPU、内存、存储使用情况

## 🔧 配置

### 检索器配置

```python
# BM25配置
bm25_config = {
    "k1": 1.2,  # 词频饱和参数
    "b": 0.75   # 长度归一化参数
}

# 混合检索配置
hybrid_config = HybridConfig(
    vector_weight=0.6,
    bm25_weight=0.4,
    deduplication_threshold=0.8
)

# 重排序配置
reranking_config = RerankingConfig(
    relevance_weight=0.7,
    diversity_weight=0.3,
    max_results=10,
    min_score_threshold=0.1
)
```

### 企业级配置

```python
# 多租户配置
tenant_config = {
    "tenant_id": "enterprise_1",
    "quota": {
        "max_documents": 1000000,
        "max_queries_per_minute": 1000
    },
    "storage": {
        "vector_db": "chroma",
        "graph_db": "neo4j"
    }
}

# 访问控制配置
access_config = {
    "rbac_enabled": True,
    "roles": ["admin", "user", "readonly"],
    "permissions": {
        "admin": ["read", "write", "delete"],
        "user": ["read", "write"],
        "readonly": ["read"]
    }
}
```

## 🔮 未来规划

### M15.5 企业级检索平台 ⏳

- [ ] `RetrievalTenantManager`: 多租户管理服务
- [ ] `RetrievalAccessControl`: 访问控制服务
- [ ] `RetrievalPerformanceMonitor`: 性能监控服务
- [ ] `RetrievalAuditLogger`: 审计日志服务
- [ ] `RetrievalRateLimiter`: 速率限制服务
- [ ] `RetrievalHealthChecker`: 健康检查服务

### 高级功能

- [ ] 实时索引更新
- [ ] 分布式检索集群
- [ ] 高级查询语言支持
- [ ] 个性化检索
- [ ] 多模态检索
- [ ] 联邦检索

## 🤝 贡献

欢迎贡献代码！请查看我们的贡献指南。

## 📄 许可证

本项目采用 MIT 许可证。

## 📞 支持

如有问题，请提交 Issue 或联系开发团队。 