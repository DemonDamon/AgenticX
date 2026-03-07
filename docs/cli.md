# AgenticX CLI 使用指南

AgenticX 提供了功能完整的命令行工具 `agx`，涵盖项目创建、智能体管理、工作流编排、部署、监控、文档解析等全流程操作。

## 目录

- [🚀 5分钟快速开始](#-5分钟快速开始)
- [📦 安装与配置](#-安装与配置)
- [📋 命令概览](#-命令概览)
- [🛠️ 全局命令](#️-全局命令)
  - [version](#version)
  - [serve](#serve)
  - [run](#run)
  - [validate](#validate)
  - [test](#test)
- [🎯 project — 项目管理](#-project--项目管理)
- [🤖 agent — 智能体管理](#-agent--智能体管理)
- [🔄 workflow — 工作流管理](#-workflow--工作流管理)
- [📤 deploy — 部署](#-deploy--部署)
- [📊 monitor — 监控](#-monitor--监控)
- [📚 docs — 文档生成](#-docs--文档生成)
- [📖 mineru — 文档解析](#-mineru--文档解析)
- [🔧 tools — 工具集合](#-tools--工具集合)
- [⚡ skills — 技能注册中心](#-skills--技能注册中心)
- [🪝 hooks — 钩子管理](#-hooks--钩子管理)
- [🌋 volcengine — 火山引擎](#-volcengine--火山引擎)
- [🤖 AI 驱动代码生成](#-ai-驱动代码生成)
  - [agx config — 配置 LLM](#agx-config--配置-llm)
  - [agx generate — 一次性生成](#agx-generate--一次性生成)
  - [agx studio — 交互式多轮对话](#agx-studio--交互式多轮对话)
  - [多模态：图片驱动生成](#多模态图片驱动生成)
- [📝 完整示例](#-完整示例)

## 🚀 5分钟快速开始

### 1. 安装

```bash
# 安装核心包
pip install -e .

# 验证安装
agx --version
```

### 2. 创建你的第一个项目

```bash
# 创建基础项目
agx project create my-first-agent --template basic

# 进入项目目录
cd my-first-agent

# 查看项目信息
agx project info
```

### 3. 添加智能体

```bash
# 创建一个研究员智能体
agx agent create researcher --role "Senior Research Analyst"

# 查看已创建的智能体
agx agent list
```

### 4. 创建并运行工作流

```bash
# 创建工作流
agx workflow create research-pipeline --agents "researcher"

# 运行工作流
agx run workflows/research-pipeline.py --verbose
```

### 5. 探索更多功能

```bash
# 查看所有可用命令
agx --help

# 查看已安装的技能
agx skills list

# 查看钩子状态
agx hooks list
```

## 📦 安装与配置

## 📦 安装与配置

### 核心安装

```bash
# 安装核心包（包含 CLI 和基础功能）
pip install agenticx

# 或从源码安装（开发模式）
pip install -e .
```

### 可选依赖

根据需要安装额外功能：

| 依赖组 | 包含功能 | 安装命令 |
|--------|---------|---------|
| `server` | API 服务器 (`agx serve`) | `pip install "agenticx[server]"` |
| `document` | 文档解析 (`agx mineru`) | `pip install "agenticx[document]"` |
| `volcengine` | 火山引擎集成 | `pip install "agenticx[volcengine]"` |
| `all` | 全部功能 | `pip install "agenticx[all]"` |

### 验证安装

```bash
# 查看版本
agx --version
# 或
agx version

# 查看帮助
agx --help
```

### CLI 交互体验（v0.3.0+）

从 v0.3.0 开始，`agx` 的默认交互做了三项增强：

1. **无参直达引导**：直接输入 `agx` 会显示欢迎页和常用命令，不再报 `Missing command`。
2. **未知命令纠错**：输入拼写错误命令时（如 `agx wokflow`），会提示最接近的可用命令（如 `workflow`）。
3. **启动速度优化**：CLI 启动链路改为轻量版本导入 + 惰性加载，`agx` 与 `agx --help` 的响应速度显著提升。

示例：

```bash
# 无参显示快速引导
agx

# 拼写纠错提示
agx wokflow
# 提示：你是不是想输入 'workflow'
```

## 📋 命令概览

```
agx
├── version              # 显示版本信息
├── serve                # 启动 API 服务器 (需要 [server])
├── run                  # 执行工作流文件
├── validate             # 验证配置文件
├── test                 # 运行测试套件
│
├── project              # 项目管理
│   ├── create           # 创建新项目
│   └── info             # 显示项目信息
│
├── agent                # 智能体管理
│   ├── create           # 创建智能体
│   └── list             # 列出所有智能体
│
├── workflow             # 工作流管理
│   ├── create           # 创建工作流
│   └── list             # 列出所有工作流
│
├── deploy               # 部署
│   ├── prepare          # 准备部署包
│   ├── docker           # Docker 部署
│   └── k8s              # Kubernetes 部署
│
├── monitor              # 监控
│   ├── start            # 启动监控服务
│   └── status           # 查看监控状态
│
├── docs                 # 文档生成
│   ├── generate         # 生成文档
│   └── serve            # 启动文档服务器
│
├── mineru               # 文档解析（PDF/PPT/DOC等，需要 [document]）
│   ├── parse            # 解析单个或多个文档
│   ├── batch            # 批量处理目录中的文档
│   └── languages        # 查看支持的 OCR 语言
│
├── tools                # 工具集合
│   └── ...              # MinerU 适配器相关工具
│
├── skills               # 技能注册中心
│   ├── list             # 列出技能
│   ├── search           # 搜索技能
│   ├── install          # 安装技能
│   ├── uninstall        # 卸载技能
│   ├── publish          # 发布技能
│   └── serve            # 启动技能注册服务
│
├── hooks                # 钩子管理
│   ├── list             # 列出可用钩子
│   ├── info             # 查看钩子详细信息
│   ├── check            # 检查钩子状态
│   ├── enable           # 启用钩子
│   ├── disable          # 禁用钩子
│   └── load             # 加载钩子处理器
│
└── volcengine           # 火山引擎 AgentKit 集成 (需要 [volcengine])
    ├── init             # 初始化 AgentKit 项目
    ├── config           # 配置部署凭证
    ├── deploy           # 部署智能体
    ├── invoke           # 调用已部署的智能体
    ├── status           # 查看部署状态
    ├── destroy          # 销毁部署
    └── info             # 显示集成信息
```

> 💡 **提示**: 标有 `[xxx]` 的命令需要安装额外依赖，见下方"安装与配置"部分。

## 🛠️ 全局命令

### version

显示当前安装的 AgenticX 版本。

```bash
agx version
# 输出: AgenticX 0.3.0

agx --version
# 输出: AgenticX 0.3.0
```

### serve

启动 AgenticX API 服务器，含生产级中间件与健康探针。

```bash
agx serve [OPTIONS]
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--port` | `-p` | INTEGER | `8000` | 监听端口 |
| `--host` | | TEXT | `0.0.0.0` | 监听地址 |
| `--reload` | | FLAG | `False` | 开发模式热重载 |

**示例：**

```bash
# 默认启动（0.0.0.0:8000）
agx serve

# 指定端口和地址
agx serve --port 9000 --host 127.0.0.1

# 开发模式（文件修改自动重载）
agx serve --port 8000 --reload
```

启动后可访问以下端点：

- `GET /health` — 综合健康检查
- `GET /health/live` — 存活探针
- `GET /health/ready` — 就绪探针
- `POST /tasks/submit` — 提交任务
- `POST /api/login` — 登录

> 需要依赖：`pip install "agenticx[server]"`

### run

执行工作流文件。

```bash
agx run [OPTIONS] FILE
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--config` | `-c` | TEXT | — | 配置文件路径 |
| `--verbose` | `-v` | FLAG | `False` | 详细输出 |
| `--debug` | `-d` | FLAG | `False` | 调试模式 |

**示例：**

```bash
# 执行工作流文件
agx run my_workflow.py

# 指定配置文件并开启详细输出
agx run my_workflow.py --config config.yaml --verbose

# 调试模式
agx run my_workflow.py --debug
```

### validate

验证配置文件格式是否正确。

```bash
agx validate [OPTIONS] CONFIG
```

| 选项 | 简写 | 类型 | 说明 |
|------|------|------|------|
| `--schema` | `-s` | TEXT | 指定验证模式文件 |

**示例：**

```bash
# 验证配置文件
agx validate config.yaml

# 使用自定义 schema 验证
agx validate config.yaml --schema my_schema.json
```

### test

运行测试套件。

```bash
agx test [OPTIONS] [SUITE]
```

| 选项 | 简写 | 类型 | 说明 |
|------|------|------|------|
| `--pattern` | `-p` | TEXT | 测试文件匹配模式 |
| `--verbose` | `-v` | FLAG | 详细输出 |

**示例：**

```bash
# 运行所有测试
agx test

# 运行指定测试套件
agx test my_test_suite

# 通过文件名匹配模式运行
agx test --pattern "test_agent_*.py" --verbose
```

## 🎯 project — 项目管理

### project create

创建新的 AgenticX 项目，自动生成标准目录结构和配置文件。

```bash
agx project create [OPTIONS] NAME
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--template` | `-t` | TEXT | `basic` | 项目模板 |
| `--dir` | `-d` | TEXT | — | 项目目录（默认当前目录） |

**可用模板：**

| 模板名 | 说明 |
|--------|------|
| `basic` | 基础单智能体项目 |
| `basic_stream` | 流式输出智能体项目 |
| `a2a` | Agent-to-Agent 多智能体通信 |
| `mcp` | MCP 协议集成项目 |
| `knowledge` | 知识库 RAG 项目 |

**示例：**

```bash
# 创建基础项目
agx project create my-agent

# 指定模板创建
agx project create my-agent --template a2a

# 指定目录
agx project create my-agent --template knowledge --dir /path/to/projects
```

创建后的项目结构（以 `basic` 模板为例）：

```
my-agent/
├── config.yaml        # 项目配置
├── agents/
│   └── agent.py       # 智能体定义
├── workflows/
│   └── main.py        # 工作流定义
├── tools/             # 自定义工具
└── requirements.txt   # 依赖文件
```

### project info

显示当前目录的 AgenticX 项目信息。

```bash
agx project info
```

> 需要在包含 `config.yaml` 的项目目录中运行。

## 🤖 agent — 智能体管理

### agent create

创建新的智能体文件。

```bash
agx agent create [OPTIONS] NAME
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--role` | `-r` | TEXT | `Assistant` | 智能体角色 |
| `--template` | `-t` | TEXT | `basic` | 智能体模板 |
| `--interactive` | `-i` | FLAG | `False` | 交互式创建（引导式配置） |

**示例：**

```bash
# 创建基础智能体
agx agent create researcher

# 指定角色
agx agent create researcher --role "Research Analyst"

# 交互式创建（逐步引导配置）
agx agent create my-agent --interactive
```

### agent list

列出当前项目中已定义的所有智能体。

```bash
agx agent list
```

输出示例：

```
智能体ID    名称          角色              状态
--------    --------      --------          --------
agent-001   researcher    Research Analyst  active
agent-002   writer        Content Writer    active
```

## 🔄 workflow — 工作流管理

### workflow create

创建新的工作流文件。

```bash
agx workflow create [OPTIONS] NAME
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--template` | `-t` | TEXT | `sequential` | 工作流模板 |
| `--agents` | `-a` | TEXT | — | 关联的智能体列表（逗号分隔） |
| `--interactive` | `-i` | FLAG | `False` | 交互式创建 |

**可用模板：**

| 模板名 | 说明 |
|--------|------|
| `sequential` | 顺序执行工作流 |
| `parallel` | 并行执行工作流 |
| `conditional` | 条件分支工作流 |

**示例：**

```bash
# 创建顺序工作流
agx workflow create research-pipeline

# 使用并行模板，并关联多个智能体
agx workflow create data-pipeline --template parallel --agents "agent1,agent2,agent3"

# 交互式创建
agx workflow create my-workflow --interactive
```

### workflow list

列出当前项目中的所有工作流。

```bash
agx workflow list
```

## 📤 deploy — 部署

### deploy prepare

准备部署包，生成所有必需的部署配置文件。

```bash
agx deploy prepare [OPTIONS] TARGET
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--platform` | `-p` | TEXT | `docker` | 部署平台（`docker` / `k8s`） |
| `--config` | `-c` | TEXT | — | 部署配置文件路径 |

**示例：**

```bash
# 准备 Docker 部署包
agx deploy prepare ./dist --platform docker

# 准备 Kubernetes 部署包
agx deploy prepare ./dist --platform k8s
```

### deploy docker

构建 Docker 镜像并可选推送到远程仓库。

```bash
agx deploy docker [OPTIONS] TARGET
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--tag` | `-t` | TEXT | `latest` | Docker 镜像标签 |
| `--push` | `-p` | FLAG | `False` | 是否推送到远程仓库 |

**示例：**

```bash
# 构建 Docker 镜像
agx deploy docker ./my-agent --tag v1.0.0

# 构建并推送
agx deploy docker ./my-agent --tag v1.0.0 --push
```

### deploy k8s

生成 Kubernetes 部署清单并可选直接应用到集群。

```bash
agx deploy k8s [OPTIONS] TARGET
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--namespace` | `-n` | TEXT | `default` | Kubernetes 命名空间 |
| `--apply` | `-a` | FLAG | `False` | 是否直接应用到集群 |

**示例：**

```bash
# 生成 Kubernetes 清单
agx deploy k8s ./my-agent --namespace production

# 直接部署到集群
agx deploy k8s ./my-agent --namespace production --apply
```

## 📊 monitor — 监控

### monitor start

启动实时监控服务。

```bash
agx monitor start [OPTIONS]
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--port` | `-p` | INTEGER | `8080` | 监控服务端口 |
| `--host` | `-h` | TEXT | `0.0.0.0` | 监控服务地址 |

**示例：**

```bash
agx monitor start
agx monitor start --port 9090 --host 127.0.0.1
```

### monitor status

查看监控服务当前状态。

```bash
agx monitor status
```

## 📚 docs — 文档生成

### docs generate

基于当前项目代码自动生成 API 文档。

```bash
agx docs generate [OPTIONS]
```

| 选项 | 简写 | 类型 | 说明 |
|------|------|------|------|
| `--output-dir` | `-o` | TEXT | 文档输出目录（默认 `./site`） |

**示例：**

```bash
# 生成文档到默认目录（./site）
agx docs generate

# 指定输出目录
agx docs generate --output-dir ./docs/site
```

### docs serve

启动本地文档服务器，在浏览器中预览文档。

```bash
agx docs serve [OPTIONS]
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--port` | `-p` | INTEGER | `8000` | 服务端口 |

**示例：**

```bash
agx docs serve
agx docs serve --port 8080
```

访问 `http://localhost:8000` 查看文档。

## 📖 mineru — 文档解析

MinerU 模块支持将 PDF、PPT、Word、图片等格式的文档解析为结构化的 Markdown 或 JSON 输出。

> 需要依赖：`pip install "agenticx[document]"`

### mineru parse

解析一个或多个文档文件。

```bash
agx mineru parse [OPTIONS] FILES...
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--output` | `-o` | TEXT | `./mineru_outputs` | 输出目录 |
| `--mode` | `-m` | TEXT | `local` | 解析模式：`local` / `remote_api` / `remote_mcp` |
| `--language` | `-l` | TEXT | `auto` | OCR 语言（如 `ch`、`en`） |
| `--backend` | `-b` | TEXT | `PIPELINE` | 后端类型：`PIPELINE` / `VLM_HTTP` |
| `--formula/--no-formula` | | FLAG | 启用 | 是否启用公式识别 |
| `--table/--no-table` | | FLAG | 启用 | 是否启用表格识别 |
| `--pages` | `-p` | TEXT | — | 页面范围，如 `1-5,10,15-20` |
| `--api-base` | | TEXT | — | 远程 API 基础 URL |
| `--api-token` | | TEXT | — | 远程 API 令牌 |
| `--config` | `-c` | TEXT | — | 配置文件路径 |
| `--verbose` | `-v` | FLAG | `False` | 详细输出 |

**示例：**

```bash
# 解析单个 PDF
agx mineru parse report.pdf

# 解析多个文件，指定输出目录
agx mineru parse doc1.pdf doc2.pdf --output ./parsed_docs

# 仅解析第 1-10 页，使用中文 OCR
agx mineru parse report.pdf --pages "1-10" --language ch

# 使用远程 API 解析
agx mineru parse report.pdf \
  --mode remote_api \
  --api-base https://api.example.com \
  --api-token YOUR_TOKEN

# 禁用公式和表格识别（速度更快）
agx mineru parse report.pdf --no-formula --no-table --verbose
```

### mineru batch

批量处理目录中符合条件的所有文档。

```bash
agx mineru batch [OPTIONS] INPUT_DIR
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--output` | `-o` | TEXT | `INPUT_DIR/mineru_batch_outputs` | 输出目录 |
| `--patterns` | | TEXT | `*.pdf,*.png,*.jpg,*.jpeg` | 文件匹配模式（逗号分隔） |
| `--mode` | `-m` | TEXT | `local` | 解析模式：`local` / `remote_api` |
| `--language` | `-l` | TEXT | `auto` | OCR 语言 |
| `--backend` | `-b` | TEXT | `PIPELINE` | 后端类型 |
| `--max-concurrent` | | INTEGER | `3` | 最大并发处理数 |
| `--formula/--no-formula` | | FLAG | 启用 | 公式识别 |
| `--table/--no-table` | | FLAG | 启用 | 表格识别 |
| `--config` | `-c` | TEXT | — | 配置文件路径 |
| `--verbose` | `-v` | FLAG | `False` | 详细输出 |

**示例：**

```bash
# 批量处理目录下所有 PDF
agx mineru batch ./documents

# 仅处理 PNG 图片，最大并发 5
agx mineru batch ./images --patterns "*.png" --max-concurrent 5

# 批量处理并输出到指定目录
agx mineru batch ./documents --output ./outputs --verbose
```

### mineru languages

查看当前解析模式支持的 OCR 语言列表。

```bash
agx mineru languages [OPTIONS]
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--mode` | `-m` | TEXT | `local` | 查询模式：`local` / `remote_api` |
| `--api-base` | | TEXT | — | 远程 API URL |
| `--api-token` | | TEXT | — | 远程 API 令牌 |

**示例：**

```bash
# 查看本地支持的语言
agx mineru languages

# 查看远程 API 支持的语言
agx mineru languages --mode remote_api --api-base https://api.example.com
```

## 🔧 tools — 工具集合

`tools` 子命令集合提供对各类工具的命令行访问，包括 MinerU 适配器操作。

```bash
agx tools --help
```

## ⚡ skills — 技能注册中心

技能注册中心支持管理和共享可复用的智能体技能包。

### skills list

列出本地技能，并尝试合并远程注册中心的索引。

```bash
agx skills list [OPTIONS]
```

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--registry-url` | TEXT | `http://127.0.0.1:8321` | 注册中心 URL |

**示例：**

```bash
# 列出本地技能
agx skills list

# 使用自定义注册中心
agx skills list --registry-url http://my-registry:8321
```

**输出示例：**

```
┏━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┓
┃ Name                  ┃ Description                               ┃ Location ┃
┡━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━┩
│ planning-with-files   │ Implements Manus-style file-based         │ global   │
│                       │ planning for complex tasks. Creates       │          │
│                       │ task_plan.md, findings.md, and            │          │
│                       │ progress.md. Use when starting complex    │          │
│                       │ multi-step tasks, research projects, or   │          │
│                       │ any task requiring >5 tool calls. Now     │          │
│                       │ with automatic session recovery after     │          │
│                       │ /clear.                                   │          │
│ dev-workflow-pipeline │ 在 AgenticX                               │ global   │
│                       │ 开发中涉及研究、代码生成、提交、审查或知… │          │
│ tech-blog-generator   │ 基于种子信息（关键词、URL、GitHub         │ global   │
│                       │ 仓库等）进行网络检索与资料爬取，然后生成… │          │
│                       │ when the user wants to research a         │          │
│                       │ technical topic and generate a blog post, │          │
│                       │ or mentions writing a tech blog, creating │          │
│                       │ technical content, or deep-diving into a  │          │
│                       │ technology topic.                         │          │
│ find-skills           │ Helps users discover and install agent    │ global   │
│                       │ skills when they ask questions like "how  │          │
│                       │ do I do X", "find a skill for X", "is     │          │
│                       │ there a skill that can...", or express    │          │
│                       │ interest in extending capabilities. This  │          │
│                       │ skill should be used when the user is     │          │
│                       │ looking for functionality that might      │          │
│                       │ exist as an installable skill.            │          │
│ canvas-design         │ Create beautiful visual art in .png and   │ global   │
│                       │ .pdf documents using design philosophy.   │          │
│                       │ You should use this skill when the user   │          │
│                       │ asks to create a poster, piece of art,    │          │
│                       │ design, or other static piece. Create     │          │
│                       │ original visual designs, never copying    │          │
│                       │ existing artists' work to avoid copyright │          │
│                       │ violations.                               │          │
│ prompt-enhancer       │ 专业提示词优化器。将用户的草稿提示词改进… │ global   │
│                       │ when the user wants to optimize, improve, │          │
│                       │ or refine a prompt, or mentions prompt    │          │
│                       │ engineering, prompt optimization, or asks │          │
│                       │ for better prompts.                       │          │
└───────────────────────┴───────────────────────────────────────────┴──────────┘
Total: 6 skill(s)
```

### skills search

搜索技能。

```bash
agx skills search [OPTIONS] QUERY
```

**示例：**

```bash
# 搜索技能
agx skills search "data analysis"

# 使用自定义注册中心搜索
agx skills search "web scraping" --registry-url http://my-registry:8321
```

### skills install

安装技能包到本地。

```bash
agx skills install [OPTIONS] NAME_OR_PATH
```

**示例：**

```bash
# 从注册中心安装
agx skills install web-scraper

# 从本地路径安装
agx skills install ./my-skill-bundle.zip
```

### skills uninstall

卸载已安装的技能。

```bash
agx skills uninstall SKILL_NAME
```

**示例：**

```bash
# 卸载技能
agx skills uninstall web-scraper
```

### skills publish

将本地技能发布到注册中心。

```bash
agx skills publish [OPTIONS] SKILL_PATH
```

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--registry-url` | TEXT | `http://127.0.0.1:8321` | 注册中心 URL |
| `--write-token` | TEXT | — | 发布用的写入令牌 |

**示例：**

```bash
# 发布技能
agx skills publish ./my-skill --registry-url http://my-registry:8321
```

### skills serve

启动本地技能注册服务器。

```bash
agx skills serve [OPTIONS]
```

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--port` | INTEGER | `8321` | 服务端口 |
| `--host` | TEXT | `127.0.0.1` | 服务地址 |
| `--storage-path` | PATH | — | 注册中心 JSON 存储路径 |
| `--write-token` | TEXT | — | 发布/删除 API 的写入令牌 |

**示例：**

```bash
# 启动本地技能注册服务
agx skills serve

# 自定义端口和地址
agx skills serve --port 9321 --host 0.0.0.0
```

## 🪝 hooks — 钩子管理

管理 AgenticX 的钩子系统，用于扩展和自定义框架行为。

### hooks list

列出工作区中可用的所有钩子。

```bash
agx hooks list [OPTIONS]
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--workspace` | `-w` | TEXT | 当前目录 | 工作区目录 |
| `--eligible` | | FLAG | `False` | 仅显示符合条件的钩子 |
| `--json` | | FLAG | `False` | 输出 JSON 格式 |

**示例：**

```bash
# 列出所有钩子
agx hooks list

# 仅显示符合条件的钩子
agx hooks list --eligible

# 指定工作区目录
agx hooks list --workspace ./my-project

# 输出 JSON 格式
agx hooks list --json
```

**输出示例：**

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┓
┃ Name                             ┃ Source   ┃ Events           ┃ Eligible ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━┩
│ user-prompt-submit              ┃ global   │ user_prompt     │ yes      │
│ session-start                    ┃ global   │ session_start   │ yes      │
│ pre-commit                       ┃ project  │ pre_commit      │ no       │
└──────────────────────────────────┴──────────┴──────────────────┴──────────┘
```

### hooks info

查看特定钩子的详细信息。

```bash
agx hooks info [OPTIONS] NAME
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--workspace` | `-w` | TEXT | 当前目录 | 工作区目录 |

**示例：**

```bash
# 查看钩子详细信息
agx hooks info user-prompt-submit

# 指定工作区
agx hooks info user-prompt-submit --workspace ./my-project
```

**输出示例：**

```json
{
  "name": "user-prompt-submit",
  "source": "global",
  "description": "在用户提交提示时触发",
  "events": ["user_prompt"],
  "eligible": true,
  "missing_requirements": [],
  "metadata_path": "/path/to/hook/metadata.json",
  "handler_path": "/path/to/hook/handler.py"
}
```

### hooks check

检查钩子的状态和依赖。

```bash
agx hooks check [OPTIONS]
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--workspace` | `-w` | TEXT | 当前目录 | 工作区目录 |

**示例：**

```bash
# 检查钩子状态
agx hooks check

# 指定工作区
agx hooks check --workspace ./my-project
```

**输出示例：**

```
Eligible hooks: 2/3
- pre-commit: ['missing dependency: git']
```

### hooks enable

启用指定的钩子。

```bash
agx hooks enable NAME
```

**示例：**

```bash
# 启用钩子
agx hooks enable user-prompt-submit
```

### hooks disable

禁用指定的钩子。

```bash
agx hooks disable NAME
```

**示例：**

```bash
# 禁用钩子
agx hooks disable user-prompt-submit
```

### hooks load

加载并初始化钩子处理器。

```bash
agx hooks load [OPTIONS]
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--workspace` | `-w` | TEXT | 当前目录 | 工作区目录 |

**示例：**

```bash
# 加载钩子
agx hooks load

# 指定工作区
agx hooks load --workspace ./my-project
```

## 🌋 volcengine — 火山引擎

提供火山引擎 AgentKit 平台的专项集成命令，支持将 AgenticX 智能体部署到火山引擎。

> 需要依赖：`pip install "agenticx[volcengine]"`

### volcengine init

从模板初始化一个新的 AgentKit 项目。

```bash
agx volcengine init [OPTIONS]
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--name` | `-n` | TEXT | **必填** | 项目名称 |
| `--template` | `-t` | TEXT | `basic` | 模板类型：`basic`, `basic_stream`, `a2a`, `mcp`, `knowledge` |
| `--dir` | `-d` | TEXT | `.` | 项目目录 |

**可用模板：**

| 模板名 | 说明 |
|--------|------|
| `basic` | 基础单智能体项目 |
| `basic_stream` | 流式输出智能体项目 |
| `a2a` | Agent-to-Agent 多智能体通信 |
| `mcp` | MCP 协议集成项目 |
| `knowledge` | 知识库 RAG 项目 |

**示例：**

```bash
# 创建基础项目
agx volcengine init --name my-agent

# 使用 A2A 模板
agx volcengine init --name my-multi-agent --template a2a

# 指定输出目录
agx volcengine init --name my-agent --template knowledge --dir ./projects
```

**生成的项目结构：**

```
my-agent/
├── agent.py           # 智能体定义
├── wrapper.py         # AgentKit 包装器
├── agentkit.yaml      # AgentKit 配置
├── Dockerfile         # Docker 部署文件
├── README.md          # 项目说明
└── requirements.txt   # 依赖文件
```

### volcengine config

配置 AgentKit 部署凭证。

```bash
agx volcengine config [OPTIONS]
```

| 选项 | 简写 | 类型 | 说明 |
|------|------|------|------|
| `--model` | `-m` | TEXT | 模型端点 ID (如 ep-xxxxx) |
| `--api-key` | `-k` | TEXT | 模型 API 密钥 |
| `--ak` | | TEXT | 火山引擎 Access Key |
| `--sk` | | TEXT | 火山引擎 Secret Key |
| `--show` | | FLAG | 显示当前配置 |

**示例：**

```bash
# 交互式配置
agx volcengine config

# 配置模型端点
agx volcengine config --model ep-xxxxx --api-key your-api-key

# 配置火山引擎凭证
agx volcengine config --ak your-access-key --sk your-secret-key

# 查看当前配置
agx volcengine config --show
```

**查看配置输出示例：**

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Configuration              ┃ Value                            ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ MODEL_AGENT_NAME           │ ep-xxxxx                        │
│ MODEL_AGENT_API_KEY        │ Set                              │
│ VOLCENGINE_ACCESS_KEY      │ Set                              │
│ VOLCENGINE_SECRET_KEY      │ Set                              │
└────────────────────────────┴──────────────────────────────────┘
```

### volcengine deploy

将 AgenticX 智能体部署到火山引擎 AgentKit。

```bash
agx volcengine deploy [OPTIONS]
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--module` | `-m` | TEXT | **必填** | 智能体 Python 模块路径 |
| `--var` | `-v` | TEXT | `agent` | 模块中的智能体变量名 |
| `--strategy` | `-s` | TEXT | `hybrid` | 部署策略：`local`, `hybrid`, `cloud` |
| `--stream` | | FLAG | `False` | 启用流式模式 |
| `--mode` | | TEXT | `simple` | 应用模式：`simple`, `mcp`, `a2a` |

**示例：**

```bash
# 部署智能体（从项目目录运行）
agx volcengine deploy --module agent

# 指定智能体变量名
agx volcengine deploy --module agent --var my_agent

# 使用 cloud 策略（无本地 Docker）
agx volcengine deploy --module agent --strategy cloud

# 启用流式输出
agx volcengine deploy --module agent --stream

# A2A 模式
agx volcengine deploy --module agent --mode a2a
```

### volcengine invoke

调用已部署的智能体。

```bash
agx volcengine invoke MESSAGE
```

**示例：**

```bash
# 发送消息给智能体
agx volcengine invoke "你好，请介绍一下自己"
```

### volcengine status

查看部署状态。

```bash
agx volcengine status
```

### volcengine destroy

销毁已部署的智能体并清理资源。

```bash
agx volcengine destroy [OPTIONS]
```

| 选项 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--yes` | `-y` | FLAG | `False` | 跳过确认 |

**示例：**

```bash
# 销毁部署（需要确认）
agx volcengine destroy

# 跳过确认直接销毁
agx volcengine destroy --yes
```

### volcengine info

显示 AgentKit 集成信息。

```bash
agx volcengine info
```

**输出示例：**

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━┓
┃ Component                                                ┃ Status              ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━┩
│ agentkit CLI                                            │ Installed           │
│ veadk                                                    │ v0.2.0             │
│ ArkLLMProvider                                          │ Available           │
│ MODEL_AGENT_NAME                                        │ ep-xxxxx           │
│ MODEL_AGENT_API_KEY                                     │ Set                 │
│ VOLCENGINE_ACCESS_KEY                                   │ Set                 │
└──────────────────────────────────────────────────────────┴─────────────────────┘
```

## 📝 完整示例

### 示例 1：从零创建并运行一个智能体项目

```bash
# 1. 创建新项目
agx project create my-research-agent --template basic

# 2. 进入项目目录
cd my-research-agent

# 3. 查看项目信息
agx project info

# 4. 创建一个研究员智能体
agx agent create researcher --role "Senior Research Analyst"

# 5. 创建工作流
agx workflow create research-pipeline --agents "researcher"

# 6. 运行工作流
agx run workflows/research-pipeline.py --verbose
```

### 示例 2：批量解析 PDF 文档并查看结果

```bash
# 1. 查看支持的语言
agx mineru languages

# 2. 批量解析文档目录
agx mineru batch ./my-documents \
  --output ./parsed \
  --language ch \
  --max-concurrent 4 \
  --verbose

# 3. 解析结果将保存在 ./parsed 目录
```

### 示例 3：部署到生产环境

```bash
# 1. 验证配置
agx validate config.yaml

# 2. 准备 Docker 部署包
agx deploy prepare ./dist --platform docker

# 3. 构建并推送镜像
agx deploy docker ./dist --tag v1.2.0 --push

# 4. 部署到 Kubernetes
agx deploy k8s ./dist --namespace production --apply

# 5. 启动监控
agx monitor start --port 8080
```

### 示例 4：启动 API 服务器并查看文档

```bash
# 1. 启动 API 服务器（开发模式）
agx serve --port 8000 --reload

# 2. 在另一个终端生成并预览文档
agx docs generate --output-dir ./site
agx docs serve --port 8080
```

## 🔧 环境变量

部分命令支持通过环境变量进行配置：

| 变量名 | 说明 |
|--------|------|
| `MINERU_API_KEY` | MinerU 远程 API 密钥 |
| `MINERU_BASE_URL` | MinerU 远程 API 基础 URL |
| `AGENTICX_CONFIG` | 全局配置文件路径 |
| `MODEL_AGENT_NAME` | 火山引擎模型端点 ID |
| `MODEL_AGENT_API_KEY` | 火山引擎模型 API 密钥 |
| `VOLCENGINE_ACCESS_KEY` | 火山引擎 Access Key |
| `VOLCENGINE_SECRET_KEY` | 火山引擎 Secret Key |

**示例：**

```bash
# MinerU 配置
export MINERU_API_KEY="your-api-key"
export MINERU_BASE_URL="https://api.mineru.net"
agx mineru parse report.pdf --mode remote_api

# 火山引擎配置
export MODEL_AGENT_NAME="ep-xxxxx"
export MODEL_AGENT_API_KEY="your-api-key"
export VOLCENGINE_ACCESS_KEY="your-access-key"
export VOLCENGINE_SECRET_KEY="your-secret-key"
```

## ❓ 常见问题

**Q: `agx` 命令找不到？**

```bash
# 确认安装成功
pip show agenticx
# 检查 PATH
which agx
```

**Q: `agx serve` 报错缺少依赖？**

```bash
pip install "agenticx[server]"
```

**Q: `agx mineru parse` 报错缺少依赖？**

```bash
pip install "agenticx[document]"
```

**Q: `agx volcengine` 命令不可用？**

```bash
pip install "agenticx[volcengine]"
```

**Q: 如何在 Python 代码中直接调用 CLI 逻辑？**

```python
from agenticx.cli import AgenticXClient

client = AgenticXClient(verbose=True)
result = client.run_workflow_file("my_workflow.py")
```

**Q: 钩子如何工作？我需要自己写钩子吗？**

钩子是 AgenticX 的扩展机制，用于在特定事件发生时执行自定义逻辑。通常钩子由框架或插件提供，你只需使用 `agx hooks list` 查看可用钩子，用 `agx hooks enable/disable` 来启用或禁用。

**Q: 火山引擎部署需要准备什么？**

1. 安装依赖：`pip install "agenticx[volcengine]"`
2. 在火山引擎控制台创建模型端点
3. 获取你的 Access Key 和 Secret Key
4. 运行 `agx volcengine config` 配置凭证
5. 使用 `agx volcengine init` 创建项目
6. 使用 `agx volcengine deploy` 部署

---

## 🤖 AI 驱动代码生成

> **一句话描述需求，agx 自动生成可运行的 Python 代码。** 支持 Agent / Workflow / Skill / Tool 四种产物，兼容 9 大主流 LLM 厂商。

---

### agx config — 配置 LLM

在使用 AI 生成功能之前，先配置你的 LLM API Key。

#### 交互式向导（推荐）

```bash
agx config init
```

向导会引导你完成以下步骤：

1. 选择 LLM 厂商（OpenAI / Anthropic / 智谱 / 火山引擎 / 阿里百炼 / 百度千帆 / Kimi / MiniMax / Ollama）
2. 输入 API Key
3. 选择默认模型
4. 验证连通性

示例输出：

```
🔧 AgenticX 配置向导

? 选择你的主要 LLM 厂商:
  ❯ 火山引擎 (豆包)

? 输入 ARK API Key: ••••••••••••••••

? 选择默认模型:
  ❯ doubao-seed-1-6

⏳ 验证连通性... ✅ 连接成功！

✅ 配置已保存到 ~/.agenticx/config.yaml
   默认 Provider: volcengine (doubao-seed-1-6)
```

#### 其他 config 子命令

| 命令 | 说明 |
|---|---|
| `agx config show` | 展示当前配置（Key 脱敏） |
| `agx config set providers.openai.api_key sk-...` | 直接设置某个字段 |
| `agx config get default_provider` | 读取某个字段 |
| `agx config providers` | 列出所有支持厂商及所需字段 |
| `agx config test` | 测试默认 provider 连通性 |
| `agx config test openai` | 测试指定 provider |

#### 支持的 LLM 厂商

| 厂商 | 环境变量 / 字段 | 默认模型 |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | gpt-4o |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 |
| 智谱 (GLM) | `ZHIPU_API_KEY` | glm-4-plus |
| 火山引擎 (豆包) | `ARK_API_KEY` | doubao-seed-1-6 |
| 阿里百炼 (通义) | `DASHSCOPE_API_KEY` | qwen-plus |
| 百度千帆 (文心) | `QIANFAN_ACCESS_KEY` + `secret_key` | ernie-4.0-8k |
| Kimi (Moonshot) | `MOONSHOT_API_KEY` | kimi-k2-0711-preview |
| MiniMax | `MINIMAX_API_KEY` + `group_id` | abab6.5s-chat |
| Ollama（本地） | `base_url` | llama3 |

---

### agx generate — 一次性生成

#### 基本用法

```bash
# 生成 Agent
agx generate agent "一个能搜索网页并总结内容的智能助手"

# 生成 Workflow（三节点流水线）
agx generate workflow "先搜索新闻，再摘要提取，最后翻译成英文"

# 生成自定义 Tool
agx generate tool "调用天气 API 获取实时天气数据"

# 生成 SKILL.md（技能描述文档）
agx generate skill "PDF 表格提取与结构化合并"
```

#### 无描述时自动引导

直接运行 `agx generate agent` 不带任何参数，CLI 会自动引导输入：

```
(base) user@host % agx generate agent
请描述你想构建的 Agent / Workflow / Skill / Tool：一个能分析股票数据的助手
```

#### 常用参数

| 参数 | 说明 | 示例 |
|---|---|---|
| `--provider` / `-p` | 指定 LLM 厂商 | `--provider openai` |
| `--model` / `-m` | 指定模型 | `--model gpt-4o` |
| `--output` / `-o` | 指定输出文件路径 | `--output agents/my_agent.py` |
| `--dry-run` | 只打印代码，不写文件 | `--dry-run` |
| `--run` | 生成完毕后立即执行 | `--run` |
| `--interactive` / `-i` | 多轮迭代模式 | `-i` |
| `--image <path>` | 附加图片上下文（多模态） | `--image ./ui.png` |

#### 多轮迭代（--interactive）

```bash
agx generate agent "一个能回答问题的助手" --interactive
```

```
✅ 生成完成，写入 agents/assistant.py

是否继续修改？[y/n]: y
请描述本轮修改需求: 加一个联网搜索工具，并把角色设定改为中文

⏳ 增量修改中...

✅ 已更新 agents/assistant.py

是否继续修改？[y/n]: n
```

每轮修改都基于上一版代码做**增量改写**，不会重新生成，保留已有逻辑。

---

### agx studio — 交互式多轮对话

`agx studio` 提供类 Coze 编程的沉浸式体验：多轮对话、自动代码高亮、随时保存/运行/撤销。

```bash
agx studio
# 指定 provider
agx studio --provider openai --model gpt-4o
```

启动后界面：

```
╭─ AgenticX Studio ──────────────────────────────────────╮
│  Provider: volcengine   Model: default                 │
│  交互式代码生成                                          │
╰────────────────────────────────────────────────────────╯

 Commands
┌──────────────────┬───────────────────────────────────────┐
│ 命令             │ 说明                                  │
├──────────────────┼───────────────────────────────────────┤
│ /run             │ 运行最新 Python 产物                  │
│ /save            │ 保存当前所有产物                      │
│ /show            │ 高亮显示当前产物                      │
│ /history         │ 查看迭代历史                          │
│ /image <path>    │ 添加图片上下文（base64）              │
│ /image clear     │ 清除图片上下文                        │
│ /undo            │ 回退到上一次快照                      │
│ /config [p] [m]  │ 查看或修改模型配置                    │
│ /exit            │ 退出 Studio                           │
└──────────────────┴───────────────────────────────────────┘

studio>
```

#### 典型工作流

```
studio> 帮我创建一个分析股票数据的智能体

⏳ 生成中...
✅ Generated agents/stock_analyst.py

──────────────── agents/stock_analyst.py ────────────────
  1 from agenticx import Agent, Task, AgentExecutor
  2 from agenticx.tools import tool
  ...

继续输入需求即可迭代，或使用 /history 查看记录。

studio> 加一个对比多只股票的功能

⏳ 增量修改中（基于上一版代码）...
✅ 已更新 agents/stock_analyst.py

studio> /run
⏳ 执行中...
[输出结果...]

studio> /history

 迭代历史
┌──┬─────────────────────────────┬────────────────────────┐
│# │ 描述                        │ 文件路径               │
├──┼─────────────────────────────┼────────────────────────┤
│1 │ 帮我创建一个分析股票...     │ agents/stock_analyst.py│
│2 │ 加一个对比多只股票的功能    │ agents/stock_analyst.py│
└──┴─────────────────────────────┴────────────────────────┘

studio> /save
✅ Saved agents/stock_analyst.py

studio> /exit
```

#### Studio 特性说明

| 特性 | 说明 |
|---|---|
| 增量修改 | 每轮自动携带上一版代码，LLM 做局部改写而非重新生成 |
| 自动高亮 | 生成后自动用 Syntax 高亮展示代码 |
| 快照/撤销 | `/undo` 同步回滚代码、历史记录和图片上下文 |
| 跨 target 支持 | 同一会话中可交替生成 agent、workflow、tool，路径互不覆盖 |

---

### 多模态：图片驱动生成

当你有 UI 截图、原型图或架构图时，可以把图片作为上下文参与生成。

> ⚠️ **需要视觉模型支持**：gpt-4o、claude-3+（通过 LiteLLM）、doubao-vision 等。非视觉模型会给出友好提示。

#### 在 agx generate 中使用

```bash
# 传入 UI 截图，生成对应的 Agent
agx generate agent "根据这张页面截图，创建一个抓取并解析该页面数据的 Agent" \
    --image ./screenshots/target_page.png

# 多张图片
agx generate agent "根据这两张对比图分析差异" \
    --image ./before.png \
    --image ./after.png

# 结合交互模式
agx generate agent "从这张架构图生成对应的多 Agent 工作流" \
    --image ./arch.png \
    --interactive
```

#### 在 agx studio 中使用

```
studio> /image ./screenshots/ui_mockup.png
✅ 已添加图片上下文 /path/to/ui_mockup.png

studio> 根据这张 UI 原型，生成能抓取并解析该页面所有商品信息的 Agent

⏳ 生成中（携带图片上下文）...

studio> /image clear
✅ 已清除 1 张图片上下文

studio> 现在只根据文字继续迭代
```

#### 视觉模型推荐配置

```bash
# 使用 OpenAI gpt-4o（视觉最稳定）
agx generate agent "分析图中的数据" --image chart.png --provider openai --model gpt-4o

# 使用火山引擎豆包视觉版
agx generate agent "解析 UI 截图" --image ui.png --provider volcengine --model doubao-vision-pro
```

#### 注意事项

- 图片格式支持：PNG、JPG、JPEG、WebP（MIME 类型自动识别）
- 单次可附加多张图片（`--image` 可重复多次）
- Studio 中图片上下文会持续到 `/image clear` 或会话结束
- 使用 `/undo` 时，图片上下文也会随快照一起回滚

---

### AI 生成常见问题

**Q: `agx generate agent` 直接报缺少参数怎么办？**

不需要带参数，直接运行会自动引导输入：

```bash
agx generate agent
# 提示：请描述你想构建的 Agent / Workflow / Skill / Tool：
```

**Q: 非交互环境（CI/脚本）如何使用？**

在非 TTY 环境下，`DESCRIPTION` 为必填参数，必须显式传入：

```bash
agx generate agent "一个数据清洗助手" --dry-run
```

**Q: 生成的代码语法有误怎么办？**

agx 内置 `ast.parse` 语法校验，如果生成代码有语法错误会直接提示。可以：
1. 重新运行（低温度生成，偶发失败）
2. 切换到更强的模型：`--model gpt-4o`
3. 用 `--interactive` 让 LLM 自动修复

**Q: 如何让生成的代码使用我自己的 Provider？**

生成代码会自动使用你在 `agx config init` 中配置的 Provider。也可以在命令里临时指定：

```bash
agx generate agent "..." --provider anthropic --model claude-3-5-sonnet-20241022
```

**Q: 图片输入提示"当前模型不支持图片输入"？**

切换到支持视觉的模型：

```bash
agx generate agent "..." --image ./ui.png --provider openai --model gpt-4o
```
