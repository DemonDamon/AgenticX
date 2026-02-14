# Volcengine ADK

> Documents for Volcengine Agent Development Kit

VeADK.

# Usage documentation

Volcengine Agent Development Kit

火山引擎智能体开发套件

______________________________________________________________________

火山引擎智能体框架 **VeADK（Volcengine Agent Development Kit）**，是由**火山引擎**推出的为 Agent 智能体的应用构建提供开发、部署、观测、评测等全流程云原生解决方案。相较于现有的智能体开发框架，VeADK 具备与火山引擎产品体系深度融合的优势，帮助开发者更高效地构建企业级 AI 智能体应用。

快速开始

通过以下方式安装 VeADK：

```bash
# 稳定版
pip install veadk-python

# 主分支预览版
pip install git+https://github.com/volcengine/veadk-python.git@main
```

```bash
go get github.com/volcengine/veadk-go
```

pom.xml

```xml
<dependency>
    <groupId>com.volcengine.veadk</groupId>
    <artifactId>veadk-java</artifactId>
    <version>0.0.1</version>
</dependency>
```

______________________________________________________________________

或者您可以使用 VeADK 提供的 Python 版镜像仓库：

```text
veadk-cn-beijing.cr.volces.com/veadk/veadk-python:latest
```

```text
veadk-cn-beijing.cr.volces.com/veadk/veadk-python:preview
```

```text
veadk-cn-beijing.cr.volces.com/veadk/veadk-python:0.2.20
```

[veadk-python](https://github.com/volcengine/veadk-python)

[veadk-go](https://github.com/volcengine/veadk-go)

[veadk-java](https://github.com/volcengine/veadk-java)

[快速开始](https://volcengine.github.io/veadk-python/quickstart/index.md)

______________________________________________________________________

## 使用 VeADK 构建 DeepResearch

[](https://veadk.tos-cn-beijing.volces.com/doc-assets/veadk_deepresearch.mp4)

______________________________________________________________________

- **多生态与模型兼容**

  ______________________________________________________________________

  VeADK 与 Google ADK 实现完全兼容，支持现有项目无缝迁移；与 LiteLLM 模型推理服务兼容，支持各类主流模型接入。

- **完善的记忆与知识库支持**

  ______________________________________________________________________

  提供短期记忆与长期记忆的完整解决方案：短期记忆可基于 MySQL 实现持久化存储；长期记忆则依托 Viking DB、云搜索服务构建。VeADK 以 LlamaIndex 作为知识库核心处理入口，同时支持 Viking 知识库后端无缝接入。

- **内置丰富工具和生态集成**

  ______________________________________________________________________

  内置 Web Search / 图片生成 / 视频生成等多款火山引擎生态工具，满足基础业务场景需求。支持代码沙箱等进阶工具实现复杂业务场景下的定制化功能。

- **可观测性与评估能力**

  ______________________________________________________________________

  集成 CozeLoop、APMPlus、TLS 等多款工具组件，全面覆盖调用链路观测、日志存储检索及在线评测等核心需求。具备 Tracing 追踪能力，可精准记录智能体（Agent）执行过程中的关键路径与中间状态。构建智能体运行、评测、调优的一站式闭环支撑体系，为智能体的能力迭代与智能化升级提供坚实保障。

- **云原生架构与快速部署**

  ______________________________________________________________________

  采用云原生架构设计，提供代码打包、镜像构建等多元化部署形式。通过整合火山引擎 VeFaaS、API 网关等核心服务，实现全开发流程的简化与高效流转。依托云部署项目模板，支持基于 CloudEngine 的一键式部署与发布，大幅提升上线效率。

- **企业级安全防护**

  ______________________________________________________________________

  依托火山引擎 AgentKit Identity 构建一站式身份鉴权体系，并结合权限管理平台提供全流程服务支撑。在身份管理层面，支持用户池管理、企业 IdP（SAML/OIDC）集成及第三方身份联合认证；在工作负载身份管理层面，可为智能体/工具分配唯一数字身份，并维护属性标签实现精准标识。提供第三方凭据托管功能，通过加密方式托管 API Key 与 OAuth 令牌，从根源杜绝明文凭据泄露风险。在权限管控方面，采用基于属性与上下文的动态授权机制，实现细粒度权限控制，保障服务访问安全。

## VeADK Famliy

VeADK 各组件与火山引擎相关产品的结合矩阵：

| **组件**       | **火山引擎产品**                                                                                             | **说明**                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **大模型**     | [**火山方舟**](https://www.volcengine.com/product/ark)                                                       | 大模型平台，提供各类语言模型、多模态模型的推理服务                        |
| **提示词工程** | [**PromptPilot**](https://promptpilot.volcengine.com/)                                                       | 提供提示词管理、优化能力                                                  |
| **工具**       | [**MCP 广场**](https://www.volcengine.com/mcp-marketplace)                                                   | 提供各类 MCP Server，丰富工具一键直连                                     |
|                | [**Web search**](https://www.volcengine.com/docs/85508/1650263)（融合信息搜索API）                           | 融合信息搜索，提供公域数据搜索功能                                        |
|                | [**VeSearch**](https://www.volcengine.com/docs/85508/1512748)（联网问答Agent）                               | 提供信息搜索与云端自动整合功能                                            |
|                | [**Web Scraper**](https://www.volcengine.com/docs/84296/1545470)                                             | 定制化内容查询（邀测）                                                    |
|                | [**飞书 Lark**](https://open.larkoffice.com/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction) | 进行飞书相关操作                                                          |
|                | [**AI 数据湖服务 LAS**](https://www.volcengine.com/product/las)                                              | 提供开放、低成本、高性能的AI数据湖，海量数据存储与查询能力                |
| **短期记忆**   | [**MySQL**](https://www.volcengine.com/docs/6313)                                                            | 提供使用 MySQL 数据库存储短期记忆，提供高性能读写能力，可实现持久化       |
|                | [**PostgreSQL**](https://www.volcengine.com/product/rds-pg)                                                  | 提供使用 PostgreSQL 数据库存储短期记忆，提供高性能读写能力，可实现持久化  |
|                | [**火山引擎云数据库 MySQL 版**](https://www.volcengine.com/product/rds-mysql)                                | 记忆存储                                                                  |
| **长期记忆**   | [**云搜索服务**](https://www.volcengine.com/product/es) (OpenSearch)                                         | 兼容 OpenSearch，支持向量搜索等能力                                       |
|                | [**Redis**](https://www.volcengine.com/product/redis)                                                        | Redis 作为长期记忆存储，支持 Redisearch 功能                              |
|                | [**Viking 记忆库**](https://www.volcengine.com/docs/84313/1860687?lang=zh)                                   | 知识向量化存储和检索                                                      |
| **知识库**     | [**Viking 知识库**](https://www.volcengine.com/docs/84313/2117716?lang=zh)                                   | 知识向量化存储和检索                                                      |
|                | [**MySQL**](https://www.volcengine.com/docs/6313)                                                            | 提供使用 MySQL 数据库存储短期记忆，提供高性能读写能力，不具备向量搜索功能 |
|                | [**Redis**](https://www.volcengine.com/product/redis)                                                        | Redis 作为长期记忆存储，支持 Redisearch                                   |
|                | [**云搜索服务**](https://www.volcengine.com/product/es) (OpenSearch)                                         | 知识向量化存储和检索                                                      |
| **可观测**     | [**应用性能监控全链路版**](https://www.volcengine.com/product/apmplus) (APMPlus)                             | 调用链路观测                                                              |
|                | [**扣子罗盘**](https://www.coze.cn/loop)(CozeLoop)                                                           | 调用链路观测                                                              |
|                | [**日志服务**](https://www.volcengine.com/product/tls) (TLS)                                                 | 调用链路观测、日志存储与检索                                              |
| **评测**       | [**扣子罗盘**](https://www.coze.cn/loop) (CozeLoop)                                                          | 在线评测                                                                  |
| **云部署**     | [**火山引擎函数服务**](https://www.volcengine.com/product/vefaas) (VeFaaS)                                   | 提供一键上云能力                                                          |
|                | [**火山引擎 API 网关**](https://www.volcengine.com/product/apig)                                             | 提供鉴权、路由等能力                                                      |
|                | [**火山引擎持续交付**](https://www.volcengine.com/product/cp)                                                | 提供用户仓库向 VeFaaS 进行基于镜像的持续交付部署                          |
|                | [**火山引擎镜像仓库**](https://www.volcengine.com/product/cr)                                                | 提供用户代码镜像托管维护                                                  |

## 安装

我们推荐您使用 `uv` 包管理工具来安装 VeADK，您可以遵循以下步骤：

```bash
# 使用 `uv` 来创建一个基于 Python 3.10 版本的虚拟环境
uv venv --python 3.10

# 激活 `uv` 环境
source .venv/bin/activate
```

环境激活后，您可以看到您的命令行开头会有括号标注的虚拟环境名称（通常为您的所在目录名称）：

您可以使用已经激活的虚拟环境来安装 VeADK：

```bash
uv pip install veadk-python
```

您可以直接使用 `pip` 命令从 PyPI 中安装最新版的 VeADK：

```bash
pip install veadk-python
```

您可以通过运行如下命令来检测您的 VeADK 是否安装成功：

```bash
veadk --version
```

了解如何安装 Python

请查看[Python 安装指南](https://www.python.org/downloads/)了解如何安装 Python。

了解如何从源码构建 VeADK

1. 下载源码至本地 将VeADK的代码包从Github下载到本地

   ```bash
   git clone https://github.com/volcengine/veadk-python.git
   cd veadk-python
   ```

1. 配置`uv`环境 本项目使用`uv`进行构建，（了解如何[安装`uv`](https://docs.astral.sh/uv/getting-started/installation/)）

   ```text
   # 选择 3.10及以上版本
   uv venv --python 3.10
   ```

   激活`uv`虚拟环境

```bash
source .venv/bin/activate
```

```bash
source .venv/bin/activate
```

```text
.venv\Scripts\activate.bat
```

```powershell
.venv\Scripts\activate.ps1
```

安装 VeADK

```bash
uv pip install .
# 或以本地可编辑模式安装
# uv pip install -e .
```

了解如何为 VeADK 贡献代码

请查看[贡献指南](https://volcengine.github.io/veadk-python/references/contributing/index.md)了解如何为 VeADK 项目贡献代码。

## 生成并运行

您可以执行如下命令，来生成一个我们为您预制好的 Agent 项目模板：

```bash
veadk create
```

您将被提示输入如下信息：

- 项目名称（这也将会成为您的本地目录名称）
- 方舟平台 API Key（您也可以稍后手动填写到配置文件中）

输入完毕后，您本地的项目结构如下：

your_project/

```text
your_project
├── __init__.py # 模块导出文件
├── .env        # 环境变量文件，您需要在此处提供您的模型 API Key
└── agent.py    # Agent 定义文件
```

您需要在 `.env` 中填入您的模型 API Key：

[获取方舟 API Key](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D)

.env

```text
MODEL_AGENT_API_KEY = ...
```

我们为您生成的 Agent 项目中，`agent.py` 提供了一个可以查询模拟天气数据的智能体，结构如下：

agent.py

```python
from veadk import Agent # 导入 Agent 模块

root_agent = Agent(
    name="root_agent",  # Agent 名称 
    description="A helpful assistant for user questions.",  # Agent 描述
    instruction="Answer user questions to the best of your knowledge",  # Agent 系统提示词
    model_name="doubao-seed-1-6-251015",    # 模型名称
)
```

之后，您可以通过如下命令来启动一个浏览器页面，与您的 Agent 进行交互：

常用配置

- 改变服务地址：`veadk web --host 0.0.0.0`

- 改变服务端口：`veadk web --port 8000`

- 改变日志输出级别：`veadk web --log_level DEBUG` (1)

  1. VeADK 重载默认等级为 `ERROR`

```bash
veadk web
```

交互界面如图：

# 执行引擎

`Runner` 是 ADK Runtime 中的一个核心组件，负责协调你定义的 Agents、Tools、Callbacks 等外部组件，使它们共同响应用户输入，同时管理信息流、状态变化，以及与外部服务（例如 LLM、Tools）或存储的交互。

VeADK 的执行引擎完全兼容 Google ADK Runner，关于 `Runner` 的完整工作机制与生命周期说明可参考 [Google ADK Agent 运行时](https://google.github.io/adk-docs/runtime/)。

______________________________________________________________________

## 多租设计

在程序中，若需满足企业级多租户设计需求，可通过 `app_name`、`user_id` 以及 `session_id` 三个核心维度实现数据隔离，各维度对应的隔离范围如下：

| 数据     | 隔离维度                          |
| -------- | --------------------------------- |
| 短期记忆 | `app_name` `user_id` `session_id` |
| 长期记忆 | `app_name` `user_id`              |
| 知识库   | `app_name`                        |

## 最简运行

VeADK 中为您提供了一个简单的运行接口 `Runner.run`，用于直接运行一个 Agent 实例，处理用户输入并返回响应。

使用限制

本运行接口封装度较高，如您需要在生产级别进行更加灵活的控制，建议使用 `Runner.run_async` 接口，通过异步生成器处理 Agent 每个执行步骤所产生的 Event 事件。

下面是一个最简运行示例：

```python
import asyncio

from veadk import Agent, Runner

agent = Agent()

runner = Runner(agent=agent)

response = asyncio.run(runner.run(messages="北京的天气怎么样？"))

print(response)
```

## 生产级运行

我们以图片理解为例，演示如何使用 `runner.run_async` 来进行 Event 事件处理：

```python
from google.genai.types import Blob, Content, Part

from veadk import Agent, Runner

APP_NAME = "app"
USER_ID = "user"
SESSION_ID = "session"

agent = Agent()
runner = Runner(agent=agent, app_name=APP_NAME)

user_message = Content(
  role="user",
  parts=[
    Part(
      text="请详细描述这张图片的所有内容，包括物体、颜色、布局和文字信息（如有）。"
    ),
    Part(
      inline_data=Blob(
        display_name=os.path.basename(image_path),
        data=read_png_to_bytes(image_path),
        mime_type="image/png",
      )
    ),
  ],
)

async for event in runner.run_async(
  user_id=runner.user_id,
  session_id=session_id,
  new_message=user_message,
  run_config=RunConfig(max_llm_calls=1),
):
  # 在这里处理您的 Event 事件
```

# 内置工具使用指南

本文档旨在说明如何有效利用 VeADK 内置工具（BuiltinTools）。这些工具提供了即用型功能（如网页搜索或代码执行器），赋予 Agent 通用能力。例如，需要从网络检索信息的 Agent 可直接使用 **web_search** 工具，无需额外配置。

## 使用方法

1. **导入**：从 `veadk.tools.builtin_tools` 模块导入所需工具。
1. **配置**：初始化工具并按需提供参数。
1. **注册**：将工具实例添加至 Agent 的 `tools` 列表。

```python
from veadk import Agent
from veadk.tools.builtin_tools.web_search import web_search

# 在 Agent 初始化时注册工具
agent = Agent(tools=[web_search])
```

```golang
import (
    "log"

    veagent "github.com/volcengine/veadk-go/agent/llmagent"
    "github.com/volcengine/veadk-go/tool/builtin_tools/web_search"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/tool"
)

func main() {
    webSearch, err := web_search.NewWebSearchTool(&web_search.Config{})
    if err != nil {
        log.Fatalf("NewWebSearchTool failed: %v", err)
        return
    }
    cfg := veagent.Config{
        Config: llmagent.Config{
            Tools: []tool.Tool{webSearch},
        },
    }
    veAgent, err := veagent.New(&cfg)
    if err != nil {
        log.Fatalf("NewLLMAgent failed: %v", err)
        return
    }
}
```

工具注册后，Agent 会根据 **用户提示** 和 **指令** 自主决定是否调用。框架将在调用时自动执行工具。

> **重要提示**：请务必查阅本文档末尾的“限制条件”部分。

## 工具列表

VeADK 集成了以下火山引擎工具：

| 工具名称         | 功能说明                                                                                                                                    | 导入路径                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `web_search`     | 通过[融合信息搜索 API](https://www.volcengine.com/docs/85508/1650263) 进行全网搜索。                                                        | `from veadk.tools.builtin_tools.web_search import web_search`             |
| `web_scraper`    | 聚合搜索（邀测），代码详见[此处](https://github.com/volcengine/mcp-server/tree/main/server)。                                               | `from veadk.tools.builtin_tools.web_scraper import web_scraper`           |
| `vesearch`       | 调用[联网问答 Agent](https://www.volcengine.com/docs/85508/1512748) 进行搜索，支持头条搜索等。                                              | `from veadk.tools.builtin_tools.vesearch import vesearch`                 |
| `image_generate` | 根据文本描述[生成图片](https://www.volcengine.com/docs/82379/1541523)。                                                                     | `from veadk.tools.builtin_tools.image_generate import image_generate`     |
| `image_edit`     | [编辑图片](https://www.volcengine.com/docs/82379/1541523)（图生图）。                                                                       | `from veadk.tools.builtin_tools.image_edit import image_edit`             |
| `video_generate` | 根据文本描述[生成视频](https://volcengine.github.io/veadk-python/tools/builtin/https.www.volcengine.com/docs/82379/1520757)。               | `from veadk.tools.builtin_tools.video_generate import video_generate`     |
| `run_code`       | 在 [AgentKit 沙箱](https://console.volcengine.com/agentkit-ppe/region:agentkit-ppe+cn-beijing/builtintools)中执行代码。                     | `from veadk.tools.builtin_tools.run_code import run_code`                 |
| `lark`           | 集成[飞书开放能力](https://open.larkoffice.com/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_installation)，实现文档处理、会话管理等。 | `from veadk.tools.builtin_tools.lark import lark`                         |
| `las`            | 基于[火山引擎 AI 多模态数据湖服务 LAS](https://www.volcengine.com/mcp-marketplace) 进行数据管理。                                           | `from veadk.tools.builtin_tools.las import las`                           |
| `mobile_run`     | 手机指令执行                                                                                                                                | `from veadk.tools.builtin_tools.mobile_run import create_mobile_use_tool` |
| `vod`            | 视频剪辑助手                                                                                                                                | `from veadk.tools.builtin_tools.vod import vod_tools`                     |

### 公域搜索 (Web Search)

`web_search` 工具允许 Agent 通过融合信息搜索的 API 进行搜索。详情请参考[融合信息搜索 API 文档](https://www.volcengine.com/docs/85508/1650263)。

使用 `web_search` 工具的附加要求

1. 需要配置火山引擎 AK、SK 或者使用火山引 IAM 授权的临时 StsToken
1. 需要配置用于 Agent 推理模型的API Key

```python
from veadk import Agent, Runner
from veadk.tools.builtin_tools.web_search import web_search
from veadk.memory.short_term_memory import ShortTermMemory


app_name = "veadk_app"
user_id = "veadk_user"
session_id = "veadk_session"

agent = Agent(
    name="WebSearchAgent",
    model_name="doubao-seed-1-6-250615",
    description="An agent that can get result from Web Search",
    instruction="You are a helpful assistant that can provide information use web search tool.",
    tools=[web_search],
)
short_term_memory = ShortTermMemory()

runner = Runner(
    agent=agent, short_term_memory=short_term_memory, app_name=app_name, user_id=user_id
)


async def main():
    response = await runner.run(
        messages="杭州今天的天气怎么样？", session_id=session_id
    )
    print(response)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
```

```golang
package main

import (
    "context"
    "log"
    "os"

    veagent "github.com/volcengine/veadk-go/agent/llmagent"
    "github.com/volcengine/veadk-go/common"
    "github.com/volcengine/veadk-go/tool/builtin_tools/web_search"
    "github.com/volcengine/veadk-go/utils"
    "google.golang.org/adk/agent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/session"
    "google.golang.org/adk/tool"
)

func main() {
    ctx := context.Background()
    sessionService := session.InMemoryService()

    cfg := &veagent.Config{
        ModelName:    common.DEFAULT_MODEL_AGENT_NAME,
        ModelAPIBase: common.DEFAULT_MODEL_AGENT_API_BASE,
        ModelAPIKey:  utils.GetEnvWithDefault(common.MODEL_AGENT_API_KEY),
    }
    cfg.Name = "WebSearchAgent"
    cfg.Description = "An agent that can get result from Web Search"
    cfg.Instruction = "You are a helpful assistant that can provide information use web search tool."

    webSearch, err := web_search.NewWebSearchTool(&web_search.Config{})
    if err != nil {
        log.Fatalf("NewWebSearchTool failed: %v", err)
        return
    }

    cfg.Tools = []tool.Tool{webSearch}

    rootAgent, err := veagent.New(cfg)
    if err != nil {
        log.Fatalf("Failed to create agent: %v", err)
    }

    config := &launcher.Config{
        AgentLoader:    agent.NewSingleLoader(rootAgent),
        SessionService: sessionService,
    }

    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("Run failed: %v\n\n%s", err, l.CommandLineSyntax())
    }
}
```

环境变量列表：

- `MODEL_AGENT_API_KEY`： 用于 Agent 推理模型 API Key
- `VOLCENGINE_ACCESS_KEY`：用于调用WebSearch的火山引擎的AccessKey
- `VOLCENGINE_SECRET_KEY`：用于调用WebSearch的火山引擎的SecretKey

或在 `config.yaml` 中定义：

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-250615
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
volcengine:
    # [optional] for Viking DB and `web_search` tool
  access_key: you-access-key-here
  secret_key: you-secret-key-here
```

运行结果：

### 火山引擎搜索(VeSearch)

`vesearch` 工具允许Agent通过调用火山引擎的联网问答Agent来进行搜索，详情请参考[联网问答 Agent](https://www.volcengine.com/docs/85508/1512748)。

使用 `vesearch` 工具的附加要求

1. 需要配置火山引擎 AK、SK 或者使用火山引 IAM 授权的临时 StsToken
1. 需要配置用于 Agent 推理模型的API Key
1. 需要配置联网问答 Agent 的智能体ID，在控制台创建智能体后获取，[控制台地址](https://console.volcengine.com/ask-echo/my-agent)。配置项名称为：`TOOL_VESEARCH_ENDPOINT`。

```python
from veadk import Agent, Runner
from veadk.tools.builtin_tools.vesearch import vesearch
from veadk.memory.short_term_memory import ShortTermMemory


app_name = "veadk_app"
user_id = "veadk_user"
session_id = "veadk_session"
API_KEY = "vesearch_api_key"

agent = Agent(
    name="ve_search_agent",
    model_name="doubao-seed-1-6-250615",
    api_key=API_KEY,
    description="An agent that can get result from veSearch",
    instruction="You are a helpful assistant that can provide information use vesearch tool.",
    tools=[vesearch],
)
short_term_memory = ShortTermMemory()

runner = Runner(
    agent=agent, short_term_memory=short_term_memory, app_name=app_name, user_id=user_id
)


async def main():
    response = await runner.run(
        messages="杭州今天的天气怎么样？", session_id=session_id
    )
    print(response)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
```

环境变量列表：

- `MODEL_AGENT_API_KEY`： 用于 Agent 推理模型 API Key
- `VOLCENGINE_ACCESS_KEY`：用于调用WebSearch的火山引擎的AccessKey
- `VOLCENGINE_SECRET_KEY`：用于调用WebSearch的火山引擎的SecretKey
- `TOOL_VESEARCH_ENDPOINT`： 用于 联网问答 Agent 的智能体ID。注：**必须配置在环境变量里面**

或在 `config.yaml` 中定义：

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-250615
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
volcengine:
    # [optional] for Viking DB and `web_search` tool
  access_key: you-access-key-here
  secret_key: you-secret-key-here
```

运行结果：

### 代码执行(Run Code)

`run_code` 工具使代理能够执行代码。允许模型执行计算、数据处理或运行小程序等任务。

使用 `run_code` 工具的附加要求

1. 需要配置火山引擎 AK、SK 或者使用火山引 IAM 授权的临时 StsToken
1. 需要配置用于 Agent 推理模型的 API Key
1. 需要配置 AgentKit Tools Id，详见：***AgentKit 沙箱工具（Tools）*** 章节部分

```python
from veadk import Agent, Runner
from veadk.tools.builtin_tools.web_search import web_search
from veadk.memory.short_term_memory import ShortTermMemory
from veadk.tools.builtin_tools.run_code import run_code

app_name = "veadk_app"
user_id = "veadk_user"
session_id = "veadk_session"

agent: Agent = Agent(
    name="data_analysis_agent",
    description="A data analysis for stock marketing",
    instruction="""
        你是一个资深软件工程师，在沙箱里执行生产的代码， 避免每次安装检查, 
        可以使用python lib akshare 下载相关的股票数据。可以通过web_search工具搜索相关公司的经营数据。如果缺失了依赖库, 
        通过python代码为沙箱安装缺失的依赖库。""",
    tools=[run_code, web_search],
)


short_term_memory = ShortTermMemory()

runner = Runner(
    agent=agent, short_term_memory=short_term_memory, app_name=app_name, user_id=user_id
)


async def main():
    response = await runner.run(messages="阳光电源？", session_id=session_id)
    print(response)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
```

以下是必须在环境变量里面的配置项：

- `AGENTKIT_TOOL_ID`：用于调用火山引擎AgentKit Tools的沙箱环境Id
- `AGENTKIT_TOOL_HOST`：用于调用火山引擎AgentKit Tools的EndPoint
- `AGENTKIT_TOOL_SERVICE_CODE`：用于调用AgentKit Tools的ServiceCode
- `AGENTKIT_TOOL_SCHEME`：用于切换调用 AgentKit Tools 的协议，允许 `http`/`https`，默认 `https`

环境变量列表：

- `MODEL_AGENT_API_KEY`： 用于 Agent 推理模型 API Key
- `VOLCENGINE_ACCESS_KEY`：用于调用WebSearch的火山引擎的AccessKey
- `VOLCENGINE_SECRET_KEY`：用于调用WebSearch的火山引擎的SecretKey

或在 `config.yaml` 中定义：

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-250615
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
volcengine:
    # [optional] for Viking DB and `web_search` tool
  access_key: you-access-key-here
  secret_key: you-secret-key-here
```

运行结果：

### 图像生成工具(Image Generate)

`image_generate` 该工具可以根据用户的描述生成图像

使用 `image_generate` 工具的附加要求

1. 需要配置用于 Agent 推理模型的 API Key
1. 需要配置用于 Agent 推理图像生成的模型名称

```python
from veadk import Agent, Runner
from veadk.memory.short_term_memory import ShortTermMemory
from veadk.tools.builtin_tools.generate_image import image_generate

app_name = "veadk_app"
user_id = "veadk_user"
session_id = "veadk_session"

agent = Agent(
    name="image_generate_agent",
    description=("根据需求生成图片."),
    instruction=(
        """
        你是一个图片生成专家，根据用户的需求生成图片。
        你可以使用的工具有：
            - image_generate
        你只能依靠自己和绘图工具来完成任务。
        """
    ),
    tools=[
        image_generate,
    ],
)

short_term_memory = ShortTermMemory()

runner = Runner(
    agent=agent, short_term_memory=short_term_memory, app_name=app_name, user_id=user_id
)


async def main():
    response = await runner.run(messages="生成一个可爱的小猫", session_id=session_id)
    print(response)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
```

```go
package main

import (
    "context"
    "fmt"
    "log"
    "os"

    "github.com/a2aproject/a2a-go/a2asrv"
    "github.com/google/uuid"
    veagent "github.com/volcengine/veadk-go/agent/llmagent"
    "github.com/volcengine/veadk-go/common"
    "github.com/volcengine/veadk-go/tool/builtin_tools"
    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/artifact"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model"
    "google.golang.org/adk/session"
    "google.golang.org/adk/tool"
)

func main() {
    ctx := context.Background()
    cfg := &veagent.Config{
        ModelName:    common.DEFAULT_MODEL_AGENT_NAME,
        ModelAPIBase: common.DEFAULT_MODEL_AGENT_API_BASE,
        ModelAPIKey:  os.Getenv(common.MODEL_AGENT_API_KEY),
    }
    cfg.Name = "image_generate_tool_agent"
    cfg.Description = "Agent to generate images based on text descriptions or images."
    cfg.Instruction = "I can generate images based on text descriptions or images."
    cfg.AfterModelCallbacks = []llmagent.AfterModelCallback{saveReportfunc}

    imageGenerate, err := builtin_tools.NewImageGenerateTool(&builtin_tools.ImageGenerateConfig{
        ModelName: common.DEFAULT_MODEL_IMAGE_NAME,
        BaseURL:   common.DEFAULT_MODEL_IMAGE_API_BASE,
        APIKey:    os.Getenv(common.MODEL_IMAGE_API_KEY),
    })
    if err != nil {
        fmt.Printf("NewLLMAgent failed: %v", err)
        return
    }

    cfg.Tools = []tool.Tool{imageGenerate}

    sessionService := session.InMemoryService()
    rootAgent, err := veagent.New(cfg)

    if err != nil {
        log.Fatalf("Failed to create agent: %v", err)
    }

    agentLoader, err := agent.NewMultiLoader(
        rootAgent,
    )
    if err != nil {
        log.Fatalf("Failed to create agent loader: %v", err)
    }

    artifactservice := artifact.InMemoryService()
    config := &launcher.Config{
        ArtifactService: artifactservice,
        SessionService:  sessionService,
        AgentLoader:     agentLoader,
    }

    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("Run failed: %v\n\n%s", err, l.CommandLineSyntax())
    }
}
```

环境变量列表：

- `MODEL_IMAGE_NAME`： 用于 Agent 推理图像生成的模型名称
- `MODEL_AGENT_API_KEY`： 用于 Agent 推理模型 API Key

或在 `config.yaml` 中定义：

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-250615
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
  image:
    name: doubao-seedream-4-0-250828
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
```

运行结果：

### 视频生成工具(Video Generate)

`video_generate` 该工具可以根据用户的描述生成图像

!!! warning "使用 `video_generate` 工具的附加要求":

1. 需要配置用于 Agent 推理模型的 API Key
1. 需要配置用于 Agent 推理视频生成的模型名称
1. 需要配置用于 Agent 推理图片生成的模型名称（该用例使用了 image_generate 工具，因此需要推理图像生成模型的配置）

```python
from veadk import Agent, Runner
from veadk.tools.builtin_tools.video_generate import video_generate
from veadk.tools.builtin_tools.image_generate import image_generate
from veadk.memory.short_term_memory import ShortTermMemory

app_name = "veadk_app"
user_id = "veadk_user"
session_id = "veadk_session"

agent = Agent(
    name="quick_video_create_agent",
    description=("You are an expert in creating images and video"),
    instruction="""You can create images and using the images to generate video, 
                 first you using the image_generate tool to create an image as the first_frame and next create the last_frame, 
                 then you using the generated first_frame and last_frame to invoke video_generate tool to create a video.
                 After the video is created, you need to return the full absolute path of the video avoid the user cannot find the video
                 and give a quick summary of the content of the video.
                """,
    tools=[image_generate, video_generate],
)


short_term_memory = ShortTermMemory()

runner = Runner(
    agent=agent, short_term_memory=short_term_memory, app_name=app_name, user_id=user_id
)


async def main():
    response = await runner.run(
        messages="首先生成一只小狗图片，然后生成一个小狗飞上天抓老鼠的图片，最终合成一个视频",
        session_id=session_id,
    )
    print(response)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
```

```go
package main

import (
    "context"
    "fmt"
    "log"
    "os"

    "github.com/a2aproject/a2a-go/a2asrv"
    "github.com/google/uuid"
    veagent "github.com/volcengine/veadk-go/agent/llmagent"
    "github.com/volcengine/veadk-go/common"
    "github.com/volcengine/veadk-go/tool/builtin_tools"
    "google.golang.org/adk/agent"
    "google.golang.org/adk/artifact"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model"
    "google.golang.org/adk/session"
    "google.golang.org/adk/tool"
)

func main() {
    ctx := context.Background()
    cfg := &veagent.Config{
        ModelName:    common.DEFAULT_MODEL_AGENT_NAME,
        ModelAPIBase: common.DEFAULT_MODEL_AGENT_API_BASE,
        ModelAPIKey:  os.Getenv(common.MODEL_AGENT_API_KEY),
    }
    videoGenerate, err := builtin_tools.NewVideoGenerateTool(&builtin_tools.VideoGenerateConfig{
        ModelName: common.DEFAULT_MODEL_VIDEO_NAME,
        BaseURL:   common.DEFAULT_MODEL_VIDEO_API_BASE,
        APIKey:    os.Getenv(common.MODEL_VIDEO_API_KEY),
    })
    if err != nil {
        fmt.Printf("NewLLMAgent failed: %v", err)
        return
    }

    cfg.Tools = []tool.Tool{videoGenerate}

    sessionService := session.InMemoryService()
    rootAgent, err := veagent.New(cfg)

    if err != nil {
        log.Fatalf("Failed to create agent: %v", err)
    }

    agentLoader, err := agent.NewMultiLoader(
        rootAgent,
    )
    if err != nil {
        log.Fatalf("Failed to create agent loader: %v", err)
    }

    artifactservice := artifact.InMemoryService()
    config := &launcher.Config{
        ArtifactService: artifactservice,
        SessionService:  sessionService,
        AgentLoader:     agentLoader,
    }

    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("Run failed: %v\n\n%s", err, l.CommandLineSyntax())
    }
}
```

环境变量列表：

- `MODEL_VIDEO_NAME`： 用于 Agent 推理视频生成的模型名称
- `MODEL_IMAGE_NAME`： 用于 Agent 推理图像生成的模型名称
- `MODEL_AGENT_API_KEY`： 用于 Agent 推理模型 API Key

或在 `config.yaml` 中定义：

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-250615
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
  image:
    name: doubao-seedream-4-0-250828
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
  image:
    name: doubao-seedance-1-0-pro-250528
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
```

运行结果：

### 飞书 MCP工具 (Lark MCP Tools)

`lark` 该MCP工具集可以帮助你快速实现 AI agent 与飞书开放能力的集成，实现基于 agent 的飞书云文档处理、会话管理、日历安排等自动化场景。

使用 `lark` 工具的附加要求（2、3、4获取方式详见：[**Lark创建应用**](https://open.larkoffice.com/document/develop-an-echo-bot/introduction) ）

1. 需要配置用于 Agent 推理模型的 API Key
1. 需要配置用于 Lark 服务的 Application ID
1. 需要配置用于 Lark 服务的 API Key
1. 需要配置用于 Lark 服务的 OAuthToken

```python
from veadk import Agent, Runner
from veadk.memory.short_term_memory import ShortTermMemory
from veadk.tools.builtin_tools.lark import lark_tools

app_name = "veadk_app"
user_id = "veadk_user"
session_id = "veadk_session"

agent = Agent(
    name="lark_agent",
    description=("飞书机器人"),
    instruction=(
        """
            你是一个飞书机器人，通过lark_tools给用户发消息。
        """
    ),
    tools=[
        lark_tools,
    ],
)

short_term_memory = ShortTermMemory()

runner = Runner(
    agent=agent, short_term_memory=short_term_memory, app_name=app_name, user_id=user_id
)


async def main():
    response = await runner.run(
        messages="给xiangya@bytedance.com发送'你好，我是lark agent'",
        session_id=session_id,
    )
    print(response)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
```

必须配置在环境变量的配置项：

- `TOOL_LARK_ENDPOINT`： 用于 Lark 服务的 Endpoint
- `TOOL_LARK_API_KEY`： 用于 Lark 服务的 API Key
- `TOOL_LARK_TOKEN`： 用于 Lark 服务的 OAuthToken

环境变量列表：

- `MODEL_AGENT_API_KEY`： 用于 Agent 推理模型 API Key

或在 `config.yaml` 中定义：

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-250615
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
```

运行结果：

### LAS MCP工具 (LAS MCP Tools)

`LAS` 该MCP工具集基于AI多模态数据湖服务LAS，提供多模态数据集的创建、预览、查询分析、编辑和清洗加工能力。

使用 `las` 工具的附加要求

1. 需要配置用于 Agent 推理模型的 API Key
1. 需要预先[创建LAS通用数据集](https://console.volcengine.com/las/region:las+cn-beijing/next/dataset/common/create)，并获得数据集的LAS DatasetId
1. 需要配置用于 Las 服务的 DatasetId
1. 需要配置用于 Las 服务的 URL，[URL获取方式](https://www.volcengine.com/mcp-marketplace/detail?name=LAS%20MCP)

```python
from veadk import Agent, Runner
from veadk.memory.short_term_memory import ShortTermMemory
from veadk.tools.builtin_tools.las import las

app_name = "veadk_app"
user_id = "veadk_user"
session_id = "veadk_session"

agent = Agent(
    name="las_agent",
    description=("use data from las"),
    instruction=(
        """
        你是一个诗人，根据用户的需求生成诗词。
        你可以使用的MCP工具集有：
            - las
        第一步你需要使用las工具去ds_public数据集检索相关内容，然后基于检索内容作为基础来写一首诗词。
        """
    ),
    tools=[
        las,
    ],
)

short_term_memory = ShortTermMemory()

runner = Runner(
    agent=agent, short_term_memory=short_term_memory, app_name=app_name, user_id=user_id
)


async def main():
    response = await runner.run(
        messages="写一首国风和木头、爱情相关的诗词", session_id=session_id
    )
    print(response)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
```

必须配置在环境变量的配置项：

- `TOOL_LAS_URL`： 用于提供 LAS MCP Server 服务的地址
- `TOOL_LAS_DATASET_ID`： 配置使用LAS服务的数据集ID

环境变量列表：

- `MODEL_AGENT_API_KEY`： 用于 Agent 推理模型 API Key

或在 `config.yaml` 中定义：

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-250615
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
```

运行结果：

### 手机指令执行 (Mobile Run)

`mobile_run` 该工具可以让Agent在云手机上完成手机任务。

使用 `mobile_run` 工具的附加要求

1. 需要在火山购买云手机服务，并订购pod
1. 根据自己的需要在云手机上配置环境，必须下载app，登录账号等。

```python

```

必须配置在环境变量的配置项：

- `TOOL_MOBIL_USE_TOOL_ID`： 用于执行命令的云手机id

或在 `config.yaml` 中定义：

config.yaml

```yaml
  tool:
    mobile_use:
      tool_id:
        - product_id-pod_id
        - product_id-pod_id

  volcengine:
    access_key: xxx
    secret_key: xxx
```

获取方式：

1. 登录火山，进入云手机产品控制界面

1. tool_id 格式为：product_id-pod_id

运行结果：

### 视频云MCP工具（Vod MCP Tool）

`vod_tools`允许Agent通过调用火山引擎的视频云MCP来进行视频剪辑处理，详情请参考[VOD MCP Server](https://github.com/volcengine/mcp-server/blob/main/server/mcp_server_vod/README_zh.md)

使用 `vod_tools` 的附加要求

1. 需要配置火山引擎 AK、SK
1. （可选）可以配置`TOOL_VOD_GROUPS`选择多样化的视频剪辑能力。可选范围为：
   - `edit`:视频剪辑相关tools
   - `intelligent_slicing`: 智能切片相关tools
   - `intelligent_matting`: 智能抠图相关tools
   - `subtitle_processing`: 字幕处理相关tools
   - `audio_processing`: 音频处理相关tools
   - `video_enhancement`: 视频增强相关tools
   - `upload`: 上传相关
   - `video_play`: 视频播放相关
1. （可选）工具连接超时时长`TOOL_VOD_TIMEOUT`，默认为10秒
1. 注：如果需要多个工具组，请使用逗号进行连接，如果不进行配置，则默认为`edit,video_play`
1. 注：视频云工具不支持Space的创建，请在火山视频云控制台提前创建[视频云空间](https://console.volcengine.com/vod/region:vod+cn-north-1/overview/)

```python
import asyncio
from veadk import Agent, Runner
from veadk.tools.builtin_tools.vod import vod_tools
agent = Agent(tools=[vod_tools])
runner = Runner(agent)
result = asyncio.run(
    runner.run(
        messages="将这两个视频合并:<your-url1>, <your-url2>, space_name为<your-space-name",
    )
)
print(result)
```

必须配置在环境变量的配置项：

- `VOLCENGINE_ACCESS_KEY`： 火山引擎的AccessKey
- `VOLCENGINE_SECRET_KEY`： 火山引擎的SecretKey

可选环境变量

- TOOL_VOD_GROUPS: 配置能力组
- TOOL_VOD_TIMEOUT: 工具连接超时时长, 默认为10.0秒

或在 `config.yaml` 中定义：

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-250615
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: your-api-key-here
volcengine:
  access_key: you-access-key-here
  secret_key: you-secret-key-here
tool:
  vod: 
    groups: xxxxx
    timeout: 10.0
```

输出结果：

```text
已成功将两个视频合并，合并后的视频信息如下：
- **播放地址**：<url>
- **视频时长**：x秒 
- **分辨率**：xxxxx
- **文件名称**：xxxxx.mp4  
（注：播放地址有效期为60分钟，若过期可重新生成）
```

注：有些视频编辑任务可能时间开销较大，该类任务会直接返回一个task_id，可以继续询问agent，让其查询task是否完成，从而获得任务后续。

## 系统工具

- `load_knowledgebase`：检索知识库工具，在你给 Agent 传入 `knowledgebase` 参数后，将会自动挂载该工具，Agent 将在运行时自主决定何时查询知识库；
- `load_memory`：检索长期记忆工具，在你给 Agent 传入 `long_term_memory` 参数后，将会自动挂载该工具，Agent 将在运行时自主决定何时查询长期记忆。

## 其它

### AgentKit 沙箱工具（Tools）

AgentKit 沙箱工具提供了多种智能体在执行任务中需要的运行环境工具，支持快速集成与便捷调用，同时VeADK提供了更多内置工具。 一体化工具集包含 Browser、Terminal、Code 运行环境，支持自动根据任务切换。

**创建沙箱** 按以下步骤操作：

1. **创建沙箱工具**：自定义沙箱名称"AIO_Sandbox_xxxx"，工具集类型选择"一体化工具集"，描述"Python代码沙箱"
1. **获取结果**：创建完成后在控制台获取‘AIO_Sandbox_xxxx’对应的沙箱ID：t-ye8dj82xxxxx

本文档介绍如何在智能体系统中创建与使用**自定义工具（Custom Tools）**，以扩展内置能力。\
自定义工具可以满足特定业务逻辑需求，包括普通函数调用、带上下文的函数、以及长时间运行的任务等。\
通过组合自定义工具，VeADK 能够支持开发者构建更复杂、更贴合业务场景的智能体应用。

______________________________________________________________________

## 普通入参函数

普通入参函数是最基础的自定义工具形式，通过传入参数完成特定计算或逻辑处理。为实现一个普通入参函数，需要完成以下步骤：

1. 定义工具函数，使用简单、易懂的扁平化设计，来规范输入参数及返回类型；
1. 实现函数中的 Docstring，描述函数功能、参数及返回值；
1. 将工具注册到 Agent 的工具列表中。

下面我们将实现一个计算器来说明如何自定义一个普通入参函数，并将这个函数注册到 Agent 中。

```python
import asyncio
from typing import Any, Dict

from google.adk.tools.tool_context import ToolContext
from veadk import Agent, Runner


def calculator(
    a: float, b: float, operation: str, tool_context: ToolContext
) -> Dict[str, Any]:
    """A simple calculator tool that performs basic arithmetic operations.

    Args:
        a (float): The first operand.
        b (float): The second operand.
        operation (str): The arithmetic operation to perform.
            Supported operations are "add", "subtract", "multiply", and "divide".

    Returns:
        Dict[str, Any]: A dictionary containing the result of the operation, the operation performed,
        and the status of the operation ("success" or "error").
    """
    if operation == "add":
        return {"result": a + b, "operation": "+", "status": "success"}
    if operation == "subtract":
        return {"result": a - b, "operation": "-", "status": "success"}
    if operation == "multiply":
        return {"result": a * b, "operation": "*", "status": "success"}
    if operation == "divide":
        return {
            "result": a / b if b != 0 else "Error, divisor cannot be zero",
            "operation": "/",
            "status": "success" if b != 0 else "error",
        }
    return {"status": "error", "message": "Unsupported operation"}


agent = Agent(
    name="computing_agent",
    instruction="Please use the `calculator` tool to perform user-required calculations",
    tools=[calculator],
)
runner = Runner(agent=agent)

response = asyncio.run(runner.run(messages="Add 2 and 3"))
print(response)
```

运行后，可以看到如下结果：

Agent 会根据用户输入调用注册的工具函数，执行相应的计算或逻辑处理。

## 携带运行时上下文信息的函数

在您的工具定义函数中，通过携带有 `ToolContext` 类型的入参，能够访问智能体运行时上下文信息（如会话 ID、用户身份、环境变量等），从而实现更智能的决策。相比于定义普通入参函数，您需要额外传入 `ToolContext` 类型的入参，来获取智能体运行时上下文信息：

1. 定义函数时接受 `tool_context: ToolContext` 作为参数；
1. 在函数逻辑中处理传入的 `tool_context`。

下面通过一个简单的消息验证工具应用来演示如何使用携带有上下文信息 `ToolContext` 的函数。

```python
import asyncio

from google.adk.tools.tool_context import ToolContext
from veadk import Agent, Runner


def message_checker(
    user_message: str,
    tool_context: ToolContext,
) -> str:
    """A user message checker tool that checks if the user message is valid.

    Args:
        user_message (str): The user message to check.

    Returns:
        str: The checked message.
    """

    print(f"user_message: {user_message}")
    print(f"current running agent name: {tool_context._invocation_context.agent.name}")
    print(f"app_name: {tool_context._invocation_context.app_name}")
    print(f"user_id: {tool_context._invocation_context.user_id}")
    print(f"session_id: {tool_context._invocation_context.session.id}")

    return f"Checked message: {user_message.upper()}"


agent = Agent(
    name="context_agent",
    tools=[message_checker],
    instruction="Use message_checker tool to check user message, and show the checked message",
)
runner = Runner(agent=agent)

response = asyncio.run(runner.run(messages="Hello world!"))
print(response)
```

运行结果如下图所示：

图中可以看到，工具函数中可以访问到智能体运行时上下文信息，例如会话 ID、用户身份、当前所执行的 Agent 信息等。

## 长时运行任务（Long-running Task）

长时运行任务工具适用于需要耗时处理或异步执行的操作，例如大规模计算、数据分析或批量处理任务。下面，我们将通过构建一个简单的数据处理工具来演示长时运行任务的实现。

**引入必要依赖**

```python
import asyncio
from typing import Any

from google.adk.events import Event
from google.adk.tools.long_running_tool import LongRunningFunctionTool
from google.genai.types import Content, FunctionCall, FunctionResponse, Part
from veadk import Agent, Runner
```

**定义长时任务工具**

```python
def big_data_processing(data_url: str) -> dict[str, Any]:
    """Process the big data from a specific data url.

    Args:
        data_url (str): The url of the big data to process.

    Returns:
        dict[str, Any]: A dictionary containing the result of the big data processing, the data url processed,
        and the status of the processing ("pending" or "finish").
    """
    # create a new task for processing big data.
    return {
        "status": "pending",
        "data-url": data_url,
        "task-id": "big-data-processing-1",
    }


long_running_tool = LongRunningFunctionTool(func=big_data_processing)
```

**初始化 Agent 及运行时元数据**

```python
APP_NAME = "long_running_tool_app"
USER_ID = "long_running_tool_user"
SESSION_ID = "long_running_tool_session"

agent = Agent(
    name="long_running_tool_agent",
    tools=[long_running_tool],
    instruction="Use long_running_tool to process big data",
)
runner = Runner(agent=agent, app_name=APP_NAME)

# 初始化 Session
session = asyncio.run(
    runner.short_term_memory.create_session(
        app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID
    )
)
```

**定义运行函数并执行**

```python
async def call_agent_async(query):
    def get_long_running_function_call(event: Event) -> FunctionCall | None:
        # Get the long running function call from the event
        if (
            not event.long_running_tool_ids
            or not event.content
            or not event.content.parts
        ):
            return
        for part in event.content.parts:
            if (
                part
                and part.function_call
                and event.long_running_tool_ids
                and part.function_call.id in event.long_running_tool_ids
            ):
                return part.function_call

    def get_function_response(
        event: Event, function_call_id: str
    ) -> FunctionResponse | None:
        # Get the function response for the fuction call with specified id.
        if not event.content or not event.content.parts:
            return
        for part in event.content.parts:
            if (
                part
                and part.function_response
                and part.function_response.id == function_call_id
            ):
                return part.function_response

    content = Content(role="user", parts=[Part(text=query)])

    print("Running agent...")
    events_async = runner.run_async(
        session_id=session.id, user_id=USER_ID, new_message=content
    )

    long_running_function_call, long_running_function_response, task_id = (
        None,
        None,
        None,
    )
    async for event in events_async:
        # Use helper to check for the specific auth request event
        if not long_running_function_call:
            long_running_function_call = get_long_running_function_call(event)
        else:
            _potential_response = get_function_response(
                event, long_running_function_call.id
            )
            if _potential_response:  # Only update if we get a non-None response
                long_running_function_response = _potential_response
                task_id = long_running_function_response.response["task-id"]
        if event.content and event.content.parts:
            if text := "".join(part.text or "" for part in event.content.parts):
                print(f"[{event.author}]: {text}")

    if long_running_function_response:
        # query the status of the correpsonding ticket via tciket_id
        # send back an intermediate / final response
        updated_response = long_running_function_response.model_copy(deep=True)
        updated_response.response = {"status": "finish"}
        async for event in runner.run_async(
            session_id=session.id,
            user_id=USER_ID,
            new_message=Content(
                parts=[Part(function_response=updated_response)], role="user"
            ),
        ):
            if event.content and event.content.parts:
                if text := "".join(part.text or "" for part in event.content.parts):
                    print(f"[{event.author}]: {text}")


asyncio.run(call_agent_async("Process the big data from https://example.com/data.csv"))
```

执行结果如下图所示：

# KnowledgeBase 介绍

## 主要功能

KnowledgeBase 在 veadk 框架中扮演 Agent 的外部知识库 角色。它像一个可供 Agent 随时查阅的、专门存储静态资料的“图书馆”。其核心功能包括：

1. 知识注入 (Ingestion) ：您可以将外部的、非结构化的文本资料（如产品文档、FAQ、文章、知识片段等）添加进知识库。框架会自动处理这些文本，将其转换为 Agent 可以理解和检索的格式。

   - 支持从 文件 导入 (kb.add_from_files([...]))。
   - 支持从 内存中的文本字符串 导入 (kb.add_from_text([...]))。

1. 后端抽象 (Backend Abstraction) ： KnowledgeBase 提供了一个统一的接口，屏蔽了底层向量数据库的实现细节。您只需要在初始化时通过 backend 参数指定使用 viking 还是 opensearch ，而无需关心它们各自的 API 调用方式。

1. 知识检索 (Retrieval) ：当 KnowledgeBase 实例被传递给 Agent 后，Agent 会自动获得一个内置的 knowledgebase_search 工具。在回答问题时，Agent 可以自主决定是否使用此工具，将用户的问题转化为关键词去知识库中搜索相关信息，从而给出更精准、更具上下文的回答。

1. 与 Agent 无缝集成 ：通过在创建 Agent 时传入 knowledgebase=kb 参数，Agent 就能自动利用这个知识库来增强其回答能力。

## 使用方法

以下是使用 KnowledgeBase 的典型步骤，并对比了 viking 和 opensearch 的配置差异。

第 1 步：配置 config.yaml 文件

这是两者最主要的区别所在。您需要在项目根目录的 config.yaml 文件中提供对应后端的连接信息

```yaml
# config.yaml
volcengine:
  access_key: "YOUR_VOLCENGINE_AK" # embedding 仍然需要火山引擎的 ak/sk
  secret_key: "YOUR_VOLCENGINE_SK"

database:
  opensearch:
    host: "your_opensearch_host"
    port: 9200
    username: "your_username"
    password: "your_password"
```

第 2 步：在 Python 脚本中初始化 KnowledgeBase

在代码中，您只需指定 backend 名称即可。

第 3 步：添加知识

添加知识的方法对于两种后端是完全一样的。

第 4 步：集成到 Agent

```python
from veadk import Agent, Runner

agent = Agent(
    name="my_knowledgeable_agent",
    model_name="doubao-seed-1-6-250615",
    instruction="你是一个知识渊博的助手，请利用知识库回答问题。",
    knowledgebase=kb, # 在这里传入
    # ... 其他参数
)

runner = Runner(agent, app_name="your_app_name")

# 之后就可以正常运行 runner
# ...
```

# 入门示例 (Getting Started)

## 资源开通

### vikingDB开通

1. 登录控制台进入vikingDB操作页面

1. 进入控制台后，我们会看到下面的页面。知识库要选中中间红框选择的那个进入。

1. 进入知识库列表页后，按照下图红框提示进入创建页面：

1. 点击创建按钮后弹出创建选项如下(一定要选旗舰版本)

1. 进入创建详情页，按照提示输入关键信息。具体的核心部分见下图红框部分：

1. 点击创建知识库按钮，点完后会有一个弹出问是否导入文档，选择暂不导入。

### TOS配置

1. 登陆火山控制台进入TOS控制台
1. 创建TOS桶

[火山引擎tos文档](https://www.volcengine.com/docs/6349?lang=zh)

### openSearch 开通

1. 登录火山控制台进入云搜索控制台
1. 进入云搜索控制台后创建opensearch实例
1. 输入实例创建信息

[火山引擎云搜索服务文档：创建实例](https://www.volcengine.com/docs/6465/1117829?lang=zh)

## 代码配置

### config.yaml

把上面资源开通部分，对应的内容vikingDB、TOS和OpenSearch对应的内容填入。注意agent的api_base

api_key可以直接使用例子中的。access_key和secret_key必须使用开通资源账号的。

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-251015
    api_base: https://ark.cn-beijing.volces.com/api/v3/
    api_key: **************************

volcengine:
  # [optional] for Viking DB and `web_search` tool
  #替换为自己的ak/sk
  access_key: ***********************************
  secret_key: ***********************************

database:
  viking:
    project: default    # user project in Volcengine Viking DB
    region: cn-beijing
  tos:
    endpoint: tos-cn-beijing.volces.com # default Volcengine TOS endpoint
    region: cn-beijing                  # default Volcengine TOS region
    bucket: bucket_name
  opensearch:
    host:  opensearch.********.com
    port:   9200
    username: admin
    password: *************
```

## 演示场景

### 知识库的内容

把下面的一段话作为知识库的内容：

```python
西格蒙德·弗洛伊德（Sigmund Freud，1856年5月6日-1939年9月23日）是精神分析的创始人。
    精神分析既是一种治疗精神疾病的方法，也是一种解释人类行为的理论。弗洛伊德认为，我们童年时期的经历对我们的成年生活有很大的影响，并且塑造了我们的个性。
    例如，源自人们曾经的创伤经历的焦虑感，会隐藏在意识深处，并且可能在成年期间引起精神问题（以神经症的形式）。""",
    """阿尔弗雷德·阿德勒（Alfred Adler，1870年2月7日-1937年5月28日），奥地利精神病学家，人本主义心理学先驱，个体心理学的创始人。
    曾追随弗洛伊德探讨神经症问题，但也是精神分析学派内部第一个反对弗洛伊德的心理学体系的心理学家。
    著有《自卑与超越》《人性的研究》《个体心理学的理论与实践》《自卑与生活》等。
```

### Agent是角色设定

```python
 instruction="""你是一个优秀的助手。当被提问时，请遵循以下步骤：
1. 首先，根据你的内部知识，生成一个初步的回答。
2. 然后，查询你的知识库，寻找与问题相关的信息来验证或丰富你的答案。
3. 最后，结合你的内部知识和知识库中的信息，给出一个全面、准确的最终答案。""",
```

### 测试问题：

1. 弗洛伊德和阿德勒差了多少岁，多少天？
1. 弗洛伊德和阿德勒差了多少岁，多少天？ 他们对后世的影响有多大

### vikingDB作为知识库存储

#### 知识库初始化(从变量加载)：

```python
APP_NAME = "viking_demo"

mock_data = [
    """西格蒙德·弗洛伊德（Sigmund Freud，1856年5月6日-1939年9月23日）是精神分析的创始人。
    精神分析既是一种治疗精神疾病的方法，也是一种解释人类行为的理论。弗洛伊德认为，我们童年时期的经历对我们的成年生活有很大的影响，并且塑造了我们的个性。
    例如，源自人们曾经的创伤经历的焦虑感，会隐藏在意识深处，并且可能在成年期间引起精神问题（以神经症的形式）。""",
    """阿尔弗雷德·阿德勒（Alfred Adler，1870年2月7日-1937年5月28日），奥地利精神病学家，人本主义心理学先驱，个体心理学的创始人。
    曾追随弗洛伊D探讨神经症问题，但也是精神分析学派内部第一个反对弗洛伊德的心理学体系的心理学家。
    著有《自卑与超越》《人性的研究》《个体心理学的理论与实践》《自卑与生活》等。""",
]
kb = KnowledgeBase(
    backend="viking",  # 这里设置为viking
    app_name=APP_NAME,
)
res = kb.collection_status()

if not res["existed"]:
    kb.create_collection()  # viking需要专门create一下

kb.add_from_text(mock_data)
```

```golang
knowledgeBase, err := knowledgebase.NewKnowledgeBase(
    ktypes.VikingBackend,
    knowledgebase.WithBackendConfig(
        &viking_knowledge_backend.Config{
            Index:            "veadk_go_test_kg",
            CreateIfNotExist: true, // 当 Index 不存在时会自动创建
            TosConfig: &ve_tos.Config{
                Bucket: "veadk-go-bucket",
            },
        }),
)
if err != nil {
    log.Fatal("NewVikingKnowledgeBackend error: ", err)
}

mock_data := []string{
    `西格蒙德·弗洛伊德（Sigmund Freud，1856年5月6日-1939年9月23日）是精神分析的创始人。
精神分析既是一种治疗精神疾病的方法，也是一种解释人类行为的理论。弗洛伊德认为，我们童年时期的经历对我们的成年生活有很大的影响，并且塑造了我们的个性。
例如，源自人们曾经的创伤经历的焦虑感，会隐藏在意识深处，并且可能在成年期间引起精神问题（以神经症的形式）。`,
    `阿尔弗雷德·阿德勒（Alfred Adler，1870年2月7日-1937年5月28日），奥地利精神病学家，人本主义心理学先驱，个体心理学的创始人。
曾追随弗洛伊德探讨神经症问题，但也是精神分析学派内部第一个反对弗洛伊德的心理学体系的心理学家。
著有《自卑与超越》《人性的研究》《个体心理学的理论与实践》《自卑与生活》等。`}

if err = knowledgeBase.Backend.AddFromText(mock_data); err != nil {
    log.Fatal("AddFromText error: ", err)
    return
}
```

#### Agent代码初始化：

```python
agent = Agent(
   name="chat_agent",
   model_name="doubao-seed-1-6-250615",
   description="你是一个优秀的助手，你可以和用户进行对话。",
   instruction="""你是一个优秀的助手。当被提问时，请遵循以下步骤：
1. 首先，根据你的内部知识，生成一个初步的回答。
2. 然后，查询你的知识库，寻找与问题相关的信息来验证或丰富你的答案。
3. 最后，结合你的内部知识和知识库中的信息，给出一个全面、准确的最终答案。""",
   knowledgebase=kb,
   tools=[calculate_date_difference],
)
```

```golang
cfg := veagent.Config{
    Config: llmagent.Config{
        Name:        "chat_agent",
        Description: "你是一个优秀的助手，你可以和用户进行对话。",
        Instruction: `你是一个优秀的助手。当被提问时，请遵循以下步骤：\n1. 首先，根据你的内部知识，生成一个初步的回答。\n2. 然后，查询你的知识库，寻找与问题相关的信息来验证或丰富你的答案。\n3. 最后，结合你的内部知识和知识库中的信息，给出一个全面、准确的最终答案。`,
        Tools:       []tool.Tool{calculateDateDifferenceTool},
    },
    ModelName:     "doubao-seed-1-6-250615",
    KnowledgeBase: knowledgeBase,
}

veAgent, err := veagent.New(&cfg)
if err != nil {
    fmt.Printf("NewLLMAgent failed: %v", err)
    return
}
```

#### 

#### 完整代码：

```python
  import os
  from uuid import uuid4
  import yaml

  os.environ["LITELLM_LOGGING"] = "False"
  os.environ["LOGGING_LEVEL"] = "DEBUG"  

  import asyncio
  from datetime import datetime

  from veadk import Agent, Runner
  from veadk.knowledgebase import KnowledgeBase

  # 从config.yaml读取配置
  with open('config.yaml', 'r') as f:
      config = yaml.safe_load(f)

  # 打印配置结构用于调试
  print("Config structure:", config)

  # 设置环境变量（使用get方法避免KeyError）
  if config.get('database') and config['database'].get('viking'):
      os.environ["DATABASE_VIKING_PROJECT"] = config['database']['viking'].get('project', 'default')
      os.environ["DATABASE_VIKING_REGION"] = config['database']['viking'].get('region', 'cn-beijing')
  else:
      print("Warning: Viking database config not found, using defaults")
      os.environ["DATABASE_VIKING_PROJECT"] = 'default'
      os.environ["DATABASE_VIKING_REGION"] = 'cn-beijing'

  if config.get('database') and config['database'].get('tos'):
      os.environ["DATABASE_TOS_BUCKET"] = config['database']['tos'].get('bucket', 'test-wangyue')
  else:
      print("Warning: TOS config not found, using default")
      os.environ["DATABASE_TOS_BUCKET"] = 'test-wangyue'

  if config.get('volcengine'):
      os.environ["VOLCENGINE_ACCESS_KEY"] = config['volcengine'].get('access_key', '')
      os.environ["VOLCENGINE_SECRET_KEY"] = config['volcengine'].get('secret_key', '')
  else:
      print("Warning: Volcengine config not found")
      os.environ["VOLCENGINE_ACCESS_KEY"] = ''
      os.environ["VOLCENGINE_SECRET_KEY"] = ''

  # 验证环境变量
  assert os.getenv("DATABASE_VIKING_PROJECT") and os.getenv("DATABASE_VIKING_REGION"), (
      "请设置config.yaml里的viking参数"
  )
  assert os.getenv("VOLCENGINE_ACCESS_KEY") and os.getenv("VOLCENGINE_SECRET_KEY"), (
      "请在config.yaml里设置火山ak和sk"
  )
  assert os.getenv("DATABASE_TOS_BUCKET"), "请在config.yaml里设置tos相关的参数"

  APP_NAME = "viking_demo"

  mock_data = [
      """西格蒙德·弗洛伊德（Sigmund Freud，1856年5月6日-1939年9月23日）是精神分析的创始人。
      精神分析既是一种治疗精神疾病的方法，也是一种解释人类行为的理论。弗洛伊德认为，我们童年时期的经历对我们的成年生活有很大的影响，并且塑造了我们的个性。
      例如，源自人们曾经的创伤经历的焦虑感，会隐藏在意识深处，并且可能在成年期间引起精神问题（以神经症的形式）。""",
      """阿尔弗雷德·阿德勒（Alfred Adler，1870年2月7日-1937年5月28日），奥地利精神病学家，人本主义心理学先驱，个体心理学的创始人。
      曾追随弗洛伊德探讨神经症问题，但也是精神分析学派内部第一个反对弗洛伊德的心理学体系的心理学家。
      著有《自卑与超越》《人性的研究》《个体心理学的理论与实践》《自卑与生活》等。""",
  ]
  kb = KnowledgeBase(
      backend="viking",  # 这里设置为viking
      app_name=APP_NAME,
  )
  res = kb.collection_status()

  if not res["existed"]:
      kb.create_collection()  # viking需要专门create一下

  kb.add_from_text(mock_data)
  #kb.add_from_files(["tmp/demo.txt"])

  def calculate_date_difference(date1: str, date2: str) -> int:
      """
      计算两个日期之间的天数差异
      参数:
          date1: 第一个日期，格式为"YYYY-MM-DD"
          date2: 第二个日期，格式为"YYYY-MM-DD"
      返回:
          两个日期之间的天数差异（绝对值）
      """
      # 解析日期字符串为datetime对象
      try:
          d1 = datetime.strptime(date1, "%Y-%m-%d")
          d2 = datetime.strptime(date2, "%Y-%m-%d")
      except ValueError as e:
          raise ValueError(f"日期格式错误，请使用YYYY-MM-DD格式: {e}")
      # 计算日期差并返回绝对值
      delta = d2 - d1
      return abs(delta.days)

  agent = Agent(
      name="chat_agent",
      model_name="doubao-seed-1-6-250615",
      description="你是一个优秀的助手，你可以和用户进行对话。",
      instruction="你是一个优秀的助手，你可以和用户进行对话。",
      knowledgebase=kb,
      tools=[calculate_date_difference],
  )

  runner = Runner(
      agent,
      app_name=APP_NAME,
  )

  async def main():
      """
      主函数，用于运行agent
      """
      session_id = uuid4().hex
      while True:
          try:
              print("

  您: ", end="")
              message = input()
              if message.strip().lower() == "exit":
                  break
              print("

  Agent: ")
              completion = await runner.run(
                  messages=message,
                  session_id=session_id,
              )
              print(completion)

          except (KeyboardInterrupt, EOFError):
              break

  if __name__ == "__main__":
      asyncio.run(main())
```

```golang
package main

import (
    "context"
    "fmt"
    "log"
    "math"
    "os"
    "strings"
    "time"

    veagent "github.com/volcengine/veadk-go/agent/llmagent"
    "github.com/volcengine/veadk-go/integrations/ve_tos"
    "github.com/volcengine/veadk-go/knowledgebase"
    "github.com/volcengine/veadk-go/knowledgebase/backend/viking_knowledge_backend"
    "github.com/volcengine/veadk-go/knowledgebase/ktypes"
    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/session"
    "google.golang.org/adk/tool"
    "google.golang.org/adk/tool/functiontool"
)

func main() {
    ctx := context.Background()
    knowledgeBase, err := knowledgebase.NewKnowledgeBase(
        ktypes.VikingBackend,
        knowledgebase.WithBackendConfig(
            &viking_knowledge_backend.Config{
                Index:            "veadk_go_test_kg",
                CreateIfNotExist: true,
                TosConfig: &ve_tos.Config{
                    Bucket: "veadk-go-bucket",
                },
            }),
    )
    if err != nil {
        log.Fatal("NewVikingKnowledgeBackend error: ", err)
    }

    mock_data := []string{
        `西格蒙德·弗洛伊德（Sigmund Freud，1856年5月6日-1939年9月23日）是精神分析的创始人。
    精神分析既是一种治疗精神疾病的方法，也是一种解释人类行为的理论。弗洛伊德认为，我们童年时期的经历对我们的成年生活有很大的影响，并且塑造了我们的个性。
    例如，源自人们曾经的创伤经历的焦虑感，会隐藏在意识深处，并且可能在成年期间引起精神问题（以神经症的形式）。`,
        `阿尔弗雷德·阿德勒（Alfred Adler，1870年2月7日-1937年5月28日），奥地利精神病学家，人本主义心理学先驱，个体心理学的创始人。
    曾追随弗洛伊德探讨神经症问题，但也是精神分析学派内部第一个反对弗洛伊德的心理学体系的心理学家。
    著有《自卑与超越》《人性的研究》《个体心理学的理论与实践》《自卑与生活》等。`}

    if err = knowledgeBase.Backend.AddFromText(mock_data); err != nil {
        log.Fatal("AddFromText error: ", err)
        return
    }

    calculateDateDifferenceTool, err := CalculateDateDifferenceTool()
    if err != nil {
        log.Fatal("CalculateDateDifferenceTool error: ", err)
        return
    }

    cfg := veagent.Config{
        Config: llmagent.Config{
            Name:        "chat_agent",
            Description: "你是一个优秀的助手，你可以和用户进行对话。",
            Instruction: `你是一个优秀的助手。当被提问时，请遵循以下步骤：\n1. 首先，根据你的内部知识，生成一个初步的回答。\n2. 然后，查询你的知识库，寻找与问题相关的信息来验证或丰富你的答案。\n3. 最后，结合你的内部知识和知识库中的信息，给出一个全面、准确的最终答案。`,
            Tools:       []tool.Tool{calculateDateDifferenceTool},
        },
        ModelName:     "doubao-seed-1-6-250615",
        KnowledgeBase: knowledgeBase,
    }

    veAgent, err := veagent.New(&cfg)
    if err != nil {
        fmt.Printf("NewLLMAgent failed: %v", err)
        return
    }

    config := &launcher.Config{
        AgentLoader:    agent.NewSingleLoader(veAgent),
        SessionService: session.InMemoryService(),
    }

    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("Run failed: %v\n\n%s", err, l.CommandLineSyntax())
    }
}

type CalculateDateDifferenceArgs struct {
    Date1 string `json:"date1" jsonschema:"第一个日期，格式为YYYY-MM-DD"`
    Date2 string `json:"date2" jsonschema:"第二个日期，格式为YYYY-MM-DD"`
}

func CalculateDateDifferenceTool() (tool.Tool, error) {
    handler := func(ctx tool.Context, args CalculateDateDifferenceArgs) (map[string]any, error) {
        diff, err := CalculateDateDifference(args.Date1, args.Date2)
        if err != nil {
            return nil, err
        }
        return map[string]any{"result": diff}, nil
    }
    return functiontool.New(
        functiontool.Config{
            Name:        "calculate date difference",
            Description: "计算两个日期之间的天数差异\nArgs:\n\tdate1: 第一个日期，格式为YYYY-MM-DD\n\tdate2: 第二个日期，格式为YYYY-MM-DD\nReturns:\n\t两个日期之间的天数差异（绝对值）",
        },
        handler,
    )
}

func CalculateDateDifference(date1 string, date2 string) (int, error) {
    d1, err := time.Parse("2006-01-02", strings.TrimSpace(date1))
    if err != nil {
        return 0, fmt.Errorf("日期格式错误，请使用YYYY-MM-DD格式: %v", err)
    }
    d2, err := time.Parse("2006-01-02", strings.TrimSpace(date2))
    if err != nil {
        return 0, fmt.Errorf("日期格式错误，请使用YYYY-MM-DD格式: %v", err)
    }
    delta := d2.Sub(d1)
    days := int(math.Abs(delta.Hours() / 24))
    return days, nil
}
```

#### 运行结果：

##### 输入问题：

##### 执行过程：

下图红框里面显示了通过搜索知识库获取相关信息，然后大模型调用calculate_date_difference funcion call。

下图显示Agent先调用knowledge 获取相关知识，然后再通过Function Call调用function calculate_date_difference.

##### 执行结果：

### OpenSearch 作为知识库存储

##### 知识库初始化(从文件加载变量加载)

在项目目录下新建tmp目录，在tmp目录新建demo.txt。它的内容如下：

````plain text
西格蒙德·弗洛伊德（Sigmund Freud，1856年5月6日-1939年9月23日）是精神分析的创始人。
精神分析既是一种治疗精神疾病的方法，也是一种解释人类行为的理论。弗洛伊德认为，我们童年时期的经历对我们的成年生活有很大的影响，并且塑造了我们的个性。
例如，源自人们曾经的创伤经历的焦虑感，会隐藏在意识深处，并且可能在成年期间引起精神问题（以神经症的形式）。

阿尔弗雷德·阿德勒（Alfred Adler，1870年2月7日-1937年5月28日），奥地利精神病学家，人本主义心理学先驱，个体心理学的创始人。
曾追随弗洛伊德探讨神经症问题，但也是精神分析学派内部第一个反对弗洛伊德的心理学体系的心理学家。
著有《自卑与超越》《人性研究》《个体心理学的理论与实践》《自卑与生活》等。

```text
知识库初始化代码：

```python
APP_NAME = "opensearch_demo"

kb = KnowledgeBase(
    backend="opensearch",  # 这里设置为opensearch
    app_name=APP_NAME,
)

# The file path has been corrected to tmp/demo.txt
kb.add_from_files(["tmp/demo.txt"])
````

##### Agent代码初始化：

```python
agent = Agent(
    name="chat_agent",
    model_name="doubao-seed-1-6-250615",
    description="你是一个优秀的助手，你可以和用户进行对话。",
    instruction="""你是一个优秀的助手。当被提问时，请遵循以下步骤：
1. 首先，根据你的内部知识，生成一个初步的回答。
2. 然后，查询你的知识库，寻找与问题相关的信息来验证或丰富你的答案。
3. 如果知识库信息不足，或用户问题涉及实时、或知识库外的知识，请使用 `web_search` 工具进行网络搜索。
4. 最后，结合你的内部知识、知识库信息以及网络搜索结果，给出一个全面、准确的最终答案。""",
    knowledgebase=kb,
    tools=[calculate_date_difference, web_search],
)
```

##### 完整的代码：

```python
import os
from uuid import uuid4
import yaml
import json
from datetime import datetime
import asyncio

os.environ["LITELLM_LOGGING"] = "False"
os.environ["LOGGING_LEVEL"] = "DEBUG"  

from veadk import Agent, Runner
from veadk.knowledgebase import KnowledgeBase

# 从config.yaml读取配置
with open('config.yaml', 'r') as f:
    config = yaml.safe_load(f)

# 打印配置结构用于调试
print("Config structure:", config)

if config.get('database') and config['database'].get('opensearch'):
    os.environ["DATABASE_OPENSEARCH_HOST"] = config['database']['opensearch'].get('host', '')
    os.environ["DATABASE_OPENSEARCH_PORT"] = str(config['database']['opensearch'].get('port', ''))
    os.environ["DATABASE_OPENSEARCH_USERNAME"] = config['database']['opensearch'].get('username', '')
    os.environ["DATABASE_OPENSEARCH_PASSWORD"] = config['database']['opensearch'].get('password', '')
else:
    print("Warning: Opensearch config not found")

if config.get('volcengine'):
    os.environ["VOLCENGINE_ACCESS_KEY"] = config['volcengine'].get('access_key', '')
    os.environ["VOLCENGINE_SECRET_KEY"] = config['volcengine'].get('secret_key', '')
else:
    print("Warning: Volcengine config not found")
    os.environ["VOLCENGINE_ACCESS_KEY"] = ''
    os.environ["VOLCENGINE_SECRET_KEY"] = ''

# 验证环境变量
assert os.getenv("VOLCENGINE_ACCESS_KEY") and os.getenv("VOLCENGINE_SECRET_KEY"), (
    "请在config.yaml里设置火山ak和sk"
)

APP_NAME = "opensearch_demo"

kb = KnowledgeBase(
    backend="opensearch",  # 这里设置为opensearch
    app_name=APP_NAME,
)

# The file path has been corrected to tmp/demo.txt
kb.add_from_files(["tmp/demo.txt"])

def web_search(query: str) -> str:
    """
    当知识库信息不足时，使用此工具在互联网上搜索实时或外部信息。查询可以是单个字符串，也可以是JSON格式的字符串列表。
    """
    # This is a placeholder for the actual web search tool call
    # In a real scenario, this would be implemented by the environment.
    print(f"Performing web search for: {query}")

    # The model might send a list of queries directly, or a JSON string of a list.
    if isinstance(query, list):
        return f"Web search results for queries: {', '.join(query)}"

    # If it's a string, it could be a JSON list.
    if isinstance(query, str):
        try:
            queries = json.loads(query)
            if isinstance(queries, list):
                return f"Web search results for queries: {', '.join(queries)}"
        except (json.JSONDecodeError, TypeError):
            # It's just a plain string.
            pass
        # Fallthrough for plain string
        return "Web search results for '" + query + "'"

    # Fallback for any other unexpected type
    return f"Cannot process web search for unexpected query type: {query}"

def calculate_date_difference(date1: str, date2: str) -> int:
    """
    计算两个日期之间的天数差异
    参数:
        date1: 第一个日期，格式为"YYYY-MM-DD"
        date2: 第二个日期，格式为"YYYY-MM-DD"
    返回:
        两个日期之间的天数差异（绝对值）
    """
    # 解析日期字符串为datetime对象
    try:
        d1 = datetime.strptime(date1, "%Y-%m-%d")
        d2 = datetime.strptime(date2, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError(f"日期格式错误，请使用YYYY-MM-DD格式: {e}")
    # 计算日期差并返回绝对值
    delta = d2 - d1
    return abs(delta.days)

agent = Agent(
    name="chat_agent",
    model_name="doubao-seed-1-6-250615",
    description="你是一个优秀的助手，你可以和用户进行对话。",
    instruction="""你是一个优秀的助手。当被提问时，请遵循以下步骤：
1. 首先，根据你的内部知识，生成一个初步的回答。
2. 然后，查询你的知识库，寻找与问题相关的信息来验证或丰富你的答案。
3. 如果知识库信息不足，或用户问题涉及实时、或知识库外的知识，请使用 `web_search` 工具进行网络搜索。
4. 最后，结合你的内部知识、知识库信息以及网络搜索结果，给出一个全面、准确的最终答案。""",
    knowledgebase=kb,
    tools=[calculate_date_difference, web_search],
)

runner = Runner(
    agent,
    app_name=APP_NAME,
)

if __name__ == "__main__":
    session_id = uuid4().hex
    print("欢迎使用交互式问答 Agent。输入 'exit' 或 'quit' 来结束对话。")
    while True:
        try:
            message = input("您: ")
            if message.lower() in ["exit", "quit"]:
                print("再见!")
                break

            completion = asyncio.run(
                runner.run(
                    messages=message,
                    session_id=session_id,
                )
            )
            print(f"Agent: {completion}")
        except KeyboardInterrupt:
            print("
再见!")
            break
```

##### 执行过程：

##### 执行结果

# 总结与对比

总而言之， KnowledgeBase 的设计让您可以轻松切换底层向量数据库，而无需更改大部分业务逻辑代码。主要的差异在于前期的配置和 viking 需要显式创建集合这一点。

| 特性                     | Viking 后端                                                      | OpenSearch 后端                                            |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| **核心优势**             | 托管服务，免运维，与火山引擎生态结合紧密。                       | 开源、灵活，可私有化部署，社区生态成熟。                   |
| **配置 (`config.yaml`)** | 需要 `viking.project` 和 `viking.region`。                       | 需要 `opensearch.host`, `port`, `username`, `password`。   |
| **初始化**               | 需要在使用前手动检查并调用 `kb.create_collection()`。            | 通常自动创建索引，无需额外步骤。                           |
| **代码使用**             | **完全一致**。`add_from_files`, `add_from_text` 等方法用法相同。 | **完全一致**。`veadk` 框架的抽象层做得很好。               |
| **依赖**                 | 依赖火山引擎的 `ak/sk` 进行认证和 embedding。                    | 同样需要 `ak/sk` 来调用 embedding 模型，但数据库本身独立。 |

本文档将介绍 VeADK 系统的\*\*短期记忆（Short-term Memory）\*\*机制及其应用。短期记忆的核心作用是保存「会话级」的上下文信息，从而提升多轮交互的一致性，让智能体的响应更连贯。

当用户与你的 Agent 开启对话时，ShortTermMemory 或 SessionService会自动创建一个 Session 对象。这个 Session 会全程跟踪并管理对话过程中的所有相关内容。

Note

- 更多信息可参考[Google ADK Session](https://google.github.io/adk-docs/sessions/session)

## 使用ShortTermMemory

下面展示了创建和使用短期记忆：

```python
import asyncio
from veadk import Agent, Runner
from veadk.memory.short_term_memory import ShortTermMemory

app_name = "app_short_term_1"
user_id = "user_short_term_1"
session_id = "session_short_term_1"

agent = Agent()
short_term_memory = ShortTermMemory(
    backend="local", # 指定 ShortTermMemory 的存储方式
    # 如果是 sqlite，指定数据库路径
    # local_database_path="/tmp/d_persistent_short_term_memory.db", 
)  
runner = Runner(
    agent=agent, short_term_memory=short_term_memory, app_name=app_name, user_id=user_id
)

async def main():
    response1 = await runner.run(
        messages="我在 7 月 15 日购买了 20 个冰激凌", session_id=session_id
    )
    print(f"response of round 1: {response1}")

    response2 = await runner.run(
        messages="我什么时候买了冰激凌？", session_id=session_id
    )
    print(f"response of round 2: {response2}")

if __name__ == "__main__":
    asyncio.run(main())
```

```text
package main

import (
    "context"
    "log"
    "strings"

    veagent "github.com/volcengine/veadk-go/agent/llmagent"
    "github.com/volcengine/veadk-go/common"
    "github.com/volcengine/veadk-go/utils"
    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/runner"
    "google.golang.org/adk/session"
    "google.golang.org/genai"
)

func main() {
    ctx := context.Background()
    appName := "ve_agent"
    userID := "user1111"

    rootAgent, err := veagent.New(&veagent.Config{
        Config: llmagent.Config{
            Name:        "RootAgent",
            Instruction: "Acknowledge the user's statement.",
        },
        ModelName:    common.DEFAULT_MODEL_AGENT_NAME,
        ModelAPIBase: common.DEFAULT_MODEL_AGENT_API_BASE,
        ModelAPIKey:  utils.GetEnvWithDefault(common.MODEL_AGENT_API_KEY),
    })
    if err != nil {
        log.Printf("NewLLMAgent failed: %v", err)
        return
    }
    sessionService := session.InMemoryService()

    runner1, err := runner.New(runner.Config{
        AppName:        appName,
        Agent:          rootAgent,
        SessionService: sessionService,
    })
    if err != nil {
        log.Fatal(err)
    }

    sessionID := "session123456789"
    _, err = sessionService.Create(ctx, &session.CreateRequest{
        AppName:   appName,
        UserID:    userID,
        SessionID: sessionID,
    })
    if err != nil {
        log.Fatalf("sessionService.Create error: %v", err)
    }
    userInput1 := genai.NewContentFromText("我在 7 月 15 日购买了 20 个冰激凌。", "user")

    var finalResponseText string
    for event, err := range runner1.Run(ctx, userID, sessionID, userInput1, agent.RunConfig{}) {
        if err != nil {
            log.Printf("Agent Error: %v", err)
            continue
        }
        if event.Content != nil && !event.LLMResponse.Partial {
            finalResponseText = strings.Join(textParts(event.LLMResponse.Content), "")
        }
    }
    log.Printf("Agent 1 Response: %s\n", finalResponseText)

    userInput2 := genai.NewContentFromText("我什么时候买了冰激凌？", "user")
    var finalResponse2Text string
    for event, err := range runner1.Run(ctx, userID, sessionID, userInput2, agent.RunConfig{}) {
        if err != nil {
            log.Printf("Agent Error: %v", err)
            continue
        }
        if event.Content != nil && !event.LLMResponse.Partial {
            finalResponse2Text = strings.Join(textParts(event.LLMResponse.Content), "")
        }
    }
    log.Printf("Agent 1 Response: %s\n", finalResponse2Text)
}
```

**示例输出**

```text
response of round 1: 听起来您记录了冰激凌的购买情况！请问您是否需要：

1. 计算相关费用（如果有单价信息）
2. 记录或分析消费习惯
3. 其他与这次购买相关的数据处理或记录需求？

response of round 2: 根据您提供的信息，您在 **7 月 15 日** 购买了 20 个冰激凌。
```

## 短期记忆的几种实现

VeADK 中，您可以使用如下短期记忆后端服务来初始化您的短期记忆：

| 类别         | 说明                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| `local`      | 内存短期记忆，程序结束后即清空。生产环境需要使用数据库进行持久化，以符合分布式架构要求。 |
| `mysql`      | 使用 MySQL 数据库存储短期记忆，可实现持久化                                              |
| `sqlite`     | 使用本地 SQLite 数据库存储短期记忆，可实现持久化                                         |
| `postgresql` | 使用 PostgreSQL 数据库存储短期记忆，可实现持久化                                         |

#### 数据库 backend 配置

```yaml
database:
    mysql:
        host: 
        user: 
        password: 
        charset: utf8
```

```yaml
database:
    postgresql:
        host: # host or ip 
        user: 
        password:
```

在火山引擎开通数据库

- [如何开通火山引擎 MySQL 数据库](https://www.volcengine.com/product/rds-mysql)
- [如何开通火山引擎 postgresql 数据库](https://www.volcengine.com/product/rds-pg)

## 会话管理

你通常无需直接创建或管理 `Session` 对象，而是通过 `SessionService` 来管理，负责对话会话的完整生命周期。

其核心职责包括：

1. **启动新会话**`create_session()`：当用户发起交互时，创建全新的 Session 对象。
1. **恢复已有会话**`get_session()`：通过 `session_id` 检索特定 Session ，使 Agent 能够接续之前的对话进度。
1. **保存对话进度**`append_event()`：将新的交互内容（Event 对象）追加到会话历史中。这也是会话状态的更新机制。
1. **列出会话列表**`list_sessions()`：查询特定用户及 application 下的活跃会话。
1. **清理会话数据**`delete_session()`：当会话结束或会话不再需要时，删除 Session 对象及其关联数据。

## 上下文压缩

随着 Agent 运行会话历史会不断增长，从而导致大模型处理数据的增长和响应时间变慢。上下文压缩功能使用滑动窗口方法来汇总会话历史数据，当会话历史超过预定义阈值时，系统会自动压缩旧事件。

### 配置上下文压缩

添加上下文压缩后，`Runner` 会在每次会话达到间隔时自动压缩会话历史。

```python
from google.adk.apps.app import App
from google.adk.apps.app import EventsCompactionConfig
from veadk.agent import Agent

root_agent = Agent(
    description="hello world agent",
    instruction="""你是一个智能助手，擅长用中文礼貌回复用户的问题。""",
)

app = App(
    name='my_agent',
    root_agent=root_agent,
    events_compaction_config=EventsCompactionConfig(
        compaction_interval=3,  # 每 3 次新调用触发一次压缩。
        overlap_size=1          # 包含前一个窗口的最后一次事件重叠。
    ),
)

root_agent = agent
```

### 定义压缩器

你可以使用`LlmEventSummarizer`自定义使用特定的大模型和压缩结构`PromptTemplate`。

```python
from google.adk.apps.app import App
from google.adk.apps.app import EventsCompactionConfig
from google.adk.models.lite_llm import LiteLlm
from google.adk.apps.llm_event_summarizer import LlmEventSummarizer

# 自定义压缩器使用的AI模型
summarization_llm = LiteLlm(
                model="volcengine/doubao-seed-1-6-lite-251015",
                api_key=f"{model_api_key}",
                api_base=f"{model_api_base}",
            )

my_compactor = LlmEventSummarizer(llm=summarization_llm,  
# 自定义压缩结构
prompt_template="""
Please summarize the conversation. Compression Requirements:
1. Retain key entities, data points, and timelines
2. Highlight core problems and solutions discussed
3. Maintain logical coherence and contextual relevance
4. Eliminate duplicate expressions and redundant details
""")

app = App(
    name='my-agent',
    root_agent=root_agent,
    events_compaction_config=EventsCompactionConfig(
        compactor=my_compactor,
        compaction_interval=5, 
        overlap_size=1
    ),
)
```

本文档介绍 VeADK 系统中的\*\*长期记忆（Long-term Memory）\*\*概念及应用。长期记忆用于跨会话、跨时间保存重要信息，以增强智能体在连续交互中的一致性和智能性。

**定义**：长期记忆是智能体用于存储超出单次会话范围的重要信息的机制，可以包含用户偏好、任务历史、知识要点或长期状态。

**为什么重要**：

- 支持跨会话的连续对话体验；
- 允许智能体在多次交互中保留学习成果和用户特定信息；
- 减少重复询问，提升用户满意度和效率；
- 支持长期策略优化，例如个性化推荐或任务追踪。

智能体用户需要长期记忆来实现更智能、个性化和可持续的交互体验，尤其在多次会话或复杂任务场景中显著提高系统实用性。

## 支持后端类型

调试可以用 `local` 后端。生产更建议使用 `viking` 或 `mem0` 后端。

| 类别         | 说明                                                       |
| ------------ | ---------------------------------------------------------- |
| `local`      | 内存跨 Session 记忆，程序结束后即清空 (仅适用于本地调试)   |
| `viking`     | 使用 VikingDB 记忆库产品作为长期记忆存储 (生产推荐)        |
| `mem0`       | 使用 Mem0 记忆库产品作为长期记忆存储 (生产推荐)            |
| `viking_mem` | 已废弃，设置后将会自动转为 `viking`                        |
| `opensearch` | 使用 OpenSearch 作为长期记忆存储，可实现持久化和检索       |
| `redis`      | 使用 Redis 作为长期记忆存储，Redis 需要支持 Rediseach 功能 |

## 初始化方法

在使用长期记忆之前，需要实例化 LongTermMemory 对象并指定后端类型。以下代码展示了如何初始化基于 VikingDB 的长期记忆模块，并将其绑定到 Agent：

```python
from veadk import Agent, Runner
from veadk.memory import LongTermMemory

# 初始化长期记忆
# backend="viking" 指定使用 VikingDB
# app_name 和 user_id 用于数据隔离
long_term_memory = LongTermMemory(
    backend="viking", app_name="local_memory_demo", user_id="demo_user"
)

# 将长期记忆绑定到 Agent
root_agent = Agent(
    name="minimal_agent",
    instruction="Acknowledge user input and maintain simple conversation.",
    long_term_memory=long_term_memory,  # 长期记忆实例
)

runner = Runner(agent=root_agent)
```

```go
package main

import (
    "log"

    veagent "github.com/volcengine/veadk-go/agent/llmagent"
    "github.com/volcengine/veadk-go/common"
    vem "github.com/volcengine/veadk-go/memory"
    "github.com/volcengine/veadk-go/tool/builtin_tools"
    "github.com/volcengine/veadk-go/utils"
    "google.golang.org/adk/runner"
    "google.golang.org/adk/session"
    "google.golang.org/adk/tool"
)

func main() {
    appName := "ve_agent"
    memorySearchTool, err := builtin_tools.LoadLongMemoryTool()
    if err != nil {
        log.Fatal(err)
        return
    }

    cfg := &veagent.Config{
        ModelName:    common.DEFAULT_MODEL_AGENT_NAME,
        ModelAPIBase: common.DEFAULT_MODEL_AGENT_API_BASE,
        ModelAPIKey:  utils.GetEnvWithDefault(common.MODEL_AGENT_API_KEY),
    }
    cfg.Name = "MemoryRecallAgent"
    cfg.Instruction = "Answer the user's question. Use the 'search_past_conversations' tools if the answer might be in past conversations."

    cfg.Tools = []tool.Tool{memorySearchTool}

    memorySearchAgent, err := veagent.New(cfg)
    if err != nil {
        log.Printf("NewLLMAgent failed: %v", err)
        return
    }

    sessionService := session.InMemoryService()
    memoryService, err := vem.NewLongTermMemoryService(vem.BackendLongTermViking, nil)
    if err != nil {
        log.Printf("NewLongTermMemoryService failed: %v", err)
        return
    }

    runner, err := runner.New(runner.Config{
        AppName:        appName,
        Agent:          memorySearchAgent,
        SessionService: sessionService,
        MemoryService:  memoryService,
    })
}
```

## 记忆管理

### 添加会话到长期记忆

在会话（Session）结束或达到特定节点时，需要显式调用 add_session_to_memory 将会话数据持久化。对于 Viking 后端，这一步会触发数据的向量化处理。

```python
# 假设 runner1 已经完成了一次对话
completed_session = await runner.session_service.get_session(
    app_name=APP_NAME, user_id=USER_ID, session_id=session_id
)

# 将完整会话归档到长期记忆
root_agent.long_term_memory.add_session_to_memory(completed_session)
```

```go
appName := "ve_agent"
userID := "user1111"
sessionService := session.InMemoryService()
s, err := sessionService.Create(ctx, &session.CreateRequest{
    AppName:   appName,
    UserID:    userID,
    SessionID: sessionID,
})

resp, err := sessionService.Get(ctx, &session.GetRequest{AppName: s.Session.AppName(), UserID: s.Session.UserID(), SessionID: s.Session.ID()})
if err != nil {
    log.Fatalf("Failed to get completed session: %v", err)
}
if err := memoryService.AddSession(ctx, resp.Session); err != nil {
    log.Fatalf("Failed to add session to memory: %v", err)
}
```

### 检索长期记忆

除了 Agent 在运行时自动检索外，开发者也可以调用 search_memory 接口直接进行语义搜索，用于调试或构建自定义的 RAG（检索增强生成）应用。

```python
query = "favorite project"
res = await root_agent.long_term_memory.search_memory(
    app_name=APP_NAME,
    user_id=USER_ID,
    query=query
)

# 打印检索结果
print(res)
```

```go
query := "favorite project"
memoryService.Search(ctx, &memory.SearchRequest{
    Query:   query,
    UserID:  userID,
    AppName: appName,
})
```

## 使用长期记忆进行会话管理

在单租户场景中，长期记忆可用于管理同一用户的多次会话，确保智能体能够：

- 在新会话中记忆上一次交互内容；
- 根据历史信息做出个性化响应；
- 在多轮任务中累积进度信息或中间结果。

### 准备工作

- 为每个用户分配唯一标识（user_id 或 session_owner_id）；
- 设计长期记忆数据结构以支持多会话信息保存；
- 配合短期记忆使用，实现会话内上下文快速访问。

### 示例

以下示例演示了一个完整的流程：Runner1 告诉 Agent 一个信息（"My favorite project is Project Alpha"），将会话存入记忆，然后创建一个全新的 Runner2，验证其能否回答相关问题。

```python
# --- 阶段 1: 写入记忆 ---
# Runner1 告诉 Agent 信息
runner1_question = "My favorite project is Project Alpha."
user_input = types.Content(role="user", parts=[types.Part(text=runner1_question)])

async for event in runner1.run_async(user_id=USER_ID, session_id=session_id, new_message=user_input):
    pass # 处理 Runner1 的响应

# 关键步骤：将会话归档到 VikingDB
completed_session = await runner1.session_service.get_session(app_name=APP_NAME, user_id=USER_ID, session_id=session_id)
root_agent.long_term_memory.add_session_to_memory(completed_session)

# --- 阶段 2: 跨会话读取 ---
# 初始化 Runner2 (模拟新的会话或后续交互)
runner2 = Runner(
    agent=root_agent,
    app_name=APP_NAME,
    user_id=USER_ID,
    short_term_memory=short_term_memory
)

# Runner2 提问，依赖长期记忆回答
qa_question = "favorite project"
qa_content = types.Content(role="user", parts=[types.Part(text=qa_question)])

final_text = None
async for event in runner2.run_async(user_id=USER_ID, session_id=session_id, new_message=qa_content):
    if event.is_final_response():
         final_text = event.content.parts[0].text.strip()
```

```go
package main

import (
    "context"
    "log"
    "strings"

    veagent "github.com/volcengine/veadk-go/agent/llmagent"
    "github.com/volcengine/veadk-go/common"
    vem "github.com/volcengine/veadk-go/memory"
    "github.com/volcengine/veadk-go/tool/builtin_tools"
    "github.com/volcengine/veadk-go/utils"
    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/runner"
    "google.golang.org/adk/session"
    "google.golang.org/adk/tool"
    "google.golang.org/genai"
)

func main() {
    ctx := context.Background()
    appName := "ve_agent"
    userID := "user1111"

    // Define a tools that can search memory.
    memorySearchTool, err := builtin_tools.LoadLongMemoryTool()
    if err != nil {
        log.Fatal(err)
        return
    }

    infoCaptureAgent, err := veagent.New(&veagent.Config{
        Config: llmagent.Config{
            Name:        "InfoCaptureAgent",
            Instruction: "Acknowledge the user's statement.",
        },
        ModelName:    common.DEFAULT_MODEL_AGENT_NAME,
        ModelAPIBase: common.DEFAULT_MODEL_AGENT_API_BASE,
        ModelAPIKey:  utils.GetEnvWithDefault(common.MODEL_AGENT_API_KEY),
    })
    if err != nil {
        log.Printf("NewLLMAgent failed: %v", err)
        return
    }

    cfg := &veagent.Config{
        ModelName:    common.DEFAULT_MODEL_AGENT_NAME,
        ModelAPIBase: common.DEFAULT_MODEL_AGENT_API_BASE,
        ModelAPIKey:  utils.GetEnvWithDefault(common.MODEL_AGENT_API_KEY),
    }
    cfg.Name = "MemoryRecallAgent"
    cfg.Instruction = "Answer the user's question. Use the 'search_past_conversations' tools if the answer might be in past conversations."

    cfg.Tools = []tool.Tool{memorySearchTool}

    memorySearchAgent, err := veagent.New(cfg)
    if err != nil {
        log.Printf("NewLLMAgent failed: %v", err)
        return
    }

    // Use all default config
    //sessionService, err := vem.NewShortTermMemoryService(vem.BackendShortTermPostgreSQL, nil)
    //if err != nil {
    //  log.Printf("NewShortTermMemoryService failed: %v", err)
    //  return
    //}
    sessionService := session.InMemoryService()
    memoryService, err := vem.NewLongTermMemoryService(vem.BackendLongTermViking, nil)
    if err != nil {
        log.Printf("NewLongTermMemoryService failed: %v", err)
        return
    }

    runner1, err := runner.New(runner.Config{
        AppName:        appName,
        Agent:          infoCaptureAgent,
        SessionService: sessionService,
        MemoryService:  memoryService,
    })
    if err != nil {
        log.Fatal(err)
    }

    SessionID := "session123456789"

    s, err := sessionService.Create(ctx, &session.CreateRequest{
        AppName:   appName,
        UserID:    userID,
        SessionID: SessionID,
    })
    if err != nil {
        log.Fatalf("sessionService.Create error: %v", err)
    }

    s.Session.State()

    userInput1 := genai.NewContentFromText("My favorite project is Project Alpha.", "user")
    var finalResponseText string
    for event, err := range runner1.Run(ctx, userID, SessionID, userInput1, agent.RunConfig{}) {
        if err != nil {
            log.Printf("Agent 1 Error: %v", err)
            continue
        }
        if event.Content != nil && !event.LLMResponse.Partial {
            finalResponseText = strings.Join(textParts(event.LLMResponse.Content), "")
        }
    }
    log.Printf("Agent 1 Response: %s\n", finalResponseText)

    // Add the completed session to the Memory Service
    log.Println("\n--- Adding Session 1 to Memory ---")
    resp, err := sessionService.Get(ctx, &session.GetRequest{AppName: s.Session.AppName(), UserID: s.Session.UserID(), SessionID: s.Session.ID()})
    if err != nil {
        log.Fatalf("Failed to get completed session: %v", err)
    }
    if err := memoryService.AddSession(ctx, resp.Session); err != nil {
        log.Fatalf("Failed to add session to memory: %v", err)
    }
    log.Println("Session added to memory.")

    log.Println("\n--- Turn 2: Recalling Information ---")

    runner2, err := runner.New(runner.Config{
        AppName:        appName,
        Agent:          memorySearchAgent,
        SessionService: sessionService,
        MemoryService:  memoryService,
    })
    if err != nil {
        log.Fatal(err)
    }

    s, _ = sessionService.Create(ctx, &session.CreateRequest{
        AppName:   appName,
        UserID:    userID,
        SessionID: "session2222",
    })

    userInput2 := genai.NewContentFromText("What is my favorite project?", "user")

    var finalResponseText2 []string
    for event, err := range runner2.Run(ctx, s.Session.UserID(), s.Session.ID(), userInput2, agent.RunConfig{}) {
        if err != nil {
            log.Printf("Agent 2 Error: %v", err)
            continue
        }
        if event.Content != nil && !event.LLMResponse.Partial {
            for _, part := range event.Content.Parts {
                finalResponseText2 = append(finalResponseText2, part.Text)
            }
        }
    }
    log.Printf("Agent 2 Response: %s\n", strings.Join(finalResponseText2, ""))

}

func textParts(Content *genai.Content) []string {
    var texts []string
    for _, part := range Content.Parts {
        texts = append(texts, part.Text)
    }
    return texts
}
```

### 说明 / 结果展示

- 智能体能够识别并关联同一用户的历史交互；
- 提供连续性强、个性化的多会话交互体验；
- 为长期任务、学习型应用或持续监控场景提供基础能力。

```text
[Log Output]
Runner1 Question: My favorite project is Project Alpha.
Runner1 Answer: (Acknowledged)
...
[Step 4] Archiving session to Long-Term Memory via memory_service
Session archived to Long-Term Memory
...
Runner2 Question: favorite project
Runner2 Answer: Your favorite project is Project Alpha.
```

## 自动保存 session 到长期记忆

为简化操作流程，VeADK 的 Agent 模块支持将对话 Session 自动保存至长期记忆。只需在初始化 Agent 时，开启 auto_save_session 属性并完成长期记忆组件的初始化配置即可，具体示例如下：

```python
from veadk import Agent
from veadk.memory import LongTermMemory

# 初始化长期记忆组件
long_term_memory = LongTermMemory(
    backend="viking", app_name=APP_NAME, user_id=USER_ID
)

# 初始化 Agent 并开启 Session 自动保存
agent = Agent(
    auto_save_session=True,
    long_term_memory=long_term_memory
)
```

为避免索引被频繁初始化，VeADK 提供 MIN_MESSAGES_THRESHOLD 和 MIN_TIME_THRESHOLD 两个环境变量，支持自定义 Session 保存周期。其中，默认触发保存的条件为累计 10 条 event 或间隔 60 秒；此外，当切换 Session 并发起新的问答请求时，VeADK 会自动将旧 Session 的会话内容保存至长期记忆中。

# 观测您的智能体

本文档介绍智能体系统中的 \*\*Tracing（跟踪）\*\*概念及其在开发和实践中的作用。 Tracing 是企业级智能体应用中实现可观测性（Observability）的核心组成部分。

______________________________________________________________________

## 全链路观测

Tracing 指的是对智能体执行过程的**全链路记录与追踪**。 在 Agent 系统中，这包括：

- 用户输入与请求的接收时间和内容；
- 智能体内部推理过程，例如模型调用、工具执行、策略决策；
- 各工具、服务或外部系统接口的调用记录；
- 响应生成及输出结果。

通过 Tracing，可以将智能体执行过程形成可分析、可追溯的日志数据，为开发、调试、监控和优化提供依据。

**核心特点**：

- **可视化链路**：每次请求从接入到响应的完整流程可追踪；
- **结构化数据**：支持记录上下文、状态、事件类型、耗时等；
- **跨组件追踪**：涵盖 Agent、工具、记忆模块、知识库及外部接口。

下面是一段 Tracing 数据的结构示例（一般为 `json` 格式文件）：

tracing.json

```json
{
    "name": "execute_tool get_city_weather",
    "span_id": 15420762184471404328,
    "trace_id": 195590910357197178730434145750344919939,
    "start_time": 1762770336065962000,
    "end_time": 1762770336066380000,
    "attributes": {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "get_city_weather",
      "gen_ai.tool.input": "{\"name\": \"get_city_weather\"}",
      "gen_ai.tool.output": "{\"response\": {\"result\": \"Sunny, 25°C\"}}",
      "cozeloop.input": "{\"name\": \"get_city_weather\"}",
      "cozeloop.output": "{\"response\": {\"result\": \"Sunny, 25°C\"}}"
    },
    "parent_span_id": 18301436667977577407
  }
```

## Tracing 的主要能力

在智能体系统中，引入 Tracing 有多方面价值：

**调试与问题定位**

- 智能体在多轮交互或复杂任务中可能出现逻辑错误、工具调用失败或模型输出异常
- 帮助开发者快速定位问题发生环节

**性能分析与优化**

- 通过跟踪各模块执行时间，可以发现性能瓶颈；
- 优化模型调用策略、工具执行顺序或缓存策略，提高系统响应速度。

**可审计性与合规性**：

- 企业级应用需要记录操作链路以满足审计或合规要求；
- Tracing 可提供完整的请求、响应和决策过程记录。

**多 Agent 系统协调**：

- 在多 Agent 协作场景中，Tracing 可以帮助分析各 Agent 的调用关系和数据流向；
- 支持跨 Agent 调度和工具调用的可视化追踪。

**系统可靠性提升**：

- 可及时发现异常或失败事件，并触发告警或自动恢复机制；
- 为长期运行的 Agent 系统提供稳定性保障。

下面是一段 Tracing 数据的链路示例，展示了一个智能体系统中多个 Agent 之间的调用和事件流程。

tracing.json

```json
# Tracing 在多 Agent 系统中调用和事件链路示例
# coding_agent -> python_coder_agent Tracing链路如下：
[
    {
        "name": "execute_tool transfer_to_agent",
        "span_id": 8839983747734433620,
        "trace_id": 161011438572144016825706884868588853689,
        "start_time": 1763089073534973000,
        "end_time": 1763089073535544000,
        "attributes": {
            "agent.name": "coding_agent",
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": "transfer_to_agent",
        },
        "parent_span_id": 5680387922600458423
    },
    {
        "name": "call_llm",
        "span_id": 6376035117066938110,
        "trace_id": 161011438572144016825706884868588853689,
        "start_time": 1763089073539770000,
        "end_time": 1763089112820657000,
        "attributes": {
            "agent.name": "python_coder",
            "gen_ai.request.model": "openai/doubao-seed-1-6-251015",
            "gen_ai.request.type": "chat",
            "gen_ai.span.kind": "llm",
            "gen_ai.prompt.0.role": "user",
            "gen_ai.prompt.0.content": "使用 Python 帮我写一段快速排序的代码。"
        },
        "parent_span_id": 11028930176666491606
    },
    {
        "name": "invoke_agent python_coder",
        "span_id": 11028930176666491606,
        "trace_id": 161011438572144016825706884868588853689,
        "start_time": 1763089073538867000,
        "end_time": 1763089112820868000,
        "attributes": {
            "gen_ai.span.kind": "agent",
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.agent.description": "擅长使用 Python 编程语言来解决问题。",
            "gen_ai.system": "openai",
            "agent.name": "python_coder"
        },
        "parent_span_id": 5680387922600458423
    },
    {
        "name": "call_llm",
        "span_id": 5680387922600458423,
        "trace_id": 161011438572144016825706884868588853689,
        "start_time": 1763089069195992000,
        "end_time": 1763089112820933000,
        "attributes": {
            "agent.name": "coding_agent",
            "gen_ai.request.model": "openai/doubao-seed-1-6-251015",
            "gen_ai.request.type": "chat",
            "gen_ai.span.kind": "llm",
            "gen_ai.prompt.0.role": "user",
            "gen_ai.prompt.0.content": "使用 Python 帮我写一段快速排序的代码。",
        },
        "parent_span_id": 987150150265236585
    },
    {
        "name": "invoke_agent coding_agent",
        "span_id": 987150150265236585,
        "trace_id": 161011438572144016825706884868588853689,
        "start_time": 1763089069192617000,
        "end_time": 1763089112821024000,
        "attributes": {
            "gen_ai.span.kind": "agent",
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.agent.description": "可以调用适合的智能体来解决用户问题。",
            "gen_ai.system": "openai",
            "agent.name": "coding_agent",
        },
        "parent_span_id": 11431457420615823859
    },
    {
        "name": "invocation",
        "span_id": 11431457420615823859,
        "trace_id": 161011438572144016825706884868588853689,
        "start_time": 1763089069192376000,
        "end_time": 1763089112821085000,
        "attributes": {
            "gen_ai.operation.name": "chain",
            "gen_ai.span.kind": "workflow",
            "gen_ai.system": "openai",
            "agent.name": "python_coder",
        },
        "parent_span_id": null
    }
]
```

通过 Tracing，开发者可以对智能体系统进行**可观察性增强**，从而实现高效开发、可靠运行以及持续优化。

## 在 VeADK 中开启观测

您可以在 VeADK 中开启火山引擎 Agent 执行全链路观测能力：

```python
import asyncio
from veadk import Agent, Runner
from veadk.tracing.telemetry.exporters.apmplus_exporter import APMPlusExporter
from veadk.tracing.telemetry.opentelemetry_tracer import OpentelemetryTracer

# init tracing exporter
exporters = [
    APMPlusExporter(),
]
tracer = OpentelemetryTracer(exporters=exporters)

# Define the Agent
agent = Agent(
    tracers=[tracer],
)

runner = Runner(agent=agent)

response = asyncio.run(runner.run(messages="hi!"))
print(response)
```

环境变量列表：

- `OBSERVABILITY_OPENTELEMETRY_APMPLUS_API_KEY`：APM 服务的 API Key
- `OBSERVABILITY_OPENTELEMETRY_APMPLUS_ENDPOINT`：APM 服务的 Endpoint, 例如 `http://apmplus-cn-beijing.volces.com:4317`
- `OBSERVABILITY_OPENTELEMETRY_APMPLUS_SERVICE_NAME`：APM 的 Service Name, 例如 `python_coder_agent`

或在 `config.yaml` 中定义：

config.yaml

```yaml
observability:
  opentelemetry:
     apmplus:
        endpoint: ...
        api_key: ...
        service_name: ...
```

开启后，您可以看到日志中可以打印出相关 Tracing 数据的 ID：

与 OpenTelemetry 的兼容性

VeADK 相关字段命名遵循 OpenTelemetry 生成式 AI 规范，您可以直接将 Tracing 数据导入到 OpenTelemetry 兼容的系统中进行分析和可视化。

## CozeLoop 平台

通过 VeADK 开发的火山智能体接入到扣子罗盘之后，可以通过扣子罗盘的评测功能进行 Agent 评测，或者通过 Trace 功能实现调用链路观测。火山智能体的 Trace 数据可以直接上报至扣子罗盘，实现调用链路观测；在扣子罗盘中注册的火山智能体，也可以通过观测功能进行 Agent 评测。

### 准备工作

在 VeADK 配置文件 config.yaml 的 observability 字段中填写 cozeloop 的属性。关于配置文件的详细说明及示例可参考配置文件。

- endpoint：固定设置为 `https://api.coze.cn/v1/loop/opentelemetry/v1/traces`
- api_key：扣子罗盘访问密钥，支持个人访问令牌、OAuth 访问令牌和服务访问令牌。获取方式可参考[配置个人访问令牌](https://loop.coze.cn/open/docs/cozeloop/authentication-for-sdk#05d27a86)。
- service_name：扣子罗盘工作空间的 ID。你可以在登录扣子罗盘之后，左上角切换到想要存放火山智能体数据的工作空间，并在 URL 的 space 关键词之后获取工作空间 ID，例如 `https://loop.coze.cn/console/enterprise/personal/space/739XXXXXXXX092/pe/prompts` 中，**739XXXXXXXX092**为工作空间 ID。

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-flash-250828
    api_base: https://ark.cn-beijing.volces.com/api/v3
    api_key: your api_key

volcengine:
  access_key: your ak
  secret_key: your sk

observability:
  opentelemetry:
    cozeloop:
      endpoint: https://api.coze.cn/v1/loop/opentelemetry/v1/traces
      api_key: your your api_key
      service_name: your cozeloop space id
```

### 部署运行

#### Cozeloop exporter接入代码

agent.py

```python
import asyncio

from veadk import Agent, Runner
from veadk.memory.short_term_memory import ShortTermMemory
from veadk.tools.demo_tools import get_city_weather
from veadk.tracing.telemetry.exporters.cozeloop_exporter import CozeloopExporter
from veadk.tracing.telemetry.opentelemetry_tracer import OpentelemetryTracer
from veadk.tracing.telemetry.exporters.cozeloop_exporter import CozeloopExporterConfig


cozeloop_exporter = CozeloopExporter()

exporters = [cozeloop_exporter]
tracer = OpentelemetryTracer(exporters=exporters)

agent = Agent(tools=[get_city_weather], tracers=[tracer])

session_id = "session_id_pj"

runner = Runner(agent=agent, short_term_memory=ShortTermMemory())

prompt = "How is the weather like in Beijing? Besides, tell me which tool you invoked."

asyncio.run(runner.run(messages=prompt, session_id=session_id))
```

#### 效果展示

```bash
python agent.py
```

## APMPlus 平台

通过 VeADK 开发的火山智能体可以通过定义 APMPlus 数据导出器接入到火山引擎 APMPlus 平台，实现调用链路观测。

### 准备工作

- endpoint：指定APMPlus的接入点为 http://apmplus-cn-beijing.volces.com:4317
- api_key：需填入有效应用程序密钥。
- service_name：指定服务名称，可根据实际需求修改。 初始化 APMPlusExporter：利用APMPlusExporterConfig配置端点、应用程序密钥和服务名称，创建APMPlusExporter实例，配置从环境变量获取。示例代码如下：

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-flash-250828
    api_base: https://ark.cn-beijing.volces.com/api/v3
    api_key: your api_key

volcengine:
  access_key: your ak
  secret_key: your sk

observability:
  opentelemetry:
    apmplus:
      endpoint: http://apmplus-cn-beijing.volces.com:4317
      api_key: your api_key
      service_name: apmplus_veadk_pj
```

agent.py

```python
import asyncio

from veadk import Agent, Runner
from veadk.memory.short_term_memory import ShortTermMemory
from veadk.tools.demo_tools import get_city_weather
from veadk.tracing.telemetry.exporters.apmplus_exporter import APMPlusExporter
from veadk.tracing.telemetry.opentelemetry_tracer import OpentelemetryTracer
from veadk.tracing.telemetry.exporters.apmplus_exporter import APMPlusExporterConfig
from os import getenv


apmplus_exporter = APMPlusExporter()

exporters = [apmplus_exporter]

tracer = OpentelemetryTracer(exporters=exporters)

agent = Agent(tools=[get_city_weather], tracers=[tracer])

session_id = "session_id_pj"

runner = Runner(agent=agent, short_term_memory=ShortTermMemory())

prompt = "How is the weather like in Beijing? Besides, tell me which tool you invoked."
asyncio.run(runner.run(messages=prompt, session_id=session_id))
```

### 部署运行

本地运行上述agent.py代码，触发APMPlus追踪器记录Agent运行的各个节点的调用，以及Metrics信息上传云端存储：

```bash
python agent.py
```

#### 会话信息

#### trace信息

#### 模型指标信息

## TLS 平台

通过 VeADK 开发的火山智能体可以通过定义 TLS 数据导出器来接入到火山引擎日志服务 TLS，并在 TLS 的观测功能模块中进行 Agent 执行链路观测。

### 准备工作

#### VeADK代码中创建tracing project和实例

config.yaml

```yaml
model:
  agent:
    provider: openai
    name: doubao-seed-1-6-flash-250828
    api_base: https://ark.cn-beijing.volces.com/api/v3
    api_key: your api_key

volcengine:
  access_key: your ak
  secret_key: your sk

observability:
  opentelemetry:
    tls:
      endpoint: https://tls-cn-beijing.volces.com:4318/v1/traces
      service_name: tp_pj
      region: cn-beijing
```

agent.py

```python
import asyncio

from veadk import Agent, Runner
from veadk.memory.short_term_memory import ShortTermMemory
from veadk.tools.demo_tools import get_city_weather
from veadk.tracing.telemetry.exporters.tls_exporter import TLSExporter
from veadk.tracing.telemetry.opentelemetry_tracer import OpentelemetryTracer
from veadk.tracing.telemetry.exporters.tls_exporter import TLSExporterConfig
from veadk.integrations.ve_tls.ve_tls import VeTLS
from os import getenv

# 初始化VeTLS客户端用于创建日志项目和追踪实例
ve_tls_client = VeTLS()

# 创建日志项目
project_name = "veadk_pj"
log_project_id = ve_tls_client.create_log_project(project_name)
print(f"Created log project with ID: {log_project_id}")

# 创建追踪实例
trace_instance_name = getenv("OBSERVABILITY_OPENTELEMETRY_TLS_SERVICE_NAME")
trace_instance = ve_tls_client.create_tracing_instance(log_project_id, trace_instance_name)
print(f"Created trace instance with ID: {trace_instance['TraceInstanceId']}")
```

#### TLS Exporter接入代码示例

agent.py

```python
import asyncio

from veadk import Agent, Runner
from veadk.memory.short_term_memory import ShortTermMemory
from veadk.tools.demo_tools import get_city_weather
from veadk.tracing.telemetry.exporters.tls_exporter import TLSExporter
from veadk.tracing.telemetry.opentelemetry_tracer import OpentelemetryTracer
from veadk.tracing.telemetry.exporters.tls_exporter import TLSExporterConfig
from veadk.integrations.ve_tls.ve_tls import VeTLS
from os import getenv

# 初始化TLSExporter用于上报 tracing 数据
tls_exporter = TLSExporter(
    config=TLSExporterConfig(
        topic_id=trace_instance.get('TraceTopicId', trace_instance_name),
    )
)

exporters = [tls_exporter]

tracer = OpentelemetryTracer(exporters=exporters)

agent = Agent(tools=[get_city_weather], tracers=[tracer])

session_id = "session_id_pj"

runner = Runner(agent=agent, short_term_memory=ShortTermMemory())

prompt = "How is the weather like in Beijing? Besides, tell me which tool you invoked."

asyncio.run(runner.run(messages=prompt, session_id=session_id))
```

### 部署运行

本地运行上述agent.py代码，触发TLS Project、Topic的创建，并且通过追踪器记录Agent运行的各个节点的调用：

```bash
python agent.py
```

本教程将介绍如何将您的 Agent 部署到火山引擎 VeFaaS 函数服务。

## 前置准备

在开始部署之前，请确保你已完成以下准备工作：

1. **创建火山引擎账号**：你首先需要一个有效的火山引擎账号。
1. **开通相关云服务**：为了成功部署和访问 Veadk 应用，你需要在火山引擎控制台中激活以下服务。这些通常是首次访问服务时根据引导完成的一次性操作。
1. [**函数服务 (veFaaS)**](https://console.volcengine.com/vefaas)：用于托管和运行你的 Agent 应用代码。
1. [**API 网关 (API Gateway)**](https://console.volcengine.com/veapig)：用于创建和管理 API，使你的 Agent 应用能够从外部访问。

在部署到火山引擎前，你需要提前在火山引擎控制台开通 [函数服务](https://console.volcengine.com/vefaas) 和 [API网关](https://console.volcengine.com/veapig) 服务。如果你事先已开通过服务，可以忽略该环节。

### 首次开通服务授权

如果你是首次使用上述服务，控制台会引导你完成必要的 IAM (Identity and Access Management) 角色授权。

1. 访问 [函数服务](https://console.volcengine.com/vefaas) 或 [API 网关](https://console.volcengine.com/veapig) 的控制台页面。
1. 在页面弹出的授权提示中，单击 **立即授权**。
1. 授权成功后，系统会自动跳转至对应服务的控制台主页，表明服务已成功开通。

> ⚠️ **注意**：此授权步骤是必需的，它授予函数服务和 API 网关访问其他云资源的权限，以确保应用能够正常部署和运行。

### 函数服务

1. 首次进入 [函数服务](https://console.volcengine.com/vefaas) 页面，控制台将会提醒你进行IAM角色的开通，请点击【立即授权】同意角色开通。
1. 点击后，控制台将会显示你已完成授权。几秒后将会自动跳转会 [函数服务](https://console.volcengine.com/vefaas) 控制台。当展示如下页面时，[函数服务](https://console.volcengine.com/vefaas) 服务即开通成功。

### API网关

1. 首次进入 [API网关](https://console.volcengine.com/veapig) 页面，控制台将会提醒你进行IAM角色的开通，请点击【立即授权】同意角色开通。
1. 点击后，控制台将会显示你已完成授权。几秒后将会自动跳转会 [API网关](https://console.volcengine.com/veapig) 控制台。当展示如下页面时，[API网关](https://console.volcengine.com/veapig) 服务即开通成功。

## 部署方式概览

Veadk 提供多种部署方式以适应不同的开发工作流：

- **通过命令行工具 (CLI) 部署**：最快捷的方式，适合快速创建、部署和迭代 Agent 应用。
- **通过 Python SDK 部署**：允许你通过编写代码以编程方式管理部署流程，适合集成到自动化脚本或现有项目中。
- **设置持续交付 (CI/CD)**：与代码仓库（如 GitHub）集成，实现代码提交后自动构建和部署，是团队协作和生产环境的最佳实践。

接下来，我们将详细介绍每种部署方式的操作步骤。

## 通过命令行工具 (CLI) 部署

您可以从以下两个方式来部署使用 VeADK 建设的 Agent 项目。

### 方式一：从零开始创建并部署新项目

如果你想快速启动一个标准的企业级 Agent 项目，`veadk init` 命令是最佳选择。它会为你生成一个预设了完整结构和配置的模板项目。

#### 1. 初始化项目

在你的终端中运行以下命令：

```shell
veadk init
```

该命令会引导你完成项目的基本配置。你需要根据提示输入以下信息：

```shell
$ veadk init
Welcome use VeADK to create your project. We will generate a `weather-reporter` application for you.
Local directory name [veadk-cloud-proj]: 
Volcengine FaaS application name [veadk-cloud-agent]: 
Volcengine API Gateway instance name []: 
Volcengine API Gateway service name []: 
Volcengine API Gateway upstream name []: 
Choose a deploy mode:
  1. A2A/MCP Server
  2. VeADK Web / Google ADK Web
Enter your choice (1, 2): 1
Template project has been generated at .../veadk-cloud-proj
Edit .../veadk-cloud-proj/src to define your agents
Edit .../veadk-cloud-proj/deploy.py to define your deployment attributes
Run python `deploy.py` for deployment on Volcengine FaaS platform.
```

**参数说明**：

- **Local directory name**：项目在本地创建的目录名称。
- **Volcengine FaaS application name**：你的应用在火山引擎函数服务平台的名称。**注意**：名称中不能包含下划线 `_`。
- **Volcengine API Gateway ...**：API 网关相关的实例、服务和上游名称。这些为**可选**参数。如果留空，Veadk 会在部署时自动创建和关联相应的网关资源。
- **Choose a deploy mode**：选择部署模式。
- `A2A/MCP Server`：标准的后端 Agent 服务模式。
- `VeADK Web / Google ADK Web`：如果你需要一个 Web 交互界面，请选择此项。

项目初始化完成后，你可以在生成的 `deploy.py` 文件中随时修改这些配置。

生成后的项目结构如下：

```shell
veadk-cloud-proj
├── __init__.py
├── clean.py # 清除脚本
├── config.yaml.example # 定义环境变量
├── deploy.py # 部署脚本
└── src
    ├── __init__.py
    ├── agent.py # agent 运行时数据导出
    ├── app.py # Server 定义
    ├── requirements.txt 依赖
    ├── run.sh # 启动脚本
    └── weather_report # agent module
        ├── __init__.py # 必须包含`from . import agent`
        └── agent.py # agent 定义
```

#### 2. 配置环境变量与凭证

部署前，你需要配置必要的环境变量，特别是访问火山引擎所需的身份凭证。

1. 在项目根目录下，将 `config.yaml.example` 文件复制一份并重命名为 `config.yaml`。
1. 编辑 `config.yaml` 文件，填入你的火山引擎访问密钥 (Access Key 和 Secret Key)。
1. 如果是新建的火山账号，还需确认是否已经授权给`ServerlessApplicationRole`角色。进入[创建应用页面](https://console.volcengine.com/vefaas/region:vefaas+cn-beijing/application/create)点击[一键授权]即可。

```yaml
volcengine:
  access_key: "YOUR_ACCESS_KEY"    # 替换为你的火山引擎 Access Key
  secret_key: "YOUR_SECRET_KEY"  # 替换为你的火山引擎 Secret Key
```

> ⚠️ **重要提示**：`config.yaml` 文件包含了敏感的凭证信息，它不会被上传到云端。文件中的配置项会作为环境变量注入到函数服务的运行环境中。请务必确保此文件的安全，不要将其提交到公共代码仓库。

#### 3. 执行部署

完成配置后，在项目根目录下运行部署脚本：

```shell
python deploy.py
```

脚本执行后，如果看到 `Start to release VeFaaS application` 的提示，说明部署流程已开始。当终端输出以下类似信息时，代表你的 Agent 应用已成功部署并发布。

```shell
VeFaaS application ID: 3b015fxxxxxx
Test message: How is the weather like in Beijing?
```

### 方式二：部署现有项目

如果你已经有一个本地开发的 Agent 项目，可以使用 `veadk deploy` 命令将其快速部署到火山引擎函数服务平台。

#### 1. 项目准备

在执行部署前，请确保你的项目满足以下结构要求：

- 项目根目录下必须包含一个 `agent.py` 文件，且该文件中定义了一个全局变量 `root_agent`。
- 项目根目录下必须包含一个 `__init__.py` 文件，且该文件中包含了 `from . import agent` 语句。

#### 2. 执行部署

在你的项目根目录下运行以下命令：

```shell
veadk deploy --vefaas-app-name 「YourAgentAppName}
```

请将 `{YourAgentAppName}` 替换为你的应用名称。执行后，如果看到 `Start to release VeFaaS application` 的提示，说明部署已开始。

`veadk deploy`命令支持丰富的参数以进行详细配置，你可以通过命令行标志传入，或通过环境变量设置。

| 名称                        | 类型   | 释义                                            |
| --------------------------- | ------ | ----------------------------------------------- |
| --access-key                | 字符串 | 火山引擎AK                                      |
| --secret-key                | 字符串 | 火山引擎SK                                      |
| --vefaas-app-name           | 字符串 | 火山引擎 VeFaaS 平台应用名称                    |
| --veapig-instance-name      | 字符串 | 火山引擎网关实例名称                            |
| --veapig-service-name       | 字符串 | 火山引擎网关服务名称                            |
| --veapig-upstream-name      | 字符串 | 火山引擎网关Upstream名称                        |
| --short-term-memory-backend | 字符串 | `local`或者 `mysql`， 短期记忆后端              |
| --use-adk-web               | FLAG   | 设置后将会在云端启动 web，否则为 A2A / MCP 模式 |
| ---path                     | 字符串 | 本地项目路径，默认为当前目录                    |

## 通过 Python SDK 部署

对于希望将部署流程集成到自动化脚本或现有代码库中的开发者，Veadk 提供了强大的 Python SDK。你可以通过 `CloudAgentEngine` 类以编程方式完成应用的部署、更新和删除。

### 1. 部署 Agent 应用

`CloudAgentEngine` 是部署操作的核心。实例化该类后，调用其 `deploy` 方法即可部署你的 Agent 项目。

**凭证配置**：

在实例化 `CloudAgentEngine` 时，你可以直接传入火山引擎的 AK/SK。如果未提供，SDK 会自动从环境变量 `VOLCENGINE_ACCESS_KEY` 和 `VOLCENGINE_SECRET_KEY` 中读取。

**代码示例**：

```python
from veadk.cloud.cloud_agent_engine import CloudAgentEngine

# 1. 初始化云引擎，凭证将从环境变量自动获取
engine = CloudAgentEngine()

# 2. 调用 deploy 方法部署应用
cloud_app = engine.deploy(
    application_name="my-python-agent",
    path="./path/to/your/agent/project",
    gateway_name="my-agent-gateway",
    use_adk_web=False
)

# 部署成功后，可以获取应用的访问端点
print(f"Application endpoint: {cloud_app.vefaas_endpoint}")
```

`deploy` 方法的关键参数如下：

| 名称                  | 类型   | 释义                                 |
| --------------------- | ------ | ------------------------------------ |
| path                  | 字符串 | 本地Agent项目路径                    |
| application_name      | 字符串 | 火山引擎 VeFaaS 平台应用名称         |
| gateway_name          | 字符串 | 火山引擎网关实例名称                 |
| gateway_service_name  | 字符串 | 火山引擎网关服务名称                 |
| gateway_upstream_name | 字符串 | 火山引擎网关Upstream名称             |
| use_adk_web           | 布尔值 | 是否在云端使用VeADK Web / Google Web |

### 2. 管理已部署的应用

`deploy` 方法成功执行后，会返回一个 `CloudApp` 实例。这个实例代表了你在云端部署的应用，你可以使用它来进行后续的管理操作，如发起调用、更新代码或删除应用。

#### 发起远程调用

你可以通过 `CloudApp` 实例与云端的 Agent 进行交互。主要方法包括创建会话 (`create_session`) 和发送消息 (`invoke`)。

**代码示例**：

```python
from veadk.cloud.cloud_app import CloudApp

# 假设 cloud_app 是通过 engine.deploy() 返回的实例
cloud_app: CloudApp = CloudApp()

# 定义会话和用户信息
USER_ID = "test_user_001"
SESSION_ID = "test_session_123"

# 1. 发起调用（发送消息）
response = cloud_app.message_send(
    user_id=USER_ID,
    session_id=SESSION_ID,
    message="请问北京今天天气怎么样？"
)

print(f"Agent response: {response}")
```

如果你需要与一个已经部署好的应用进行交互（而非在部署后立即交互），你也可以通过提供应用的访问端点 (Endpoint) 来创建一个 `CloudApp` 实例。

```python
from veadk.cloud.cloud_app import CloudApp

# 应用的访问端点 URL，可以在函数服务控制台找到
APP_ENDPOINT = "<YOUR_APPLICATION_ENDPOINT>"
SESSION_ID = "<test_session>"
USER_ID = "<test_user>"

# 通过端点创建 CloudApp 实例
app = CloudApp(vefaas_endpoint=APP_ENDPOINT)

# 后续调用方式相同
response = app.message_send(user_id=USER_ID, session_id=SESSION_ID, message="深圳呢？")
print(f"Agent response: {response}")
```

#### 更新应用代码

当你本地的 Agent 代码有更新时，可以使用 `update_function_code` 方法来更新已部署的应用，而无需重新创建一个新应用。

> ⚠️ **注意**：此操作只会更新函数的代码和配置，应用原有的访问端点 (Endpoint) 会保持不变。

```python
from veadk.cloud.cloud_agent_engine import CloudAgentEngine

engine = CloudAgentEngine()

# 更新现有应用的代码，保持相同的访问端点
updated_cloud_app = engine.update_function_code(
    application_name="my-agent-app",  # 现有应用名称
    path="/my-agent-project"        # 本地项目路径，确保项目路径包含agent.py文件
)

# 可以使用updated_cloud_app.vefaas_endpoint访问您的项目
```

#### 删除应用

如果你需要下线并删除一个已部署的应用，可以使用 `remove` 方法。

> ⚠️ **警告**：删除操作是不可逆的，它将彻底移除函数服务应用及其相关配置。请谨慎操作。

**代码示例**：

```python
from veadk.cloud.cloud_agent_engine import CloudAgentEngine

engine = CloudAgentEngine()

# 调用 remove 方法删除指定应用
engine.remove(app_name="my-python-agent")
```

为了防止误操作，执行此命令时，终端会要求你进行确认。你需要输入 `y` 并按回车键才能完成删除。

```shell
Confirm delete cloud app my-python-agent? (y/N): y
```

## 验证与调用应用

应用部署成功后，你可以通过火山引擎控制台验证部署状态，并使用不同协议与你的 Agent 服务进行交互。

### 在控制台验证部署

1. 登录 [火山引擎函数服务 (veFaaS) 控制台](https://console.volcengine.com/vefaas)。
1. 在左侧导航栏中，选择 **我的应用**。
1. 在应用列表中，你应该能看到你刚刚部署的应用。你可以单击应用名称进入详情页，查看其配置、日志、监控和访问端点等信息。

### 调用方法

部署完成后，Veadk Agent 服务支持通过两种标准协议进行调用：A2A (Agent-to-Agent) 和 MCP (Meta-protocol for Calling Plugins)。

> **关于 API 网关认证**： 默认情况下，Veadk 通过 API 网关创建的服务会启用密钥认证 (Key Authentication) 插件，以确保接口的安全性。这意味着所有发向该接口的请求都需要在请求中包含正确的认证凭证 (Token)。 * **对于生产环境**：强烈建议保留此安全设置，并在你的客户端代码中正确传递认证凭证。 * **对于快速测试**：如果你在内部测试环境中需要临时绕过认证，可以手动在 [API 网关控制台](https://console.volcengine.com/veapig) 的 **插件中心** 找到对应的插件并将其**禁用**。但请注意，这会使你的 API 端点暴露于公网，带来安全风险。

#### 1. 获取认证凭证 (Key Auth Token)

1. 登录 [API 网关控制台](https://console.volcengine.com/veapig)。
1. 在左侧导航栏中，选择 **消费者管理**。
1. 找到与你的应用关联的消费者，并复制其 **Key Auth Token**。

#### 2. 通过 A2A 协议调用

A2A 协议用于 Agent 之间的直接通信。你可以使用 `CloudApp` 或 `RemoteVeAgent` 类来发起调用。

**方式一：直接调用 (使用 `CloudApp`)**

```python
import asyncio
from veadk.cloud.cloud_app import CloudApp

# -- 配置 --
ENDPOINT = "<YOUR_APPLICATION_ENDPOINT>"  # 替换为你的应用访问端点
SESSION_ID = "test_session"
USER_ID = "test_user"
TEST_MESSAGE = "北京今天的天气怎么样？"

async def main():
    # 使用端点初始化 CloudApp 实例
    app = CloudApp(vefaas_endpoint=ENDPOINT)

    # 发送消息
    response = await app.message_send(TEST_MESSAGE, SESSION_ID, USER_ID)
    print(f"A2A Response: {response}")

if __name__ == "__main__":
    asyncio.run(main())
```

> ⚠️ **注意**：上述 `CloudApp` 的直接调用方式默认不会携带认证信息。如果你的 API 网关开启了密钥认证，此调用会失败。你需要使用下一种方式，或临时关闭认证插件。

**方式二：作为子 Agent 远程调用 (使用 `RemoteVeAgent`)**

它将云端的 Agent 封装为一个 `RemoteVeAgent` 对象，并在本地作为另一个 Agent 的子 Agent 来调用，同时可以方便地处理认证。

```python
import asyncio
from veadk import Agent, Runner
from veadk.a2a.remote_ve_agent import RemoteVeAgent

# -- 配置 --
ENDPOINT = "<YOUR_APPLICATION_ENDPOINT>"      # 替换为你的应用访问端点
KEY_AUTH_TOKEN = "<YOUR_KEY_AUTH_TOKEN>"  # 替换为你的 Key Auth Token
SESSION_ID = "test_session"
USER_ID = "test_user"
TEST_MESSAGE = "上海呢？"

async def main():
    # 1. 将云端 Agent 封装为 RemoteVeAgent
    remote_agent = RemoteVeAgent(
        name="cloud_weather_agent",
        url=ENDPOINT,
        auth_token=KEY_AUTH_TOKEN,
        auth_method="querystring"  # 指定 token 通过查询字符串传递
    )

    # 2. 创建一个本地 Agent，并将远程 Agent 作为其子 Agent
    local_agent = Agent(
        name="local_query_agent",
        instruction="将用户问题转发给云端 Agent 并返回结果。",
        sub_agents=[remote_agent],
    )

    # 3. 使用 Runner 执行任务
    runner = Runner(agent=local_agent, user_id=USER_ID)
    response = await runner.run(TEST_MESSAGE, session_id=SESSION_ID)
    print(f"A2A Remote Response: {response}")

if __name__ == "__main__":
    asyncio.run(main())
```

#### 3. 通过 MCP 协议调用

MCP 协议提供了一种标准化的方式来发现和调用插件（即你的 Agent）。你可以使用 `fastmcp` 库来构造客户端。

```python
import asyncio
from fastmcp import Client

# -- 配置 --
ENDPOINT = "<YOUR_APPLICATION_ENDPOINT>"      # 替换为你的应用访问端点
KEY_AUTH_TOKEN = "<YOUR_KEY_AUTH_TOKEN>"  # 替换为你的 Key Auth Token
SESSION_ID = "my_test_session_03"
USER_ID = "my_test_user_03"
TEST_MESSAGE = "广州今天天气如何？"

async def main():
    # 构造带有认证 token 的 MCP 端点 URL
    mcp_endpoint = f"{ENDPOINT}/mcp?token={KEY_AUTH_TOKEN}"

    # 如果关闭了网关的密钥认证，则无需 token 参数
    # mcp_endpoint = f"{ENDPOINT}/mcp"

    client = Client(mcp_endpoint)
    async with client:
        # 发现可用的工具 (Agent)
        tools = await client.list_tools()
        print(f"MCP Available Tools: {tools}")

        # 调用 run_agent 工具
        response = await client.call_tool(
            "run_agent",
            {
                "user_input": TEST_MESSAGE,
                "session_id": SESSION_ID,
                "user_id": USER_ID,
            },
        )
        print(f"MCP Response: {response}")

if __name__ == "__main__":
    asyncio.run(main())
```

## 持续交付

为了实现更高效、自动化的开发工作流，Veadk 支持与火山引擎的[持续交付](https://console.volcengine.com/cp) (Continuous Delivery, CP) 和[镜像仓库](https://console.volcengine.com/cr) (Container Registry, CR) 服务集成。通过设置 CI/CD 流水线，你可以将代码提交、构建、测试和部署等环节自动化，实现代码变更后自动发布新版本。

> **最佳实践**：通过容器镜像进行部署是生产环境中的最佳实践，它能确保开发、测试和生产环境的一致性，并简化部署流程。

### 1. 前提条件：开通相关服务

在使用持续交付功能前，请确保你已在火山引擎控制台开通以下服务：

- [**持续交付 (CP)**](https://console.volcengine.com/cp)
- [**镜像仓库 (CR)**](https://console.volcengine.com/cr)

与函数服务和 API 网关类似，首次访问这些服务时，你需要根据页面提示完成 **IAM 角色授权**。

#### 持续交付

1. 首次进入 [持续交付](https://console.volcengine.com/cp) 页面，控制台将会提醒你进行IAM角色的开通，请点击【立即授权】同意角色开通。
1. 点击授权后，控制台将会继续为你开通服务，界面如下。
1. 当点击【申请开通】后，控制台将会自动跳转。当展示如下页面时，[持续交付](https://console.volcengine.com/cp)\` 服务即开通成功。

#### 镜像仓库

1. 首次进入 [镜像仓库](https://console.volcengine.com/cr) 页面，控制台将会提醒你进行IAM角色的开通，请点击【立即授权】同意角色开通。
1. 点击授权后，控制台将会自动跳转。当展示如下页面时，[持续交付](https://console.volcengine.com/cp) 服务即开通成功。

### 2. 挂载持续交付流水线

VeADK 内置了火山引擎[持续交付](https://console.volcengine.com/cp)产品来便捷您的部署与持续交付。结合火山引擎[镜像仓库](https://console.volcengine.com/cr)产品，能够通过镜像将您的项目持续交付到火山引擎 FaaS 服务。

使用命令 `veadk pipeline` 来连结您的代码仓库与火山引擎[镜像仓库](https://console.volcengine.com/cr)、[持续交付](https://console.volcengine.com/cp)服务。命令的主要工作流程：

1. 帮助您在 VeFaaS 上创建一个含有模板镜像（Simple FastAPI）的镜像函数
1. 将[持续交付](https://console.volcengine.com/cp)服务绑定至您的 Github 仓库与创建好的 VeFaaS 函数

配置完成后，每当你向指定的 GitHub 仓库分支提交代码时，流水线将被自动触发，并执行以下操作：

1. **构建镜像**：基于你的项目代码构建一个容器镜像。
1. **推送镜像**：将构建好的镜像推送到你的私有[镜像仓库](https://console.volcengine.com/cr) (CR) 中。
1. **部署更新**：使用新镜像更新函数服务 (veFaaS) 中的应用，完成新版本的发布。

#### 使用方法

在你的项目目录下，运行 `veadk pipeline` 命令并提供必要的参数。一个典型的调用如下：

```shell
veadk pipeline --github-url <YOUR_GITHUB_REPO_URL> --github-branch main --github-token <YOUR_GITHUB_TOKEN>
```

> ⚠️ **注意**：在运行此命令的目录中，请确保已准备好 `config.yaml` 文件。文件中的配置项（如 API Keys 或其他环境变量）将在构建镜像时被打包到应用中。 命令 veadk pipeline 参数：

#### 参数详解

| 参数                      | 说明                                                                                   | 默认值 / 必填                        |
| ------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------ |
| `--github-url`            | Github 仓库 URL                                                                        | 必填                                 |
| `--github-branch`         | Github 项目的分支                                                                      | 必填                                 |
| `--veadk-version`         | VeADK 版本，可选值：`preview`（主分支）、`latest`（最新稳定版）、`x.x.x`（具体版本号） | 当前版本号                           |
| `--github-token`          | Github Token，用于管理项目                                                             | 必填                                 |
| `--volcengine-access-key` | 火山引擎 Access Key                                                                    | 使用环境变量 `VOLCENGINE_ACCESS_KEY` |
| `--volcengine-secret-key` | 火山引擎 Secret Key                                                                    | 使用环境变量 `VOLCENGINE_SECRET_KEY` |
| `--region`                | 火山引擎产品区域 cn-beijing                                                            |                                      |
| `--cr-instance-name`      | 火山引擎容器镜像仓库实例名                                                             | `veadk-user-instance`                |
| `--cr-namespace-name`     | 火山引擎容器镜像仓库命名空间                                                           | `veadk-user-namespace`               |
| `--cr-repo-name`          | 火山引擎容器镜像仓库 Repo 名称                                                         | veadk-user-repo                      |
| `--vefaas-function-id`    | 火山引擎 FaaS 函数 ID（要求为镜像函数），如未设置，将自动创建新函数                    | -                                    |

若您希望生成一个标准的 AgentKit 项目，您可以在命令行使用：

```bash
veadk agentkit init
```

或

```bash
agentkit init
```

生成后，您可以在项目根目录下使用 `veadk agentkit launch` 或 `agentkit launch` 进行项目部署。

其它详细步骤与说明可见[部署到 AgentKit 平台](https://volcengine.github.io/agentkit-sdk-python/content/2.agentkit-cli/1.overview.html#%E4%B8%89%E7%A7%8D%E9%83%A8%E7%BD%B2%E6%A8%A1%E5%BC%8F)

## 评测的一般流程

```
flowchart LR;
    subgraph "评测输入";
        A["评测用例<br/> - 用户输入 (User Input) <br/> - 预期轨迹 (Expected Trajectory)"];
    end;
    subgraph "Agent 执行";
        B("Agent");
    end;
    subgraph "Agent 输出";
        C["实际轨迹 (Actual Trajectory)"];
        D["最终响应 (Final Response)"];
    end;
    subgraph "评估";
        E{"评估器 (Evaluator)"};
        F["评测结果 (Evaluation Result)"];
    end;
    A -- "用户输入" --> B;
    B --> C;
    B --> D;
    A -- "预期轨迹" --> E;
    C -- "实际轨迹" --> E;
    E --> F;
```

在传统的软件开发中，单元测试和集成测试可以确保代码按预期运行，并在变更中保持稳定。然而，LLM Agent 引入了一定程度的可变性，使得传统的测试方法不足以完全评估其性能。由于模型的概率性，确定性的“通过/失败”断言通常不适用于评估 Agent 性能。相反，我们需要对最终输出和 Agent 的轨迹（即为得出解决方案而采取的步骤序列）进行定性评估。

Agent 评测可以分为两个部分：

- **评估轨迹和工具使用**：分析 Agent 为达成解决方案所采取的步骤，包括其工具选择、策略以及方法的效率。
- **评估最终响应**：评估 Agent 最终输出的质量、相关性和正确性。

VeADK 提供了以下三种方式来评测您的 Agent：

1. **基于网页的用户界面（veadk web）** 通过基于网页的界面，以交互方式评测 Agent 。操作过程中可直接在网页上与 Agent 互动，实时观察其表现并进行评测。
1. **命令行界面（veadk eval）** 直接从命令行对现有的评测集文件运行评测。无需打开图形界面，通过输入命令即可快速执行评测操作，适合熟悉命令行的开发人员。
1. **编程方式（pytest）** 使用 pytest（Python 的一种测试框架）和测试文件，将评测集成到您的测试流程中。这种方式适合自动化测试场景，可与现有开发测试链路无缝衔接。

## 评测集

### 保存评测集

生成评测集文件主要有两种方式：通过 `veadk web` 网页界面交互式生成，或通过编程方式在代码中导出。

#### 使用 `veadk web` 网页界面

`veadk web` 提供了一个交互式用户界面，可用于评测 Agent、生成评测数据集以及详细检查 Agent 行为。

**启动 Web UI**

通过在终端运行以下命令来启动 Web 服务器：

```bash
veadk web
```

*注意：如果 `veadk` 命令不可用，请确保您已按照项目设置正确安装了依赖项，并激活了虚拟环境。*

**生成评测用例**

1. 在网页界面中，选择一个 Agent 并与其进行交互以创建会话。
1. 完成一次对话后，选择界面右侧的 `Eval` 标签页。
1. 您可以创建新的评测集或选择一个现有的评测集。
1. 点击 `Add current session` 按钮，当前会话（包含您的输入、Agent 的回复以及中间步骤）将被保存为该评测集中的一个新评测用例。
1. 保存后，评测集文件（如 `simple.evalset.json`）会自动在 Agent 所在的目录中创建或更新。

您还可以通过界面查看、编辑或删除已保存的评测用例，以优化您的测试场景。

#### 使用编程方式导出

除了使用`veadk web`，我们还可以在 Agent 运行结束后，通过调用 `runner.save_eval_set()` 方法将运行时数据导出为评测集文件。

```python
import asyncio
import uuid
from veadk import Agent, Runner
from veadk.memory.short_term_memory import ShortTermMemory
from veadk.tools.demo_tools import get_city_weather

agent = Agent(tools=[get_city_weather])
session_id = "session_id_" + uuid.uuid4().hex
runner = Runner(agent=agent, short_term_memory=ShortTermMemory())
prompt = "How is the weather like in Beijing? Besides, tell me which tool you invoked."
asyncio.run(runner.run(messages=prompt, session_id=session_id))
# 运行时数据采集
dump_path = asyncio.run(runner.save_eval_set(session_id=session_id))
print(f"Evaluation file path: {dump_path}")
```

### 评测集格式

评测集采用 Google ADK 的评测集格式，为一个 JSON 文件。在 Agent 对用户做出回应之前，它通常会执行一系列操作，我们称之为“轨迹”（trajectory）。评估 Agent 的性能需要将其**实际轨迹**与**预期轨迹**（我们期望 Agent 应该采取的步骤列表）进行比较。这种比较可以揭示 Agent 流程中的错误和低效之处。

以下是一个简单的评测集示例，其中 `intermediate_data` 对应了 Agent 的实际轨迹：

```json
{
  "eval_set_id": "simple",
  "name": "simple",
  "description": null,
  "eval_cases": [
    {
      "eval_id": "product-price",
      "conversation": [
        {
          "invocation_id": "e-f25f5edb-f75b-4aa6-ab9b-657c4b436a12",
          "user_content": {
            "parts": [
              {
                "text": "Price"
              }
            ],
            "role": "user"
          },
          "final_response": {
            "parts": [
              {
                "text": "According to our knowledge base, we have the price information for the following products:\n\n- Model A sells for: $100\n- Model B sells for: $200  \n- Model C sells for: $300\n\nWhich specific product's price information would you like to know? Or do you have other questions about the price?"
              }
            ]
          },
          "intermediate_data": {
            "tool_uses": [
              {
                "id": "call_u6mzq918tz8nbxfp3lehhtme",
                "args": {
                  "question": "Price"
                },
                "name": "knowledge_base"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

主要的字段包括：

- `eval_set_id`: 评测集的唯一标识符。
- `name`: 评测集的名称。
- `description`: 评测集的描述。
- `eval_cases`: 一个包含多个评测用例的数组。
  - `eval_id`: 评测用例的唯一标识符。
  - `conversation`: 一个包含对话历史的数组。
    - `user_content`: 用户输入的内容。
    - `final_response`: Agent 的最终回复。
    - `intermediate_data`: Agent 在生成最终回复过程中的中间步骤，例如工具调用。在评测时，ADK 会将其与您定义的**预期轨迹**进行比较。

ADK 支持多种基于基准真相的轨迹评估方法：

- **Exact match**：要求与理想轨迹完全匹配。
- **In-order match**：要求按正确的顺序执行正确的操作，但允许额外的操作。
- **Any-order match**：要求执行正确的操作，顺序不限，也允许额外的操作。
- **Precision**：衡量预测操作的相关性/正确性。
- **Recall**：衡量预测中捕获了多少必要的操作。
- **Single-tool use**：检查是否包含了特定的操作。

### 评测集上传到 CozeLoop 平台

**为什么要使用 CozeLoop？**

虽然您可以在本地生成和管理评测集，但将它们上传到 [CozeLoop](https://loop.coze.cn/open/docs/guides/prepare_evaluation_dataset) 平台（一个为 LLM 应用提供可观测性、分析和监控的平台）可以带来诸多好处：

- **集中管理**：在一个统一的平台上存储、管理和追踪所有的评测数据和历史记录，方便团队协作和版本控制。
- **可视化分析**：提供丰富的可视化工具，帮助您更直观地分析 Agent 的行为、比较不同版本的性能差异。
- **深入洞察**：通过分析评测数据，深入了解 Agent 的工具调用轨迹、响应质量和潜在问题，从而获得优化方向。
- **持续监控**：将评测与持续集成（CI）流程相结合，实现对 Agent 性能的自动化监控和回归测试。

通过 `veadk uploadevalset` 命令，您可以轻松地将本地的评测集文件上传到 CozeLoop 平台。

**用法**

```bash
veadk uploadevalset [OPTIONS]
```

**说明**

该命令将 Google ADK 格式的评测数据集从 JSON 文件上传到 CozeLoop 平台，用于 Agent 评测和测试。

**参数**

- `--file TEXT`: 包含数据集的 JSON 文件的路径 [必需]
- `--cozeloop-workspace-id TEXT`: 用于组织评测集的 CozeLoop 工作区 ID。如果未提供，则使用 `OBSERVABILITY_OPENTELEMETRY_COZELOOP_SERVICE_NAME` 环境变量。
- `--cozeloop-evalset-id TEXT`: 将要上传到的特定评测集 ID。如果未提供，则使用 `OBSERVABILITY_OPENTELEMETRY_COZELOOP_EVALSET_ID` 环境变量。
- `--cozeloop-api-key TEXT`: 用于向 CozeLoop 服务进行身份验证的 API 密钥。如果未提供，则使用 `OBSERVABILITY_OPENTELEMETRY_COZELOOP_API_KEY` 环境变量。
- `--help`: 显示帮助信息并退出。

## 评估器

VeADK 目前支持 [DeepEval](https://deepeval.com/) 和 [ADKEval](https://google.github.io/adk-docs/evaluate/) 两种评测器。

### Google ADK 评估器

ADK 是 Agent Development Kit（由 Google 推出）用于构建代理（agent）或多代理系统的平台。它内置了评估机制，用于衡量“agent”在执行任务、调用工具、步骤轨迹等方面的表现。

**推荐使用场景**

- 如果您的系统是一个 agent（或多agent）系统：例如用户的问题可能触发多个工具调用、多个子步骤、agent 需要判断、切换工具、执行任务、然后给出最终输出。
- 如果您要追踪不仅“最终回答”，还要追踪“中间工具调用”、“agent使用了哪些子agent”、“执行轨迹是否符合预期”。例如：任务规划、执行、反馈循环、业务流程自动化。

**示例**

以下是一个使用 `ADKEvaluator` 的 pytest 测试用例示例：

```python
from veadk.evaluation.adk_evaluator import ADKEvaluator
import pytest
from ecommerce_agent.agent import root_agent

class TestAgentEvaluation:

    @pytest.mark.asyncio
    async def test_simple_evalset_with_adkevaluator(self):
        """Agent evaluation tests using ADKEvaluator"""
        evaluator = ADKEvaluator(agent=root_agent)
        await evaluator.evaluate(
            eval_set_file_path="tests/simple.test.json",
            response_match_score_threshold=1,
            tool_score_threshold=0.5,
            num_runs=1,
            print_detailed_results=True
        )
```

### DeepEval 评估器

DeepEval 是一个开源的 LLM（大语言模型）评估框架，专注于“LLM 输出”（包括 RAG、聊天机器人、生成任务等）质量的自动化评估。

**推荐使用场景**

- 如果您的系统主要是 “LLM → 输出” 型，比如：用户提问 → 模型回答；或者 RAG (检索 + 生成) 系统，注重回答的相关性、事实正确性、连贯性、可解释性，而不太依赖工具调用或复杂的代理轨迹，希望专注于 “生成质量” 监控。
- 如果您希望引入比较丰富的指标（如 hallucination 检测、contextual recall／precision、answer relevancy等），并希望把评估作为 CI/CD流程的一部分（像单元测试那样）运行。

**示例**

以下是一个使用 `DeepevalEvaluator` 的 pytest 测试用例示例：

```python
from veadk.evaluation.deepeval_evaluator import DeepevalEvaluator
from veadk.prompts.prompt_evaluator import eval_principle_prompt
from deepeval.metrics import GEval, ToolCorrectnessMetric
from deepeval.test_case import LLMTestCaseParams
import pytest
from ecommerce_agent.agent import root_agent

class TestAgentEvaluation:
    @pytest.mark.asyncio
    async def test_simple_evalset_with_deepevalevaluator(self):
        """Agent evaluation tests using DeepevalEvaluator"""
        evaluator = DeepevalEvaluator(agent=root_agent)
        metrics = [
            GEval(
                threshold=0.8,
                name="Base Evaluation",
                criteria=eval_principle_prompt,
                evaluation_params=[
                    LLMTestCaseParams.INPUT,
                    LLMTestCaseParams.ACTUAL_OUTPUT,
                    LLMTestCaseParams.EXPECTED_OUTPUT,
                ],
                model=evaluator.judge_model,
            ),
            ToolCorrectnessMetric(threshold=0.5, model=evaluator.judge_model),
        ]
        await evaluator.evaluate(
            eval_set_file_path="tests/simple.test.json", 
            metrics=metrics)
```

### 自定义您的评估器

当内置的 `ADKEvaluator` 和 `DeepevalEvaluator` 无法满足您的特定需求时，VeADK 允许您通过继承 `BaseEvaluator` 类来创建自己的评估器。

**核心场景**

1. **集成内部评估服务**：连接公司自有的评分 API。
1. **验证外部系统状态**：检查数据库、API 或硬件的状态是否被正确修改（例如，电商下单、IoT 设备控制）。
1. **评估非文本输出**：对生成的代码、图像或配置文件进行编译、运行或校验。
1. **实现特殊指标**：计算成本、测试安全性或检查多轮对话的一致性。

**核心步骤**

1. **定义评估器类**：创建一个继承自 `veadk.evaluation.base_evaluator.BaseEvaluator` 的类。
1. **实现 `evaluate` 方法**：在方法中，您可以：
   - 调用 `self.build_eval_set()` 加载测试用例。
   - 调用 `await self.generate_actual_outputs()` 运行 Agent 获取实际输出。
   - 实现自定义的评分逻辑，并将结果存入 `self.result_list`。

**示例**

```python
from typing import Optional
from google.adk.evaluation.eval_set import EvalSet
from typing_extensions import override
from veadk.evaluation.base_evaluator import BaseEvaluator, EvalResultData, MetricResult

class MyCustomEvaluator(BaseEvaluator):
    @override
    async def evaluate(
        self,
        eval_set: Optional[EvalSet] = None,
        eval_set_file_path: Optional[str] = None,
    ):
        # 步骤 1: 加载测试用例
        self.build_eval_set(eval_set, eval_set_file_path)

        # 步骤 2: 运行 agent 获取实际输出
        await self.generate_actual_outputs()

        # 步骤 3: 实现您的评分逻辑
        for eval_case_data in self.invocation_list:
            # 示例：检查输出是否与预期匹配
            score = 1.0 if eval_case_data.invocations[0].actual_output == eval_case_data.invocations[0].expected_output else 0.0
            metric_result = MetricResult(
                metric_type="ExactMatch",
                success=score == 1.0,
                score=score,
                reason=f"Outputs {'matched' if score == 1.0 else 'did not match'}.",
            )
            eval_result_data = EvalResultData(metric_results=[metric_result])
            eval_result_data.call_before_append()
            self.result_list.append(eval_result_data)

        return self.result_list
```

通过继承 `BaseEvaluator`，您可以专注于实现核心评估逻辑，同时复用 VeADK 的数据加载和 Agent 执行能力，从而灵活地扩展评估框架。

## Prompt 优解

Prompt（提示词）作为大模型的核心输入指令，直接影响模型的理解准确性和输出质量。优质的 Prompt 能显著提升大语言模型处理复杂任务的能力。

[PromptPilot](https://www.volcengine.com/docs/82379/1399495?lang=zh) 提供全流程智能优化，涵盖生成、调优、评估和管理全阶段。

### 调用方法

```shell
veadk prompt
```

选项包括：

```shell
--path：指定要优化的 Agent 文件路径，默认值为当前目录下 agent.py。注意，必须将定义的智能体作为全局变量导出
--feedback：指定优化后的提示词反馈，用于优化模型
--api-key：指定 AgentPilot 平台的 API Key，用于调用优化模型
--model-name：指定优化模型的名称
```

## 强化学习

在对效果与泛化能力要求高的复杂业务场景中，强化学习（RL）相比 PE、SFT、DPO 等方式上限更高，更贴合业务核心诉求：

- 基于反馈迭代的训练模式，更好激发模型推理与泛化能力；
- 无需大量标注数据，成本更低、实现更简单；
- 支持按业务指标反馈打分优化，可直接驱动指标提升。

针对上述问题与需求，VeADK 提供了内置的强化学习解决方案，包括：

- 基于 [方舟平台强化学习](https://www.volcengine.com/docs/82379/1099460) 的解决方案
- 基于 [Agent Lightning](https://github.com/microsoft/agent-lightning) 的解决方案

### 基于方舟平台强化学习

方舟 RL 将强化学习过程进行了一定程度的封装，降低了复杂度。用户主要关注 rollout 中的 agent 逻辑、奖励函数的构建、训练样本的选择即可。

VeADK 与方舟平台 Agent RL 集成，用户使用 VeADK 提供的脚手架，可以开发 VeADK Agent，然后提交任务到方舟平台进行强化学习优化。

#### 准备工作

在你的终端中运行以下命令，初始化一个强化学习项目：

```bash
veadk rl init --platform ark --workspace veadk_rl_ark_project
```

该命令会在当前目录下创建一个名为 `veadk_rl_ark_project` 的文件夹，其中包含了一个基本的强化学习项目结构。 然后在终端中运行以下命令，提交任务到方舟平台：

```bash
cd veadk_rl_ark_project
veadk rl submit --platform ark
```

#### 原理说明

生成后的项目结构如下，其中核心文件包括：

- 数据集: `data/*.jsonl`
- `/plugins`文件夹下的rollout和reward:
- rollout ：用以规定agent的工作流，`raw_async_veadk_rollout.py`提供了使用在方舟rl中使用veadk agent的示例，
- reward：给出强化学习所需的奖励值，在`random_reward.py`给出了示例
- `job.py`或`job.yaml`：用以配置训练参数，并指定需要使用的rollout和reward

```shell
veadk_rl_ark_project
├── data
    ├── *.jsonl # 训练数据
└── plugins
    ├── async_weather_rollout.py # 
    ├── config.yaml.example # VeADK agent 配置信息示例
    ├── random_reward.py # reward规则设定
    ├── raw_async_veadk_rollout.py # rollout工作流设定
    ├── raw_rollout.py # 
    └── test_utils.py #
    └── weather_rollout.py # 
├── job.py # 任务提交代码
├── job.yaml # 任务配置
├── test_agent.py # VeFaaS 测试脚本
```

#### 最佳实践案例

1. 脚手架中，基于 VeADK 的天气查询 Agent 进行强化学习优化

1. 提交任务 (veadk rl submit --platform ark)

1. 查看训练日志和时间线

### Agent Lightning

Agent Lightning 提供了灵活且可扩展的框架，实现了智能体（client）和训练（server）的完全解耦。 VeADK 与 Agent Lightning 集成，用户使用 VeADK 提供的脚手架，可以开发 VeADK Agent，然后运行 client 与 server 进行强化学习优化。

#### 准备工作

在你的终端中运行以下命令，初始化一个 Agent Lightning 项目：

```bash
veadk rl init --platform lightning --workspace veadk_rl_lightning_project
```

该命令会在当前目录下创建一个名为 `veadk_rl_lightning_project` 的文件夹，其中包含了一个基本的基于 VeADK 和 Agent Lightning 的强化学习项目结构。 然后在终端1中运行以下命令，启动 client：

```bash
cd veadk_rl_lightning_project
python veadk_agent.py
```

然后在终端2中运行以下命令

- 首先重启 ray 集群：

```bash
cd veadk_rl_lightning_project
bash restart_ray.sh
```

- 启动 server：

```bash
cd veadk_rl_lightning_project
bash train.sh
```

#### 原理说明

生成后的项目结构如下，其中核心文件包括：

- agent_client: `*_agent.py` 中定义了agent的rollout逻辑和reward规则
- training_server: `train.sh` 定义了训练相关参数,用于启动训练服务器

```shell
veadk_rl_lightning_project
├── data 
    ├── demo_train.parquet # 训练数据,必须为 parquet 格式
    ├── demo_test.parquet # 测试数据,必须为 parquet 格式
└── demo_calculate_agent.py # agent的rollout逻辑和reward设定
└── train.sh # 训练服务器启动脚本,设定训练相关参数 
└── restart_ray.sh # 重启 ray 集群脚本
```

#### 最佳实践案例

1. 脚手架中，基于 VeADK 的算术 Agent 进行强化学习优化
1. 启动 client (python demo_calculate_agent.py), 重启ray集群(bash restart_ray.sh), 最后启动训练服务器server (bash train.sh)，分别在终端1与终端2中运行以上命令

## Agent 自我反思

VeADK 中支持基于 Tracing 文件数据，通过第三方 Agent 推理来进行自我反思，生成优化后的系统提示词。

### 使用方法

您可以在适宜的时机将 Agent 推理得到的 Tracing 文件数据，提交到 `reflector` 进行自我反思，如下代码：

```python
import asyncio

from veadk import Agent, Runner
from veadk.reflector.local_reflector import LocalReflector
from veadk.tracing.telemetry.opentelemetry_tracer import OpentelemetryTracer

agent = Agent(tracers=[OpentelemetryTracer()])
reflector = LocalReflector(agent=agent)

app_name = "app"
user_id = "user"
session_id = "session"


async def main():
    runner = Runner(agent=agent, app_name=app_name)

    await runner.run(
        messages="你好，我觉得你的回答不够礼貌",
        user_id=user_id,
        session_id=session_id,
    )

    trace_file = runner.save_tracing_file(session_id=session_id)

    response = await reflector.reflect(
        trace_file=trace_file
    )
    print(response)


if __name__ == "__main__":
    asyncio.run(main())
```

### 结果说明

原始提示词：

```text
You an AI agent created by the VeADK team.

You excel at the following tasks:
1. Data science
- Information gathering and fact-checking
- Data processing and analysis
2. Documentation
- Writing multi-chapter articles and in-depth research reports
3. Coding & Programming
- Creating websites, applications, and tools
- Solve problems and bugs in code (e.g., Python, JavaScript, SQL, ...)
- If necessary, using programming to solve various problems beyond development
4. If user gives you tools, finish various tasks that can be accomplished using tools and available resources
```

优化后，您将看到类似如下的输出：

```text
optimized_prompt='You are an AI agent created by the VeADK team. Your core mission is to assist users with expertise in data science, documentation, and coding, while maintaining a warm, respectful, and engaging communication style.\n\nYou excel at the following tasks:\n1. Data science\n- Information gathering and fact-checking\n- Data processing and analysis\n2. Documentation\n- Writing multi-chapter articles and in-depth research reports\n3. Coding & Programming\n- Creating websites, applications, and tools\n- Solving problems and bugs in code (e.g., Python, JavaScript, SQL, ...)\n- Using programming to solve various problems beyond development\n4. Tool usage\n- Effectively using provided tools and available resources to accomplish tasks\n\nCommunication Guidelines:\n- Always use polite and warm language (e.g., appropriate honorifics, friendly tone)\n- Show appreciation for user feedback and suggestions\n- Proactively confirm user needs and preferences\n- Maintain a helpful and encouraging attitude throughout interactions\n\nYour responses should be both technically accurate and conversationally pleasant, ensuring users feel valued and supported.' 

reason="The trace shows a user complaint about the agent's lack of politeness in responses. The agent's current system prompt focuses exclusively on technical capabilities without addressing communication style. The optimized prompt adds explicit communication guidelines to ensure the agent maintains a warm, respectful tone while preserving all technical capabilities. This addresses the user's feedback directly while maintaining the agent's core functionality."
```

输出分为两部分：

- `optimized_prompt`: 优化后的系统提示词
- `reason`: 优化原因
