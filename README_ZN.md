# AgenticX: 统一的多智能体框架

<div align="center">
<!-- <img src="assets/agenticx-logo-2025.png" alt="AgenticX Logo" width="240" style="margin-bottom:20px;" /> -->
<img src="assets/agenticx-logo-2025.png" alt="AgenticX Logo" width="800" style="margin-bottom:20px;" />

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Documentation](https://img.shields.io/badge/docs-coming_soon-green.svg)](#)

**一个统一、可扩展、生产就绪的多智能体应用开发框架**

[功能特性](#核心功能) • [快速开始](#快速开始) • [示例](#完整示例) • [架构](#技术架构) • [进展](#开发进展)

</div>

---

**Language / 语言**: [English](README.md) | [中文](README_ZN.md)

---

## 愿景

AgenticX 旨在打造一个统一、可扩展、生产就绪的多智能体应用开发框架，赋予开发者构建从简单自动化助手到复杂协作式智能体系统的全部能力。

## 核心功能

### 核心框架 (已完成)
- **智能体核心**: 基于 12-Factor Agents 方法论的智能体执行引擎
- **编排引擎**: 支持复杂工作流、条件路由、并行执行的图式编排引擎
- **工具系统**: 统一的工具接口，支持函数装饰器、远程工具(MCP)、内置工具集
- **记忆系统**: 深度集成 Mem0 的长期记忆，支持任意 LLM 模型
- **通信协议**: A2A 智能体间通信、MCP 资源访问协议
- **任务验证**: 基于 Pydantic 的输出解析和自动修复
- **GUI Agent / 具身智能**: 完整的 GUI 自动化框架，包含动作反思、卡住检测、动作缓存、REACT 解析、Device-Cloud 路由和 DAG 任务验证

### 企业级监控 (已完成)
- **可观测性**: 完整的回调系统、实时监控、轨迹分析
- **性能监控**: 实时指标收集、Prometheus 集成、系统监控
- **轨迹分析**: 执行路径追踪、失败分析、性能瓶颈识别
- **数据导出**: 多格式导出(JSON/CSV/Prometheus)、时间序列分析

### 开发者体验 (规划中)
- **CLI 工具**: 项目创建、部署、监控命令行工具
- **Web UI**: 可视化智能体管理和监控界面
- **IDE 集成**: VS Code 扩展、Jupyter 内核支持

### 企业级安全 (规划中)
- **安全沙箱**: 安全的代码执行环境和资源隔离
- **多租户**: RBAC 权限控制、数据隔离
- **人工审批**: 人机协作工作流、风险控制

### GUI Agent / 具身智能 (M16) (已完成)
- **动作反思机制**: A/B/C 动作结果分类，支持启发式和 VLM 两种反思模式
- **卡住检测与恢复**: 连续失败检测、重复模式识别、智能恢复策略推荐
- **动作缓存系统**: 基于动作树的轨迹缓存，支持精确匹配和模糊匹配（可达 9x 加速）
- **REACT 输出解析**: 标准化的 REACT 格式解析，紧凑动作 Schema
- **Device-Cloud 路由**: 根据任务复杂度、敏感性动态选择设备端或云端模型
- **DAG 任务验证**: 基于 DAG 的多路径任务验证，支持双语义依赖

## 快速开始

### 安装

#### 方式一：从 PyPI 安装（推荐）

```bash
# 核心安装（轻量，无 torch，秒装）
pip install agenticx

# 按需安装可选功能
pip install "agenticx[memory]"      # 记忆系统: mem0, chromadb, qdrant, redis, milvus
pip install "agenticx[document]"    # 文档处理: PDF, Word, PPT 解析
pip install "agenticx[graph]"       # 知识图谱: networkx, neo4j, 社区检测
pip install "agenticx[llm]"         # 额外 LLM: anthropic, ollama
pip install "agenticx[monitoring]"  # 可观测性: prometheus, opentelemetry
pip install "agenticx[mcp]"         # MCP 协议
pip install "agenticx[database]"    # 数据库后端: postgres, SQLAlchemy
pip install "agenticx[data]"        # 数据分析: pandas, scikit-learn, matplotlib
pip install "agenticx[ocr]"         # OCR（会拉入 torch ~2GB）: easyocr
pip install "agenticx[volcengine]"  # 火山引擎 AgentKit
pip install "agenticx[all]"         # 全部功能
```

> **提示**: 核心包仅包含 ~27 个轻量依赖，安装速度极快。重量级依赖（如 torch、pandas 等）均已移至可选分组，按需安装即可。

#### 方式二：从源码安装（开发）

```bash
# 克隆仓库
git clone https://github.com/DemonDamon/AgenticX.git
cd AgenticX

# 使用 uv（推荐，比 pip 快 10-100 倍）
pip install uv
uv pip install -e .                  # 核心安装
uv pip install -e ".[memory,graph]"  # 按需加载可选功能
uv pip install -e ".[all]"           # 全部功能
uv pip install -e ".[dev]"           # 开发工具

# 或使用 pip
pip install -e .
pip install -e ".[all]"
```

#### 环境配置

```bash
# 设置环境变量
export OPENAI_API_KEY="your-api-key"
export ANTHROPIC_API_KEY="your-api-key"  # 可选
```

> **完整安装指南**: 关于系统依赖（antiword、tesseract）和高级文档处理功能的详细信息，请参阅 [INSTALL.md](INSTALL.md)

### 创建第一个智能体

```python
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider

# 创建智能体
agent = Agent(
    id="data-analyst",
    name="数据分析师",
    role="数据分析专家", 
    goal="帮助用户分析和理解数据",
    organization_id="my-org"
)

# 创建任务
task = Task(
    id="analysis-task",
    description="分析销售数据趋势",
    expected_output="详细的分析报告"
)

# 配置LLM
llm = OpenAIProvider(model="gpt-4")

# 执行任务
executor = AgentExecutor(agent=agent, llm=llm)
result = executor.run(task)
print(result)
```

### 工具使用示例

```python
from agenticx.tools import tool

@tool
def calculate_sum(x: int, y: int) -> int:
    """计算两个数的和"""
    return x + y

@tool  
def search_web(query: str) -> str:
    """搜索网络信息"""
    return f"搜索结果: {query}"

# 智能体会自动调用这些工具
```

## 完整示例

我们提供了丰富的示例来展示框架的各种功能：

### 智能体核心 (M5)

**单智能体示例**
```bash
# 基础智能体使用
python examples/m5_agent_demo.py
```
- 展示智能体的基本创建和执行
- 工具调用和错误处理
- 事件驱动的执行流程

**多智能体协作**
```bash
# 多智能体协作示例
python examples/m5_multi_agent_demo.py
```
- 多个智能体的协作模式
- 任务分发和结果聚合
- 智能体间的通信

### 编排与验证 (M6 & M7)

**简单工作流**
```bash
# 基础工作流编排
python examples/m6_m7_simple_demo.py
```
- 工作流的创建和执行
- 任务输出的解析和验证
- 条件路由和错误处理

**复杂工作流**
```bash
# 复杂工作流编排
python examples/m6_m7_comprehensive_demo.py
```
- 复杂的工作流图结构
- 并行执行和条件分支
- 完整的生命周期管理

### 智能体通信 (M8)

**A2A 协议演示**
```bash
# 智能体间通信协议
python examples/m8_a2a_demo.py
```
- Agent-to-Agent 通信协议
- 分布式智能体系统
- 服务发现和技能调用

### 可观测性监控 (M9)

**完整监控演示**
```bash
# 可观测性模块演示
python examples/m9_observability_demo.py
```
- 实时性能监控
- 执行轨迹分析
- 失败分析和恢复建议
- 数据导出和报告生成

### 记忆系统

**基础记忆使用**
```bash
# 记忆系统示例
python examples/memory_example.py
```
- 长期记忆的存储和检索
- 上下文记忆管理

**医疗场景应用**
```bash
# 医疗记忆场景
python examples/mem0_healthcare_example.py  
```
- 医疗知识的记忆和应用
- 个性化的患者信息管理

### 人机协作

**人工干预流程**
```bash
# 人机协作示例
python examples/human_in_the_loop_example.py
```
- 人工审批工作流
- 人机协作模式
- 风险控制机制

详细说明请参考: [examples/README_HITL.md](examples/README_HITL.md)

### LLM 集成

**聊天机器人**
```bash
# LLM聊天示例
python examples/llm_chat_example.py
```
- 多模型支持演示
- 流式响应处理
- 成本控制和监控

### 安全沙箱

**代码执行沙箱**
```bash
# 微沙箱示例
python examples/microsandbox_example.py
```
- 安全的代码执行环境
- 资源限制和隔离

技术博客: [examples/microsandbox_blog.md](examples/microsandbox_blog.md)

### GUI Agent / 具身智能 (M16)

**GUI 自动化智能体**
```bash
# GUI Agent 示例
python examples/agenticx-for-guiagent/AgenticX-GUIAgent/main.py
```
- 完整的 GUI 自动化框架，基于人类对齐学习理念
- 动作反思（A/B/C 分类）和卡住检测
- 动作缓存系统，性能优化可达 9x 加速
- REACT 输出解析和紧凑动作 Schema
- Device-Cloud 路由，智能模型选择
- DAG 任务验证，多路径任务定义和验证

核心能力：
- **动作反思**: 自动动作结果分类（成功/错误状态/无变化）
- **卡住检测**: 连续失败检测和恢复策略推荐
- **动作缓存**: 轨迹缓存，支持精确匹配和模糊匹配（可达 9x 加速）
- **REACT 解析**: 标准化的 REACT 格式输出解析
- **智能路由**: 根据任务复杂度和敏感性动态选择设备端或云端模型
- **DAG 验证**: 多路径任务验证，支持双语义依赖

详见: [examples/agenticx-for-guiagent/](examples/agenticx-for-guiagent/)

## 技术架构
![智能体系统架构图](assets/智能体系统架构图.png)

## 开发进展

### ✅ 已完成模块 (M1-M9, M16)

| 模块 | 状态 | 功能描述 |
|------|------|----------|
| **M1** | ✅ | 核心抽象层 - Agent、Task、Tool、Workflow 等基础数据结构 |
| **M2** | ✅ | LLM 服务层 - 基于 LiteLLM 的统一 LLM 接口，支持 100+ 模型 |
| **M3** | ✅ | 工具系统 - 函数装饰器、MCP 远程工具、内置工具集 |
| **M4** | ✅ | 记忆系统 - 深度集成 Mem0，支持自定义 LLM |
| **M5** | ✅ | 智能体核心 - 完整的 think-act 循环、事件驱动架构 |
| **M6** | ✅ | 任务验证 - 基于 Pydantic 的输出解析和自动修复 |
| **M7** | ✅ | 编排引擎 - 图式工作流、条件路由、并行执行 |
| **M8** | ✅ | 通信协议 - A2A 智能体通信、MCP 资源访问 |
| **M9** | ✅ | 可观测性 - 完整监控、轨迹分析、性能指标 |
| **M16** | ✅ | 具身智能模块 - GUI Agent 框架，包含动作反思、卡住检测、动作缓存、REACT 输出解析、Device-Cloud 路由和 DAG 任务验证 |

### 规划中模块 (M10-M13)

| 模块 | 状态 | 功能描述 |
|------|------|----------|
| **M10** | 🚧 | 开发者体验 - CLI、Web UI、IDE 集成 |
| **M11** | 🚧 | 企业安全 - 多租户、RBAC、安全沙箱 |
| **M12** | 🚧 | 智能体进化 - 架构搜索、知识蒸馏 |
| **M13** | 🚧 | 知识中台 - 企业数据连接、统一搜索 |

## 核心优势

- **统一抽象**: 提供清晰一致的核心抽象，避免概念混乱
- **可插拔架构**: 所有组件都可替换，避免厂商锁定
- **企业级监控**: 完整的可观测性，生产环境就绪
- **安全第一**: 内置安全机制和多租户支持
- **高性能**: 优化的执行引擎和并发处理
- **丰富生态**: 完整的工具集和示例库

## 系统要求

- **Python**: 3.10+
- **内存**: 4GB+ RAM 推荐
- **系统**: Windows / Linux / macOS
- **核心依赖**: ~27 个轻量包，秒级安装（详见 `pyproject.toml`）
- **可选依赖**: 按功能分为 15 个可选组，通过 `pip install "agenticx[xxx]"` 按需安装

## 贡献指南

我们欢迎社区贡献！请参考：

1. 提交 Issue 报告 bug 或提出功能请求
2. Fork 项目并创建功能分支
3. 提交 Pull Request，确保通过所有测试
4. 参与代码审查和讨论

## 许可证

本项目采用 GNU Affero General Public License v3.0 (AGPL-3.0) - 详见 [LICENSE](LICENSE) 文件

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=DemonDamon/AgenticX&type=Date)](https://star-history.com/#DemonDamon/AgenticX&Date)

---

<div align="center">

**如果 AgenticX 对你有帮助，请给我们一个 Star！**

[GitHub](https://github.com/DemonDamon/AgenticX) • [文档](coming-soon) • [示例](examples/) • [讨论](https://github.com/DemonDamon/AgenticX/discussions)

</div>