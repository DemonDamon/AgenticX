# AgenticX Deploy 模块总结

> 结论更新时间：2026-05-29（覆盖 2026-02-08 之后的变更）

## 目录路径
`/Users/damon/myWork/AgenticX/agenticx/deploy`

## 模块概述

Deploy 模块提供 Agent 部署能力，支持 Docker、本地等多种部署方式，包含配置管理、凭证管理、环境管理等完整的部署基础设施。

## 完整目录结构

```
agenticx/deploy/
├── __init__.py          # 模块入口，导出核心 API
├── types.py             # 类型定义（枚举、数据类、异常）
├── base.py              # 部署组件抽象基类
├── config.py            # 项目配置管理
├── credentials.py       # 凭证管理
├── environment.py       # 环境管理
└── components/
    ├── __init__.py      # 组件子模块（含 volcengine 注册）
    ├── local.py         # 本地部署组件
    ├── docker.py        # Docker 部署组件
    └── volcengine/      # 火山引擎 AgentKit 部署适配器
        ├── __init__.py              # 包入口，自动注册 VolcEngineComponent
        ├── wrapper.py               # AgenticXAgentWrapper（Agent -> AgentKit 协议适配）
        ├── config_generator.py      # agentkit.yaml 配置生成
        ├── dockerfile_generator.py  # Dockerfile + requirements.txt 生成
        └── component.py             # VolcEngineComponent（编排产物生成）
```

---

## 核心组件

### types.py - 类型定义

**枚举类型**：
- `DeploymentStatus`: 部署状态（PENDING, DEPLOYING, RUNNING, STOPPED, FAILED, REMOVING）
- `ComponentType`: 组件类型（LOCAL, DOCKER, KUBERNETES, SERVERLESS）

**数据类**：
- `ResourceSpec`: 资源规格（cpu, memory, disk, gpu）
- `DeploymentConfig`: 部署配置
  - name: 部署名称
  - component: 组件类型
  - resources: 资源规格
  - env_vars: 环境变量
  - ports: 端口映射
- `DeploymentResult`: 部署结果
- `RemoveResult`: 删除结果
- `StatusResult`: 状态查询结果

**异常体系**：
- `DeployError`: 基础异常
- `DeployConfigError`: 配置异常
- `DeployExecutionError`: 执行异常
- `DeployResourceError`: 资源异常

### base.py - 抽象基类

**DeploymentComponent**：部署组件抽象基类
- `deploy(config)`: 执行部署
- `remove(config)`: 删除部署
- `status(config)`: 查询状态
- `validate(config)`: 验证配置
- `logs(config)`: 获取日志

**ComponentRegistry**：组件注册表
- 单例模式管理所有部署组件
- `register(component)`: 注册组件
- `get(name)`: 获取组件
- `list_components()`: 列出所有组件

**便捷装饰器**：
- `@register_component`: 自动注册组件

### config.py - 配置管理

**ProjectConfig**：项目配置类
- 从 `agenticx.yaml` 加载配置
- 支持多部署配置
- 环境变量覆盖
- **(NEW)** `hooks` 字段：Hooks runtime 配置（默认 `{"internal": {"enabled": True, "entries": {}}}`），`from_dict` 经 `_normalize_hooks_config()` 兼容 legacy 映射格式
- **(NEW)** 配置热重载：`watch(on_reload=None)` / `unwatch()` 基于 `agenticx.core.config_watcher.ConfigWatcher`（debounce 500ms）监听 `agenticx.yaml`、`tool-policy.yaml`、`skills/`，默认回调在配置文件变更时原地刷新各字段（version/name/deployments/hooks 等）

**便捷函数**：
- `load_config(path, search_parents=True, auto_watch=False)`: 加载配置（**(NEW)** `auto_watch=True` 时加载后自动启用热重载 watcher）
- `create_default_config()`: 创建默认配置（含默认 hooks 段）
- `init_config()`: 初始化项目配置

**配置文件格式**：
```yaml
# agenticx.yaml
version: "1.0"
project:
  name: my-agent
  
deployments:
  default:
    component: docker
    resources:
      cpu: 1.0
      memory: 2048
    env_vars:
      MODEL_NAME: gpt-4
    ports:
      - 8000:8000
```

### credentials.py - 凭证管理

**Credential**：凭证数据类
- name: 凭证名称
- value: 凭证值（加密存储）
- metadata: 元数据

**CredentialManager**：凭证管理器
- 支持加密存储
- 支持多租户隔离

**便捷函数**：
- `get_credential_manager()`: 获取管理器实例
- `get_credential(name)`: 获取凭证
- `save_credential(name, value)`: 保存凭证

### environment.py - 环境管理

**Environment**：环境配置
- name: 环境名称（dev, staging, prod）
- variables: 环境变量
- config_overrides: 配置覆盖

**EnvironmentManager**：环境管理器
- 支持多环境切换
- 配置继承与覆盖

**便捷函数**：
- `get_environment_manager()`: 获取管理器
- `get_current_environment()`: 获取当前环境
- `set_current_environment(name)`: 切换环境

### components/ - 部署组件实现

#### local.py
**LocalComponent**：本地部署组件
- 在本地进程中运行 Agent
- 适用于开发和测试

#### docker.py
**DockerComponent**：Docker 部署组件
- 构建 Docker 镜像
- 管理容器生命周期
- 支持资源限制和端口映射

#### volcengine/ - 火山引擎 AgentKit 部署适配器

将 AgenticX Agent 发布到火山引擎 AgentKit 平台的单向发布适配器。MVP 阶段仅生成本地部署产物（wrapper.py、agentkit.yaml、Dockerfile、requirements.txt），不调用火山引擎云端 API。不引入 `agentkit-sdk-python` 作为强制依赖。

**wrapper.py - AgenticXAgentWrapper**：
- 功能：将 AgentKit `/invoke` 协议转换为 AgenticX `AgentExecutor.run()` 调用
- 核心方法：
  - `handle_invoke(payload, headers) -> str`：同步处理 /invoke 请求，从 payload 提取 prompt，从 headers 提取 user_id/session_id，构造 Task 并执行
  - `handle_invoke_stream(payload, headers) -> AsyncGenerator[str, None]`：SSE 流式响应（当前版本 yield 完整结果为单条 SSE event）
  - `ping() -> str`：健康检查，返回 "pong!"
  - `generate_wrapper_file(output_path, agent_module, agent_var, streaming) -> str`：生成可独立运行的 wrapper.py 文件
- 错误处理：捕获 AgentExecutor 异常并转换为 AgentKit 标准格式 `{"error": {"message": ..., "type": ...}}`
- SSE 格式：`data: {json}\n\n`，对齐上游 `_stream_with_error_handling` / `_convert_to_sse`
- 模板：内嵌 `WRAPPER_TEMPLATE_BASIC` 和 `WRAPPER_TEMPLATE_STREAMING` 两个 string.Template

**config_generator.py - 配置生成器**：
- 功能：生成 agentkit.yaml 配置文件，对齐上游 `strategy_configs.py`
- `generate_agentkit_yaml(agent_name, strategy, region, ...)` -> dict：支持 local/hybrid/cloud 三种策略
- `save_agentkit_yaml(config, output_path) -> Path`：写入 YAML 文件
- 各策略生成不同的 `launch_types` 配置段（端口、镜像仓库、TOS 存储桶等）

**dockerfile_generator.py - Dockerfile 生成器**：
- 功能：生成 Dockerfile 和 requirements.txt，对齐上游 `Dockerfile.j2` 但使用 string.Template
- `generate_dockerfile(entry_point, python_version, base_image, ...)` -> str：支持自定义基础镜像、Python 版本、额外环境变量、构建脚本
- `save_dockerfile(content, output_path) -> Path`：写入文件
- `generate_requirements(extra_deps, agenticx_version) -> str`：生成包含 agenticx 的 requirements.txt
- 默认基础镜像：`agentkit-prod-public-cn-beijing.cr.volces.com/base/py-simple:python{version}-bookworm-slim-latest`

**component.py - VolcEngineComponent**：
- 功能：继承 `DeploymentComponent`，编排调用 wrapper/config_generator/dockerfile_generator 生成完整部署产物
- 必需 props：`agent_name`、`agent_module`、`agent_var`
- 可选 props：`strategy`（默认 hybrid）、`region`、`python_version`、`base_image`、`streaming`、`extra_envs`、`extra_deps`、`output_dir`
- `deploy(config)` -> DeploymentResult：在 output_dir 下生成 4 个文件，返回 PENDING 状态和产物路径元数据
- `remove(config)` -> RemoveResult：MVP 阶段返回未实现提示
- `status(config)` -> StatusResult：MVP 阶段返回 UNKNOWN
- `validate(config)` -> List[str]：校验必需 props 和 strategy 合法性
- 通过 `components/__init__.py` 的 try/import 模式自动注册到 ComponentRegistry

---

## 使用示例

### 基础部署
```python
from agenticx.deploy import load_config
from agenticx.deploy.components import DockerComponent

# 加载配置
config = load_config()
deployment = config.get_deployment("default")

# 执行部署
component = DockerComponent()
result = await component.deploy(deployment)
print(f"Status: {result.status}")
print(f"URL: {result.url}")
```

### 使用环境管理
```python
from agenticx.deploy import (
    get_environment_manager,
    set_current_environment,
    load_config,
)

# 切换到生产环境
set_current_environment("prod")

# 加载配置（自动应用环境覆盖）
config = load_config()
```

### 凭证管理
```python
from agenticx.deploy import save_credential, get_credential

# 保存凭证
save_credential("OPENAI_API_KEY", "sk-xxx")

# 获取凭证
api_key = get_credential("OPENAI_API_KEY")
```

### 自定义部署组件
```python
from agenticx.deploy import DeploymentComponent, register_component

@register_component
class KubernetesComponent(DeploymentComponent):
    @property
    def name(self) -> str:
        return "kubernetes"
    
    async def deploy(self, config):
        # 实现 K8s 部署逻辑
        pass
    
    async def remove(self, config):
        # 实现删除逻辑
        pass
    
    async def status(self, config):
        # 实现状态查询
        pass
```

---

### VolcEngine 部署示例

```python
from agenticx.deploy.types import DeploymentConfig
from agenticx.deploy.components.volcengine.component import VolcEngineComponent

# 配置部署
config = DeploymentConfig(
    name="my-agent-deploy",
    component="volcengine",
    props={
        "agent_name": "my-agent",
        "agent_module": "my_agent",
        "agent_var": "agent",
        "strategy": "hybrid",
        "region": "cn-beijing",
        "output_dir": "./deploy_output",
    },
)

# 生成部署产物
component = VolcEngineComponent()
result = await component.deploy(config)
# 产出: deploy_output/{wrapper.py, agentkit.yaml, Dockerfile, requirements.txt}
```

---

## 设计特点

1. **组件化架构**：通过抽象基类和注册表实现可插拔的部署组件
2. **配置驱动**：YAML 配置文件驱动部署流程
3. **环境隔离**：支持多环境配置和切换
4. **安全凭证**：加密存储敏感信息
5. **可扩展**：易于添加新的部署目标（K8s、Serverless、VolcEngine 等）
6. **零强制依赖**：volcengine 适配器不引入 agentkit-sdk-python 等外部强制依赖，生成的 wrapper.py 才需要它
7. **不侵入 core/**：volcengine 通过组合 Agent + AgentExecutor 实现协议适配，不修改任何 core 代码
