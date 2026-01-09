# AgenticX 部署系统

AgenticX 部署系统提供统一的 Agent 部署能力，支持 Docker、本地进程等多种部署方式。

## 核心特性

- **组件化架构**: 可插拔的部署组件
- **多环境支持**: dev, staging, prod 等
- **配置管理**: YAML 配置文件
- **凭证管理**: 安全的凭证存储

## 快速开始

### 初始化项目

```bash
# 在项目目录下初始化配置
agenticx init

# 或使用 Python API
from agenticx.deploy import init_config
init_config()
```

这会创建 `agenticx.yaml` 配置文件。

### 配置文件示例

```yaml
# agenticx.yaml
version: 1.0.0
name: my-agent
description: My AgenticX Agent

environments:
  dev:
    access: dev-creds
  prod:
    access: prod-creds

deployments:
  - name: docker
    component: docker
    props:
      image: my-agent:latest
      ports:
        "8080": "80"
      environment:
        DEBUG: "true"
```

### 执行部署

```python
from agenticx.deploy import load_config
from agenticx.deploy.components.docker import DockerComponent

# 加载配置
config = load_config()
deployment = config.get_deployment("docker", environment="dev")

# 部署
component = DockerComponent()
result = await component.deploy(deployment)

if result.success:
    print(f"部署成功: {result.endpoint}")
else:
    print(f"部署失败: {result.message}")
```

## 部署组件

### Docker 组件

```python
from agenticx.deploy import DeploymentConfig
from agenticx.deploy.components.docker import DockerComponent

config = DeploymentConfig(
    name="my-agent",
    component="docker",
    props={
        "image": "my-agent:latest",
        "ports": {"8080": "80"},
        "volumes": {"/data": "/app/data"},
        "environment": {"API_KEY": "xxx"},
        "restart_policy": "unless-stopped",
    },
)

component = DockerComponent()

# 部署
result = await component.deploy(config)

# 查看状态
status = await component.status(config)

# 查看日志
async for line in component.logs(config, lines=100):
    print(line)

# 停止
await component.remove(config)
```

### 本地组件

```python
from agenticx.deploy import DeploymentConfig
from agenticx.deploy.components.local import LocalComponent

config = DeploymentConfig(
    name="dev-agent",
    component="local",
    props={
        "command": "python",
        "args": ["-m", "agenticx.server", "--port", "8000"],
        "environment": {"DEBUG": "true"},
    },
)

component = LocalComponent()
result = await component.deploy(config)
```

## 环境管理

### 定义环境

```python
from agenticx.deploy import Environment, EnvironmentManager

manager = EnvironmentManager()

# 添加环境
manager.add(Environment(
    name="dev",
    access="dev-creds",
    variables={"DEBUG": "true"},
))

manager.add(Environment(
    name="prod",
    access="prod-creds",
    region="us-east-1",
))

# 切换环境
manager.set_current("prod")

# 获取当前环境
env = manager.current
print(env.name)  # 输出: prod
```

### 在配置中使用

```yaml
environments:
  dev:
    access: dev-creds
    variables:
      DEBUG: "true"
      LOG_LEVEL: "DEBUG"
  prod:
    access: prod-creds
    region: us-east-1
    variables:
      LOG_LEVEL: "INFO"
```

## 凭证管理

### 添加凭证

```python
from agenticx.deploy import Credential, save_credential

# 创建凭证
cred = Credential(
    name="docker-hub",
    type="docker",
    data={
        "username": "myuser",
        "password": "mypassword",
    },
)

# 保存凭证
save_credential(cred)
```

### 使用凭证

```python
from agenticx.deploy import get_credential

cred = get_credential("docker-hub")
if cred:
    username = cred.get("username")
    password = cred.get("password")
```

### 从环境变量获取

```python
from agenticx.deploy import CredentialManager

manager = CredentialManager()

# 优先使用存储的凭证，否则从环境变量创建
cred = manager.get_or_env(
    "docker-hub",
    env_mapping={
        "username": "DOCKER_USERNAME",
        "password": "DOCKER_PASSWORD",
    },
)
```

## 配置管理

### 加载配置

```python
from agenticx.deploy import load_config

# 自动搜索 agenticx.yaml
config = load_config()

# 指定路径
config = load_config(path="/path/to/agenticx.yaml")
```

### 解析变量

```yaml
# agenticx.yaml
variables:
  IMAGE_TAG: latest
  REGISTRY: docker.io

deployments:
  - name: docker
    component: docker
    props:
      image: ${REGISTRY}/my-agent:${IMAGE_TAG}
```

```python
config = load_config()
image = config.resolve_variables("${REGISTRY}/my-agent:${IMAGE_TAG}")
# 输出: docker.io/my-agent:latest
```

## 自定义组件

```python
from agenticx.deploy import DeploymentComponent, DeploymentConfig, DeploymentResult

class MyComponent(DeploymentComponent):
    @property
    def name(self) -> str:
        return "my-component"
    
    async def deploy(self, config: DeploymentConfig) -> DeploymentResult:
        # 实现部署逻辑
        return DeploymentResult(
            success=True,
            deployment_id=f"my-{config.name}",
            message="Deployed successfully",
        )
    
    async def remove(self, config: DeploymentConfig) -> RemoveResult:
        # 实现删除逻辑
        pass
    
    async def status(self, config: DeploymentConfig) -> StatusResult:
        # 实现状态查询逻辑
        pass
```

## 目录结构

```
~/.agenticx/
├── credentials/           # 凭证存储
│   ├── docker-hub.json
│   └── aws.json
└── sandbox/
    └── templates/         # 沙箱模板
        └── my-template.yaml
```

## 最佳实践

1. **不要提交凭证**: 将凭证存储在 `~/.agenticx/credentials/`，不要提交到版本控制
2. **使用环境变量**: 敏感信息优先使用环境变量
3. **分离配置**: 为不同环境创建不同的配置
4. **版本控制**: 将 `agenticx.yaml` 纳入版本控制

## 架构图

```
┌─────────────────────────────────────────┐
│            ProjectConfig                │
│      (agenticx.yaml 配置)                │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│         EnvironmentManager              │
│      (多环境管理)                        │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│        CredentialManager                │
│      (凭证管理)                          │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│         ComponentRegistry               │
│      (组件注册)                          │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐   ┌────▼────┐   ┌────▼────┐
│Docker │   │  Local  │   │ Custom │
│Component│ │Component│   │Component│
└─────────┘ └─────────┘   └─────────┘
```
