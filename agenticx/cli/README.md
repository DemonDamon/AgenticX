# AgenticX CLI

AgenticX 命令行工具，用于快速创建和管理 AgenticX 项目。提供项目脚手架、智能体创建、工作流管理等功能。

## 安装

```bash
pip install agenticx
```

## 快速开始

### 查看帮助信息

```bash
# 查看主命令帮助
agx -h

# 查看子命令帮助
agx project -h
agx agent -h
agx workflow -h
agx run -h
agx validate -h
agx test -h
```

## 项目管理

### 创建项目

AgenticX 支持三种项目模板：

#### 1. 基础项目（单智能体）

```bash
# 创建基础项目
agx project create my_project

# 指定模板类型
agx project create my_project --template basic

# 在指定目录创建
agx project create my_project --directory /path/to/projects
```

基础项目包含：
- `main.py` - 主程序入口
- `config.yaml` - 配置文件
- `requirements.txt` - 依赖列表
- `README.md` - 项目说明
- `tests/` - 测试目录
- `.gitignore` - Git忽略文件

#### 2. 多智能体项目

```bash
# 创建多智能体项目
agx project create my_multi_agent --template multi_agent
```

多智能体项目包含：
- 协调器智能体（Coordinator Agent）
- 工作者智能体（Worker Agent）
- 协作工作流（Collaboration Workflow）
- 通信工具（Communication Tools）
- 多智能体测试框架

#### 3. 企业级项目

```bash
# 创建企业级项目
agx project create my_enterprise --template enterprise
```

企业级项目包含：
- Docker 容器化支持
- 监控和指标收集
- 身份验证和授权
- 企业级配置管理
- 完整的测试套件

### 列出可用模板

```bash
# 查看所有项目模板
agx project list-templates
```

## 智能体管理

### 创建智能体

AgenticX 提供多种智能体模板：

#### 1. 基础智能体

```bash
# 创建基础智能体
agx agent create my_agent

# 指定角色和模板
agx agent create my_agent --role "Assistant" --template basic

# 交互式创建
agx agent create my_agent --interactive
```

#### 2. 专业智能体模板

```bash
# 研究员智能体
agx agent create researcher --template researcher

# 数据分析师智能体
agx agent create analyst --template analyst

# 内容写作者智能体
agx agent create writer --template writer
```

### 智能体配置

创建的智能体包含：
- Python 代码文件（`agents/agent_name.py`）
- 配置模板
- 角色定义
- 目标设定
- 背景故事

### 交互式创建

使用 `--interactive` 参数可以交互式设置智能体属性：

```bash
agx agent create my_agent --interactive
# 系统会提示输入：
# - 智能体名称
# - 智能体角色
# - 智能体目标
# - 智能体背景
```

### 列出智能体模板

```bash
# 查看所有智能体模板
agx agent list-templates
```

## 工作流管理

### 创建工作流

AgenticX 支持多种工作流模式：

#### 1. 顺序工作流

```bash
# 创建顺序执行工作流
agx workflow create my_workflow --template sequential
```

顺序工作流特点：
- 任务按顺序执行
- 前一个任务完成后执行下一个
- 适合有依赖关系的任务链

#### 2. 并行工作流

```bash
# 创建并行执行工作流
agx workflow create parallel_workflow --template parallel
```

并行工作流特点：
- 多个任务同时执行
- 提高执行效率
- 适合独立的任务处理

#### 3. 条件工作流

```bash
# 创建条件分支工作流
agx workflow create conditional_workflow --template conditional
```

条件工作流特点：
- 根据条件选择执行路径
- 支持复杂的业务逻辑
- 动态决策执行流程

### 交互式创建工作流

```bash
agx workflow create my_workflow --interactive
# 系统会提示输入：
# - 工作流名称
# - 工作流描述
```

### 列出工作流模板

```bash
# 查看所有工作流模板
agx workflow list-templates
```

## 项目运行和管理

### 运行项目

```bash
# 运行主程序
agx run main.py

# 使用指定配置文件
agx run main.py --config custom_config.yaml

# 启用详细输出
agx run main.py --verbose

# 启用调试模式
agx run main.py --debug
```

### 配置验证

```bash
# 验证默认配置文件
agx validate config.yaml

# 使用指定模式验证
agx validate config.yaml --schema custom_schema.json
```

### 运行测试

```bash
# 运行所有测试
agx test

# 运行指定测试套件
agx test unit_tests

# 使用模式匹配
agx test --pattern "test_*.py"

# 启用详细输出
agx test --verbose
```

## 项目结构示例

### 基础项目结构

```
my_project/
├── main.py              # 主程序入口
├── config.yaml          # 配置文件
├── requirements.txt     # 依赖列表
├── README.md           # 项目说明
├── .gitignore          # Git忽略文件
├── agents/             # 智能体目录
│   └── my_agent.py
├── workflows/          # 工作流目录
│   └── my_workflow.py
└── tests/              # 测试目录
    └── test_main.py
```

### 多智能体项目结构

```
my_multi_agent/
├── main.py
├── config.yaml
├── requirements.txt
├── README.md
├── .gitignore
├── agents/
│   ├── coordinator.py   # 协调器智能体
│   └── worker.py        # 工作者智能体
├── workflows/
│   └── collaboration.py # 协作工作流
├── tools/
│   └── communication.py # 通信工具
└── tests/
    ├── test_agents.py
    ├── test_workflows.py
    └── test_integration.py
```

## 最佳实践

### 1. 项目初始化

```bash
# 1. 创建项目
agx project create my_awesome_project --template multi_agent

# 2. 进入项目目录
cd my_awesome_project

# 3. 创建专业智能体
agx agent create researcher --template researcher --interactive
agx agent create analyst --template analyst --interactive

# 4. 创建工作流
agx workflow create data_pipeline --template sequential --interactive

# 5. 验证配置
agx validate config.yaml

# 6. 运行测试
agx test

# 7. 启动项目
agx run main.py --verbose
```

### 2. 开发流程

1. **规划阶段**：选择合适的项目模板
2. **设计阶段**：创建所需的智能体和工作流
3. **开发阶段**：实现业务逻辑
4. **测试阶段**：使用 `agx test` 验证功能
5. **部署阶段**：使用 `agx run` 启动应用

### 3. 配置管理

- 使用 `config.yaml` 集中管理配置
- 通过 `agx validate` 确保配置正确性
- 使用环境变量管理敏感信息

### 4. 测试策略

- 为每个智能体编写单元测试
- 为工作流编写集成测试
- 使用 `--verbose` 参数调试问题

## 故障排除

### 常见问题

1. **模板不存在**
   ```bash
   # 查看可用模板
   agx project list-templates
   agx agent list-templates
   agx workflow list-templates
   ```

2. **配置文件错误**
   ```bash
   # 验证配置文件
   agx validate config.yaml
   ```

3. **依赖问题**
   ```bash
   # 检查并安装依赖
   pip install -r requirements.txt
   ```

4. **权限问题**
   ```bash
   # 确保有写入权限
   chmod +w /path/to/project
   ```

### 获取帮助

- 使用 `-h` 参数查看命令帮助
- 查看项目文档和示例
- 提交 Issue 到 GitHub 仓库

## AgenticX CLI 模块概览

AgenticX CLI 模块位于 `agenticx/cli` 目录，是一个功能完整的命令行工具套件，基于 Typer 框架构建。

### 🏗️ 核心架构

**主要文件结构：**
- **`main.py`** - CLI 主程序，定义所有命令和子命令
- **`client.py`** - 统一SDK客户端，封装核心功能
- **`scaffold.py`** - 项目脚手架生成器
- **`debug.py`** - 调试服务器和监控面板
- **`deploy.py`** - 部署管理器
- **`docs.py`** - 文档生成器

### 🚀 主要功能

#### 1. **项目管理** (`agenticx project`)
- 创建新项目：支持 `basic`、`multi_agent`、`enterprise` 三种模板
- 项目信息查看和管理
- 智能体和工作流模板生成

#### 2. **工作流执行** (`agenticx run`)
- 执行工作流文件
- 配置文件验证
- 测试套件运行
- 详细输出和调试模式

#### 3. **脚手架生成** (`scaffold.py`)
- **项目模板**：基础项目、多智能体协作、企业级项目
- **智能体模板**：基础、研究员、分析师、写作者
- **工作流模板**：顺序、并行、条件工作流
- 支持 Jinja2 模板引擎

#### 4. **调试和监控** (`debug.py`)
- 监控面板：`http://localhost:8080`
- 调试服务器：`http://localhost:8888`
- 调试会话管理
- 断点设置和单步执行

#### 5. **部署管理** (`deploy.py`)
- **多平台支持**：Docker、Kubernetes、Docker Compose、Serverless
- 自动生成部署文件（Dockerfile、K8s YAML、docker-compose.yml）
- 镜像构建和推送
- 部署脚本生成

#### 6. **文档生成** (`docs.py`)
- **专注API文档**：从源代码自动生成纯净的API接口文档
- **静态网站生成**：基于MkDocs构建美观的文档网站
- 文档服务器：`http://localhost:8000`
- **智能路径选择**：支持在项目根目录、子目录或指定输出目录生成文档
- **简洁输出**：优化的日志显示，专业的用户体验

### 🛠️ 技术特性

#### **统一客户端** (`AgenticXClient`)
- 封装所有核心功能
- 配置文件加载（YAML/JSON）
- LLM提供者集成
- 工作流引擎集成
- 回调管理器支持

#### **验证和测试**
- 配置文件验证（`ValidationResult`）
- 测试结果报告（`TestResult`）
- 智能体和工作流配置验证
- 错误和警告详细报告

#### **Rich UI 支持**
- 彩色终端输出
- 进度条和表格显示
- 交互式提示
- 错误和成功状态可视化

### 📋 使用示例

```bash
# 创建新项目
agenticx project create my-agent --template multi_agent

# 执行工作流
agenticx run workflow.py --config config.yaml --verbose

# 验证配置
agenticx validate config.yaml

# 启动监控面板
agenticx monitor start --port 8080

# 生成文档（在当前目录）
agenticx docs generate

# 生成文档到指定目录
agenticx docs generate --output-dir ./my-docs

# 启动文档服务器
agenticx docs serve

# 部署到Docker
agenticx deploy prepare ./deploy --platform docker
```

### 🎯 设计亮点

1. **模块化设计**：每个功能独立模块，延迟加载提升启动速度
2. **模板系统**：丰富的项目和组件模板，快速启动开发
3. **多平台部署**：支持现代化部署方式
4. **开发者友好**：完整的调试、监控、文档工具链
5. **企业级支持**：包含安全、监控、部署等企业特性
6. **智能文档生成**：自动检测项目结构，支持灵活的输出路径配置

### 📚 文档生成详细说明

文档生成功能 (`agenticx docs`) 提供了强大的文档自动化能力：

#### **目录结构**
- **`docs/`** - 源文档目录，包含Markdown文件和自动生成的API文档
- **`site/`** - 最终的静态网站目录，可直接部署

#### **智能路径选择**
- 在项目根目录执行：生成到 `<项目根>/site` 和 `<项目根>/docs`
- 在子目录执行：生成到 `<当前目录>/site` 和 `<当前目录>/docs`
- 指定输出目录：`--output-dir` 参数自定义输出位置

#### **文档内容**
- 专注于API接口文档生成，不包含项目开发记录文档
- 使用 pydoc-markdown 从源代码自动生成API文档
- 创建 mkdocs.yml 配置文件
- 构建纯净的API文档静态网站

AgenticX CLI 提供了完整的开发者工具链，从项目创建到部署上线的全生命周期支持，是 AgenticX 框架的重要组成部分。
        