# AgenticX + AgentKit 集成指南

基于 AgenticX 构建智能体，一键部署到火山引擎 AgentKit 平台。

## 前置要求

```bash
# 安装 AgenticX（轻量核心，秒装）
pip install agenticx

# 安装火山引擎 AgentKit 相关依赖
pip install "agenticx[volcengine]"

# 验证
python -c "import agenticx; print(f'AgenticX {agenticx.__version__}')"
```

配置火山引擎凭证：

```bash
export MODEL_AGENT_API_KEY="your-api-key"
export MODEL_AGENT_NAME="ep-xxxxx"   # 或 doubao-seed-1-6
```

---

## 快速开始（5 分钟）

```bash
# 1. 初始化项目
agx volcengine init --template basic --name my-agent
cd my-agent

# 2. 本地测试
python test_local.py

# 3. 部署到云端
agx volcengine deploy --module agent --var agent --auto-launch

# 4. 调用已部署的智能体
agx volcengine invoke "Hello!"
```

---

## 创建智能体

### 初始化项目

```bash
agx volcengine init --template basic --name hello-agent
cd hello-agent
```

生成的项目结构：

```
hello-agent/
├── agent.py           # 智能体定义（编辑这里）
├── requirements.txt   # 依赖声明
└── README.md          # 项目说明
```

### 编写 agent.py

```python
from agenticx.core import Agent
from agenticx.tools import BaseTool

class GreetingTool(BaseTool):
    name = "greet"
    description = "Greet a user by name"

    def invoke(self, name: str) -> str:
        return f"Hello, {name}! Welcome to AgenticX + AgentKit."

agent = Agent(
    name="hello-agent",
    role="Friendly Assistant",
    goal="Greet users warmly",
    backstory="You are a helpful assistant."
)
agent.add_tool(GreetingTool())
```

### 本地测试

```python
# test_local.py
from agent import agent

task = agent.create_task("Greet Alice")
result = agent.run(task)
print(result)
```

```bash
python test_local.py
```

---

## 部署到 AgentKit

### 验证配置

```bash
agx volcengine deploy --module agent --var agent --dry-run
```

### 部署

```bash
agx volcengine deploy --module agent --var agent --auto-launch
```

### 查看状态与日志

```bash
agx volcengine status
agx volcengine logs --follow
```

### 远程调用

```bash
agx volcengine invoke "Your message"
agx volcengine invoke --stream    # 流式响应
```

### 清理资源

```bash
agx volcengine destroy
```

---

## 5 种部署模式

| 模式 | 用途 | 初始化命令 |
|------|------|-----------|
| **Basic** | 简单 HTTP API | `agx volcengine init --template basic` |
| **Stream** | 实时流式输出 | `agx volcengine init --template basic_stream` |
| **MCP** | 工具自动发现与共享 | `agx volcengine init --template mcp` |
| **A2A** | 多智能体协作 | `agx volcengine init --template a2a` |
| **Knowledge** | 知识库 RAG | `agx volcengine init --template knowledge` |

项目模板源码位于 `agenticx/cli/templates/volcengine/`。

---

## 集成组件

### 集成架构

```
┌────────────────────────────────────────────────────┐
│                  AgenticX 框架                       │
├─────────────┬────────────┬───────────┬─────────────┤
│ Agent Core  │  Tools     │  Memory   │  Knowledge  │
└─────────────┴────────────┴───────────┴─────────────┘
                     │
          ┌──────────┴───────────┐
          │ AgentKit Integration │
          └──────────┬───────────┘
                     │
    ┌────────────────┼────────────────┐
    ▼                ▼                ▼
┌──────────┐  ┌───────────┐  ┌────────────┐
│ Ark LLM  │  │ Runtime   │  │ Bridges &  │
│ Provider  │  │ Client    │  │ Adapters   │
└──────────┘  └───────────┘  └────────────┘
    │                │                │
    └────────────────┼────────────────┘
                     ▼
          ┌─────────────────────┐
          │ AgentKit Cloud      │
          │ Runtime / MCP /     │
          │ Memory / Knowledge  │
          └─────────────────────┘
```

### ArkLLMProvider — 火山方舟 LLM

```python
from agenticx.llms import ArkProvider

llm = ArkProvider(
    model="doubao-seed-1-6",   # 或 ep-xxxxx
    api_key="your-key"         # 也可从 MODEL_AGENT_API_KEY 环境变量自动读取
)
agent.llm = llm
```

### AgentkitMemoryBridge — 托管记忆

```python
from agenticx.integrations.agentkit import AgentkitMemoryBridge

agent.memory = AgentkitMemoryBridge()
# 自动保存对话历史到 AgentKit 托管服务
```

### AgentkitKnowledgeBridge — VikingDB 知识库

```python
from agenticx.integrations.agentkit import AgentkitKnowledgeBridge

agent.knowledge = AgentkitKnowledgeBridge()
# 连接到 VikingDB，支持文档检索与 RAG
```

### CredentialDetector — 凭证检测

```python
from agenticx.integrations.agentkit import CredentialDetector

detector = CredentialDetector()
is_cloud, creds = detector.detect()

if is_cloud:
    model_id, api_key = detector.get_model_credentials()
else:
    print(detector.get_configuration_help())
```

### AgentkitMCPGateway — MCP 工具网关

```python
from agenticx.integrations.agentkit import AgentkitMCPGateway

gateway = AgentkitMCPGateway()
await gateway.register_tool("my-tool", "Tool description", schema={...})
results = await gateway.search_tools("calculator")
```

### VeADKBridge — veadk 深度集成

```python
from agenticx.integrations.agentkit import VeADKBridge

bridge = VeADKBridge()
veadk_agent = bridge.to_veadk_agent(agent)
response = await bridge.run_with_veadk(agent, "Hello!")
```

### AgentkitRuntimeClient — 运行时管理

```python
from agenticx.integrations.agentkit import AgentkitRuntimeClient

client = AgentkitRuntimeClient()
await client.create_runtime("my-runtime")
status = await client.get_runtime_status("my-runtime")
await client.destroy_runtime("my-runtime")
```

---

## 凭证管理

### 方式 1：环境变量（推荐）

```bash
export MODEL_AGENT_API_KEY="sk-xxxxx"
export MODEL_AGENT_NAME="ep-xxxxx"
```

### 方式 2：CLI 配置

```bash
agx volcengine config --model ep-xxxxx --api-key your-key
agx volcengine config --show
```

### 安全最佳实践

```python
# ❌ 不要硬编码
llm = ArkProvider(api_key="sk-xxxx")

# ✅ 从环境变量自动读取
llm = ArkProvider()
```

---

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `ModuleNotFoundError: agenticx` | `pip install agenticx` |
| `MODEL_AGENT_API_KEY not found` | `export MODEL_AGENT_API_KEY=...` |
| 部署失败 | `agx volcengine deploy --dry-run --verbose` |
| 调用超时 | `agx volcengine status` 检查服务状态 |
| 工具不工作 | 先 `python test_local.py` 本地验证 |

调试技巧：

```bash
export LOG_LEVEL=DEBUG
python test_local.py

agx volcengine logs --follow
agx volcengine logs | grep ERROR
```

---

## CLI 命令速查

```bash
agx volcengine init --template <type> --name <name>   # 初始化
agx volcengine config --model <m> --api-key <k>       # 配置凭证
agx volcengine deploy --module agent --var agent       # 部署
agx volcengine deploy --dry-run                        # 验证配置
agx volcengine invoke "message"                        # 调用
agx volcengine status                                  # 查看状态
agx volcengine logs [--follow]                         # 查看日志
agx volcengine destroy                                 # 清理资源
```

---

## 示例项目

- `hi-agent/` — 本目录下的实战示例项目，包含完整的 agent 定义、Dockerfile、部署配置
- `../../examples/agenticx-agentkit-basic-example.py` — 完整的集成代码示例（含工具定义、同步/异步测试、部署配置生成）

## 相关资源

- [AgenticX 主文档](../../README.md)
- [火山引擎官网](https://www.volcengine.com/)
- [集成模块源码](../../agenticx/integrations/agentkit/)
- [项目模板源码](../../agenticx/cli/templates/volcengine/)
