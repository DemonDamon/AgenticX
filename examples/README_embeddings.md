# AgenticX Embeddings 模块使用指南

## 概述

AgenticX Embeddings 模块提供了统一的向量嵌入服务层，支持多种主流 embedding 服务，包括 OpenAI、SiliconFlow、Bailian、LiteLLM 等。该模块为框架内所有需要文本向量化的场景（如记忆、检索、RAG、知识库等）提供统一的 API。

## 核心特性

- ✅ **多服务支持**: 支持 OpenAI、SiliconFlow、Bailian、LiteLLM 等主流 embedding 服务
- ✅ **动态路由**: 自动选择最佳 embedding 服务，支持 fallback 机制
- ✅ **批量处理**: 支持批量文本向量化，提高效率
- ✅ **统一接口**: 所有 provider 都遵循相同的接口规范
- ✅ **错误处理**: 完善的异常处理和重试机制
- ✅ **配置管理**: 支持环境变量和配置文件管理

## 快速开始

### 1. 环境配置

复制环境变量模板并填入您的 API Key：

```bash
cp examples/env_template.txt .env
```

编辑 `.env` 文件，填入相应的 API Key：

```env
# SiliconFlow Embedding
SILICONFLOW_API_KEY=your_siliconflow_api_key_here
SILICONFLOW_API_BASE=https://api.siliconflow.cn/v1/embeddings
SILICONFLOW_DEFAULT_MODEL=BAAI/bge-large-zh-v1.5

# Bailian Embedding
BAILIAN_API_KEY=your_bailian_api_key_here
BAILIAN_API_BASE=https://api.bailian.aliyun.com/v1/embeddings
BAILIAN_DEFAULT_MODEL=bge-large-zh-v1.5

# OpenAI Embedding
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_API_BASE=https://api.openai.com/v1
```

### 2. 基本使用

```python
from agenticx.embeddings import (
    SiliconFlowEmbeddingProvider,
    OpenAIEmbeddingProvider,
    EmbeddingRouter
)

# 使用 SiliconFlow
provider = SiliconFlowEmbeddingProvider(
    api_key="your_key",
    model="BAAI/bge-large-zh-v1.5"
)

# 单个文本向量化
text = "这是一个测试句子"
embedding = provider.embed([text])[0]

# 批量向量化
texts = ["句子1", "句子2", "句子3"]
embeddings = provider.embed(texts)
```

### 3. 动态路由

```python
from agenticx.embeddings import EmbeddingRouter

# 创建多个 provider
providers = [
    SiliconFlowEmbeddingProvider(api_key="key1"),
    OpenAIEmbeddingProvider(api_key="key2"),
    # 更多 provider...
]

# 创建路由器
router = EmbeddingRouter(providers)

# 自动选择最佳服务
embeddings = router.embed(["测试文本"])
```

## 支持的模型

### SiliconFlow
- `BAAI/bge-large-zh-v1.5` - 中文大模型
- `BAAI/bge-large-en-v1.5` - 英文大模型
- `BAAI/bge-m3` - 多语言模型
- `Qwen/Qwen3-Embedding-8B` - 通义千问 8B
- `Qwen/Qwen3-Embedding-4B` - 通义千问 4B
- `Qwen/Qwen3-Embedding-0.6B` - 通义千问 0.6B
- `netease-youdao/bce-embedding-base_v1` - 网易有道

### OpenAI
- `text-embedding-ada-002` - Ada 002
- `text-embedding-3-small` - Embedding 3 Small
- `text-embedding-3-large` - Embedding 3 Large

### LiteLLM
- 支持所有通过 LiteLLM 兼容的 embedding 模型

## 示例脚本

运行示例脚本测试不同模型的能力：

```bash
python examples/embeddings_demo.py
```

该脚本会：
1. 演示基本用法
2. 测试不同 embedding 模型
3. 计算中文句子的余弦相似度
4. 生成模型性能对比报告
5. 测试路由器的 fallback 功能

## 性能对比

基于测试结果，推荐模型选择：

### 中文文本
- **最佳**: `BAAI/bge-large-zh-v1.5` (SiliconFlow)
- **备选**: `netease-youdao/bce-embedding-base_v1` (SiliconFlow)

### 英文文本
- **最佳**: `text-embedding-3-large` (OpenAI)
- **备选**: `BAAI/bge-large-en-v1.5` (SiliconFlow)

### 多语言场景
- **最佳**: `Qwen/Qwen3-Embedding-8B` (SiliconFlow)
- **备选**: `BAAI/bge-m3` (SiliconFlow)

## 集成到其他模块

### 记忆系统集成

```python
from agenticx.memory import HybridSearchEngine
from agenticx.embeddings import SiliconFlowEmbeddingProvider

# 创建 embedding provider
embedding_provider = SiliconFlowEmbeddingProvider(
    api_key="your_key",
    model="BAAI/bge-large-zh-v1.5"
)

# 集成到混合搜索引擎
search_engine = HybridSearchEngine(
    embedding_provider=embedding_provider
)
```

### 工具系统集成

```python
from agenticx.tools import FunctionTool
from agenticx.embeddings import EmbeddingRouter

# 在工具中使用 embedding
@tool
def semantic_search(query: str, documents: List[str]):
    router = EmbeddingRouter([your_providers])
    query_embedding = router.embed([query])[0]
    # 进行语义搜索...
```

## 错误处理

```python
from agenticx.embeddings import EmbeddingError

try:
    embeddings = provider.embed(texts)
except EmbeddingError as e:
    print(f"Embedding 错误: {e}")
    # 处理错误...
```

## 扩展自定义 Provider

```python
from agenticx.embeddings import BaseEmbeddingProvider

class CustomEmbeddingProvider(BaseEmbeddingProvider):
    def __init__(self, api_key: str, model: str = "custom-model"):
        self.api_key = api_key
        self.model = model
    
    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        # 实现自定义 embedding 逻辑
        embeddings = []
        for text in texts:
            # 调用您的 embedding 服务
            embedding = self._call_custom_api(text)
            embeddings.append(embedding)
        return embeddings
```

## 最佳实践

1. **选择合适的模型**: 根据文本语言和任务类型选择最适合的模型
2. **使用动态路由**: 在生产环境中使用 `EmbeddingRouter` 确保高可用性
3. **批量处理**: 尽可能批量处理文本以提高效率
4. **错误处理**: 实现完善的错误处理和重试机制
5. **监控成本**: 监控 API 调用量和成本，合理设置配额

## 故障排除

### 常见问题

1. **API Key 无效**
   - 检查环境变量是否正确设置
   - 确认 API Key 是否有效

2. **模型不存在**
   - 检查模型名称是否正确
   - 确认该模型在对应服务中可用

3. **网络连接问题**
   - 检查网络连接
   - 确认 API 端点是否可访问

4. **向量维度不匹配**
   - 确保所有文本使用相同的模型
   - 检查向量维度是否一致

## 更新日志

- **v1.0.0**: 初始版本，支持 OpenAI、SiliconFlow、Bailian、LiteLLM
- **v1.1.0**: 添加动态路由和 fallback 功能
- **v1.2.0**: 完善错误处理和配置管理 