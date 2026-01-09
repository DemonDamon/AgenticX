# AgenticX Agent Server

AgenticX Agent Server 提供 HTTP API 服务，将 Agent 暴露为 OpenAI 兼容的 RESTful API。

## 核心特性

- **OpenAI 兼容**: 完整支持 Chat Completions API
- **流式响应**: 支持 Server-Sent Events (SSE)
- **灵活集成**: 支持自定义 Agent 处理函数
- **CORS 支持**: 内置跨域资源共享支持

## 快速开始

### 基本使用

```python
from agenticx.server import AgentServer

# 定义 Agent 处理函数
async def my_agent(request):
    # 获取用户消息
    user_message = request.messages[-1].content
    
    # 处理并返回响应
    return f"您说的是: {user_message}"

# 创建并启动服务器
server = AgentServer(agent_handler=my_agent)
server.run(port=8000)
```

### 流式响应

```python
async def my_stream_agent(request):
    """流式 Agent"""
    yield "正在"
    yield "处理"
    yield "您的"
    yield "请求..."

server = AgentServer(stream_handler=my_stream_agent)
server.run(port=8000)
```

## API 端点

### Chat Completions

```bash
# 非流式请求
curl http://localhost:8000/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agenticx",
    "messages": [{"role": "user", "content": "你好"}]
  }'

# 流式请求
curl http://localhost:8000/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agenticx",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

### 模型列表

```bash
curl http://localhost:8000/openai/v1/models
```

### 健康检查

```bash
curl http://localhost:8000/health
```

## 与 OpenAI SDK 集成

```python
from openai import OpenAI

# 连接到 AgenticX Server
client = OpenAI(
    base_url="http://localhost:8000/openai/v1",
    api_key="not-needed",  # AgenticX 不需要 API 密钥
)

# 发送请求
response = client.chat.completions.create(
    model="agenticx",
    messages=[{"role": "user", "content": "你好"}],
)

print(response.choices[0].message.content)
```

## 高级配置

### 自定义模型名称

```python
server = AgentServer(
    agent_handler=my_agent,
    model_name="my-custom-agent",
)
```

### CORS 配置

```python
server = AgentServer(
    agent_handler=my_agent,
    cors_origins=["http://localhost:3000", "https://myapp.com"],
)
```

### 使用 FastAPI 应用

```python
from agenticx.server import AgentServer

server = AgentServer(agent_handler=my_agent)

# 获取 FastAPI 应用实例
app = server.app

# 添加自定义路由
@app.get("/custom")
async def custom_endpoint():
    return {"message": "自定义端点"}
```

## 集成 AgenticX Agent

```python
from agenticx.server import AgentServer, ChatCompletionRequest
from agenticx.agents import MyAgent  # 您的 Agent 类

# 创建 Agent 实例
agent = MyAgent()

async def agent_handler(request: ChatCompletionRequest) -> str:
    """将请求转发给 Agent"""
    # 获取用户消息
    user_message = request.messages[-1].content
    
    # 调用 Agent
    result = await agent.run(user_message)
    
    return result

server = AgentServer(agent_handler=agent_handler)
server.run(port=8000)
```

## 请求/响应格式

### 请求格式

```json
{
  "model": "agenticx",
  "messages": [
    {"role": "system", "content": "你是一个有帮助的助手"},
    {"role": "user", "content": "你好"}
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false
}
```

### 响应格式

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "agenticx",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！有什么我可以帮助你的吗？"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 15,
    "total_tokens": 25
  }
}
```

### 流式响应格式

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"你好"}}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

## 部署

### 使用 uvicorn

```bash
uvicorn agenticx.server:app --host 0.0.0.0 --port 8000 --workers 4
```

### 使用 Docker

```dockerfile
FROM python:3.10-slim
WORKDIR /app
COPY . .
RUN pip install agenticx[server]
EXPOSE 8000
CMD ["python", "-m", "agenticx.server", "--port", "8000"]
```

## 架构图

```
┌─────────────────────────────────────────┐
│               HTTP Client               │
│  (OpenAI SDK, curl, 浏览器)              │
└─────────────────┬───────────────────────┘
                  │ HTTP/SSE
┌─────────────────▼───────────────────────┐
│             AgentServer                 │
│  (FastAPI, CORS, 路由)                   │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│        OpenAIProtocolHandler            │
│  (请求解析, 响应构建, 流式处理)           │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│           Agent Handler                 │
│  (您的 Agent 实现)                       │
└─────────────────────────────────────────┘
```
