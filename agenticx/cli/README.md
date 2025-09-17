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
        