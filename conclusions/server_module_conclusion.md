# AgenticX Server 模块总结

> 结论更新时间：2026-05-29（覆盖 2026-03-04 之后的变更）

## 目录路径
`/Users/damon/myWork/AgenticX/agenticx/server`

## 模块概述

Server 模块提供 Agent HTTP Server 功能，支持 OpenAI Chat Completions API 兼容接口，可将 AgenticX Agent 暴露为 RESTful API 服务。

## 完整目录结构

```
agenticx/server/
├── __init__.py          # 模块入口，导出核心 API（含 Redis 组件）
├── types.py             # 类型定义（消息、请求、响应）
├── protocol.py          # 协议处理器抽象
├── openai_protocol.py   # OpenAI 协议实现
├── server.py            # HTTP 服务器（AgentServer，接受 redis_url）
├── api_models.py        # API 请求/响应模型
├── api_routes.py        # 生产级 API 路由（/tasks/*, /health/*, /api/*）
├── event_hooks.py       # 事件钩子
├── webhook.py           # Webhook 触发端点（/hooks/wake、/hooks/agent，token 校验）
├── sse_adapter.py       # WorkforceEventBus → SSE 流转换
├── sse_formatter.py     # SSE 事件格式化
├── redis_backend.py     # Redis 共享状态后端（连接池、限流、断路器、任务持久化）
├── middleware.py        # 生产级中间件（RequestId/Timeout/RateLimit/CircuitBreaker）
├── auth.py              # JWT 认证中间件与 API-Key 验证
├── tenant.py            # 多租户上下文（TenantContext / TenantIsolationMiddleware）
├── task_queue.py        # 异步任务队列（Redis 持久化）
├── health.py            # 深度健康检查与自愈（含 Redis 探针）
├── resilience.py        # 重试/幂等/降级（IdempotencyStore + RedisIdempotencyStore）
└── user_manager.py      # 用户管理与 JWT 生成（SQLite 存储）
```

---

## 核心组件

### types.py - 类型定义

**枚举类型**：
- `MessageRole`: 消息角色（system, user, assistant, tool）
- `FinishReason`: 完成原因（stop, length, tool_calls, content_filter）

**消息类型**：
- `Message`: 聊天消息，包含 role/content/name/tool_calls

**请求/响应**：
- `ChatCompletionRequest`: 聊天完成请求
  - messages: 消息列表
  - model: 模型名称
  - stream: 是否流式
  - temperature/max_tokens 等参数
- `ChatCompletionResponse`: 聊天完成响应
  - id, object, created, model
  - choices: 选择列表
  - usage: Token 使用统计
- `ChatCompletionChunk`: 流式响应块

**辅助类型**：
- `Choice`: 响应选择项
- `StreamChoice`: 流式选择项
- `Usage`: Token 使用量
- `ModelInfo`: 模型信息
- `ModelsResponse`: 模型列表响应
- `ErrorResponse`: 错误响应

### protocol.py - 协议抽象

**ProtocolHandler**：协议处理器抽象基类
- `handle_request()`: 处理请求
- `handle_stream()`: 处理流式请求
- `get_models()`: 获取模型列表

### openai_protocol.py - OpenAI 协议实现

**OpenAIProtocolHandler**：OpenAI Chat Completions API 兼容实现
- 将 Agent 处理函数包装为 OpenAI API 格式
- 支持同步和流式响应
- 自动生成响应 ID 和时间戳

**类型别名**：
- `AgentHandler`: 同步 Agent 处理函数类型
- `StreamAgentHandler`: 流式 Agent 处理函数类型

### server.py - HTTP 服务器

**AgentServer**：Agent HTTP Server 核心类
- 基于 FastAPI 构建
- 支持 CORS 跨域
- 提供健康检查端点

**API 端点**：
- `POST /v1/chat/completions`: OpenAI 兼容的聊天完成接口
- `GET /v1/models`: 模型列表
- `GET /health`: 健康检查

**便捷函数**：
- `create_server()`: 快速创建服务器实例

### 生命周期事件与 Webhook（webhook.py，新增）

在 HTTP 请求处理与 Agent 执行链路中接入声明式 Hooks 事件总线：

- **生命周期事件派发**：`AgentExecutor` 发射 `agent:start/stop/error`、`session:start/end`、`command:new/stop`；`AgentServer` 在 HTTP 请求处理中发射 `server:startup/shutdown`、`message:received/preprocessed/sent`
- **Webhook 触发端点**：`webhook.py` 提供 `/hooks/wake` 与 `/hooks/agent`，允许外部系统以 token 校验方式触发 wake / agent 流程；路由在启用时由 server 挂载
- **安全性**：去重已发现的 hook 注册，异步运行时下保持触发行为安全

> 关联 plan：`agenticx_hooks_evolution_cdc21916`

---

## 使用示例

### 基础用法
```python
from agenticx.server import AgentServer

async def my_agent(request):
    # 处理请求并返回响应
    messages = request.messages
    user_message = messages[-1].content
    return f"You said: {user_message}"

server = AgentServer(agent_handler=my_agent)
server.run(port=8000)
```

### 流式响应
```python
from agenticx.server import AgentServer

async def my_stream_agent(request):
    yield "Hello "
    yield "from "
    yield "AgenticX!"

server = AgentServer(stream_handler=my_stream_agent)
server.run(port=8000)
```

### 自定义配置
```python
from agenticx.server import AgentServer

server = AgentServer(
    agent_handler=my_agent,
    model_name="my-custom-model",
    title="My Agent API",
    version="2.0.0",
    cors_origins=["https://myapp.com"],
)
server.run(host="0.0.0.0", port=8080)
```

### 客户端调用
```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="not-needed"  # AgenticX 不需要 API key
)

response = client.chat.completions.create(
    model="agenticx",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

---

## 依赖关系

- **必需依赖**：FastAPI, uvicorn
- **可选集成**：与 `agenticx.agents` 模块配合使用

---

## 设计特点

1. **OpenAI 兼容**：完全兼容 OpenAI Chat Completions API，可使用官方 SDK 调用
2. **流式支持**：原生支持 SSE 流式响应
3. **轻量级**：最小依赖，易于部署
4. **可扩展**：协议抽象设计，可扩展其他 API 格式
