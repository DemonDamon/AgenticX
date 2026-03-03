# 每日灵感助手

简单对话智能体示例：用户发送任意问题，助手流式回复一句简短的创意/灵感。集成生产级 API 基础设施（P1-P6：中间件、任务队列、多租户、JWT、健康探针、重试降级）。

## 启动服务

```bash
cd examples/simple_chat_agent
python serve.py
# 或指定端口
python serve.py --port 9000
```

## 流式 API 调用

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "inspiration",
    "messages": [{"role": "user", "content": "今天有什么灵感？"}],
    "stream": true
  }'
```

## 配置 LLM（可选）

在同目录下放置 `.env` 文件，`serve.py` 会自动加载。优先级：百炼 > OpenAI > 预制回复。

- **百炼（阿里云 Dashscope）**：设置 `BAILIAN_API_KEY`、`BAILIAN_API_BASE`、`BAILIAN_CHAT_MODEL`（如 qwen-plus）
- **OpenAI**：设置 `OPENAI_API_KEY`，将使用 gpt-3.5-turbo 流式回复
- **无配置**：使用预制回复模拟流式输出，0 配置即可运行

## 测试方式

### 1. 自动化测试（推荐）

```bash
cd examples/simple_chat_agent
python test_api.py              # TestClient 模式，无需启动服务
python test_api.py --live       # 请求真实服务（需先 python serve.py）
python test_api.py --live --url http://localhost:9000
```

覆盖 P1-P6 能力：健康探针、Request-ID、任务队列、JWT 认证、多租户、流式对话。

### 2. 手动 curl 测试

| 能力 | 命令 |
|------|------|
| 健康探针 | `curl http://localhost:8000/health/live` |
| 任务提交 | `curl -X POST http://localhost:8000/tasks/submit -H "Content-Type: application/json" -d '{"name":"test","payload":{}}'` |
| 任务状态 | `curl http://localhost:8000/tasks/{task_id}/status` |
| 用户注册 | `curl -X POST http://localhost:8000/api/register -H "Content-Type: application/json" -d '{"email":"u@test.com","password":"Pwd123!","username":"u"}'` |
| 用户登录 | `curl -X POST http://localhost:8000/api/login -H "Content-Type: application/json" -d '{"email":"u@test.com","password":"Pwd123!"}'` |
| 多租户 | `curl -H "X-Tenant-ID: tenant-1" http://localhost:8000/health/live` |
| 流式对话 | 见上文「流式 API 调用」 |
