---
name: AGX AI-Powered Code Generation
overview: |
  将 agx CLI 从静态模板工具升级为 AI 驱动的智能体构建平台。四个阶段：(1) 统一多厂商 LLM 配置
  (2) AI 代码生成引擎（结合元 Skills）(3) 交互式 Studio 模式 (4) 智能模板增强。
  最终效果：用户配好 API Key，用自然语言描述需求，agx 自动生成可运行的 Agent/Workflow/Skill/Tool 代码。
todos:
  - id: p1-t1
    content: "Phase 1 / Task 1: 设计统一配置格式 — ~/.agenticx/config.yaml schema + 项目级覆盖"
    status: completed
  - id: p1-t2
    content: "Phase 1 / Task 2: 实现 agx config 命令组 — init wizard / set / get / show / providers"
    status: completed
  - id: p1-t3
    content: "Phase 1 / Task 3: ProviderResolver — 从统一配置创建 LLM Provider 实例"
    status: completed
  - id: p1-t4
    content: "Phase 1 / Task 4: 补齐 Provider — 智谱 ZhipuProvider + 百度 QianfanProvider + MiniMaxProvider"
    status: completed
  - id: p2-t1
    content: "Phase 2 / Task 1: CodeGenEngine 核心 — 加载元 Skill → 构建 system prompt → 调 LLM → 输出代码"
    status: completed
  - id: p2-t2
    content: "Phase 2 / Task 2: agx generate 命令组 — agent / workflow / skill / tool 四个子命令"
    status: completed
  - id: p2-t3
    content: "Phase 2 / Task 3: 代码后处理 — 语法校验 + import 修复 + 代码格式化"
    status: completed
  - id: p2-t4
    content: "Phase 2 / Task 4: agx generate 端到端验证 — 从自然语言到可运行代码"
    status: completed
  - id: p3-t1
    content: "Phase 3 / Task 1: agx studio REPL — 多轮对话式智能体构建（类 Coze 编程）"
    status: completed
  - id: p3-t2
    content: "Phase 3 / Task 2: Studio 会话管理 — 上下文记忆 + 历史 + 项目感知"
    status: completed
  - id: p3-t3
    content: "Phase 3 / Task 3: Studio 执行能力 — 生成代码后直接 agx run 执行 + 观察结果"
    status: completed
  - id: p4-t1
    content: "Phase 4 / Task 1: 智能模板增强 — agx project create --ai / agx agent create --ai"
    status: completed
isProject: true
---

# AGX AI-Powered Code Generation（AI 驱动的智能体代码生成）

> **愿景：** 用户配好 API Key，用自然语言描述需求，agx 自动生成可运行的 Agent / Workflow / Skill / Tool 代码。类似 Coze 编程体验，但生成的是本地可控的 Python 代码。

## 背景与动机

### 现状问题

1. **模板死板**：`agx project create` / `agx agent create` 使用内联静态模板（`scaffold.py`），很多模板（researcher/analyst/writer/parallel/conditional）是占位符，用户拿到脚手架后仍需大量手工编码
2. **配置碎片化**：LLM 配置散落在环境变量、deploy config、volcengine config 等多处，用户首次使用不知道在哪里配
3. **元 Skills 未被利用**：刚刚创建的 8 个元 Skills 包含了 AgenticX 的全部 API 知识，但目前只能被外部 AI Agent（Cursor/Claude Code）加载，agx 自己不使用
4. **Provider 覆盖不全**：缺少智谱、百度千帆、MiniMax 的专用 Provider

### 目标状态

```
用户 → "agx config init" 配置 LLM Key
     → "agx generate agent '一个能搜索网页并总结的研究助手'"
     → 生成 agents/researcher.py（含 Agent、Task、Tool、Executor 完整代码）
     → "agx run agents/researcher.py"
     → 直接运行
```

### 核心架构

```
┌─────────────────────────────────────────────────┐
│                  agx CLI                         │
│                                                  │
│  agx config    agx generate    agx studio       │
│      │              │              │             │
│      ▼              ▼              ▼             │
│  ┌────────┐   ┌──────────┐   ┌──────────┐      │
│  │ Config │   │ CodeGen  │   │ Studio   │      │
│  │ Manager│   │ Engine   │   │ REPL     │      │
│  └────┬───┘   └────┬─────┘   └────┬─────┘      │
│       │             │              │             │
│       ▼             ▼              ▼             │
│  ┌─────────────────────────────────────┐        │
│  │         ProviderResolver            │        │
│  │  config.yaml → LLM Provider 实例    │        │
│  └─────────────┬───────────────────────┘        │
│                │                                 │
│       ┌────────┴────────┐                       │
│       ▼                 ▼                        │
│  ┌─────────┐     ┌──────────┐                   │
│  │ Meta    │     │ LLM      │                   │
│  │ Skills  │     │ Providers│                   │
│  │ (知识库) │     │ (执行层)  │                   │
│  └─────────┘     └──────────┘                   │
└─────────────────────────────────────────────────┘
```

---

## Phase 1: 统一多厂商 LLM 配置

**目标：** 用户执行 `agx config init` 完成 LLM 配置，之后所有 agx 命令共享同一配置。

### Task 1: 统一配置格式设计

**文件：** 新建 `agenticx/cli/config_manager.py`

**配置文件位置（优先级从高到低）：**

1. 项目级：`./.agenticx/config.yaml`
2. 全局级：`~/.agenticx/config.yaml`
3. 环境变量（最终 fallback）

**Schema 设计：**

```yaml
# ~/.agenticx/config.yaml
version: "1"

# 默认使用的 provider
default_provider: openai

# 各厂商配置
providers:
  openai:
    api_key: "sk-..."
    model: "gpt-4o"
    base_url: "https://api.openai.com/v1"   # 可选，用于代理

  anthropic:
    api_key: "sk-ant-..."
    model: "claude-sonnet-4-20250514"

  zhipu:
    api_key: "..."
    model: "glm-4-plus"

  volcengine:
    api_key: "..."
    endpoint_id: "ep-..."
    model: "doubao-seed-1-6"

  bailian:
    api_key: "..."
    model: "qwen-plus"

  qianfan:
    api_key: "..."
    secret_key: "..."
    model: "ernie-4.0-8k"

  kimi:
    api_key: "..."
    model: "kimi-k2-0711-preview"

  minimax:
    api_key: "..."
    group_id: "..."
    model: "abab6.5s-chat"

  ollama:
    base_url: "http://localhost:11434"
    model: "llama3"

# 代码生成偏好
codegen:
  language: "zh"           # 注释语言偏好
  style: "functional"      # functional / class-based
  include_tests: true      # 是否同时生成测试代码
```

**核心类：**

```python
@dataclass
class ProviderConfig:
    name: str
    api_key: Optional[str] = None
    model: str = ""
    base_url: Optional[str] = None
    endpoint_id: Optional[str] = None
    secret_key: Optional[str] = None
    group_id: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

class ConfigManager:
    """Unified config manager for agx CLI."""

    def load() -> AgxConfig
    def save(config: AgxConfig) -> None
    def get_provider(name: Optional[str] = None) -> ProviderConfig
    def set_value(key: str, value: str) -> None
    def get_value(key: str) -> Any
```

### Task 2: agx config 命令组

**文件：** 新建 `agenticx/cli/config_commands.py`，注册到 `main.py`

**命令：**


| 命令                             | 说明                                                        |
| ------------------------------ | --------------------------------------------------------- |
| `agx config init`              | 交互式配置向导（选厂商 → 输入 Key → 选默认模型 → 验证连通性）                     |
| `agx config set <key> <value>` | 设置配置项（如 `agx config set providers.openai.api_key sk-...`） |
| `agx config get <key>`         | 读取配置项                                                     |
| `agx config show`              | 展示当前配置（Key 脱敏显示）                                          |
| `agx config providers`         | 列出所有支持的厂商及其所需字段                                           |
| `agx config test [provider]`   | 测试指定 provider 的连通性（发一个 "hello" 请求）                        |


`**agx config init` 交互流程：**

```
$ agx config init

🔧 AgenticX 配置向导

? 选择你的主要 LLM 厂商:
  ❯ OpenAI
    Anthropic (Claude)
    智谱 (GLM)
    火山引擎 (豆包)
    阿里百炼 (通义千问)
    百度千帆 (文心一言)
    Kimi (Moonshot)
    MiniMax
    Ollama (本地模型)

? 输入 OpenAI API Key: sk-...
? 选择默认模型:
  ❯ gpt-4o
    gpt-4o-mini
    gpt-4-turbo
    自定义...

⏳ 验证连通性... ✅ 连接成功！

? 是否添加更多厂商？ (y/N)

✅ 配置已保存到 ~/.agenticx/config.yaml
   默认 Provider: openai (gpt-4o)

💡 现在可以运行:
   agx generate agent "一个数据分析助手"
```

### Task 3: ProviderResolver

**文件：** 新建 `agenticx/llms/provider_resolver.py`

从统一配置创建 LLM Provider 实例：

```python
class ProviderResolver:
    """Resolve config to concrete LLM provider instance."""

    PROVIDER_MAP = {
        "openai": LiteLLMProvider,
        "anthropic": LiteLLMProvider,
        "zhipu": ZhipuProvider,        # 新增
        "volcengine": ArkLLMProvider,
        "bailian": BailianProvider,
        "qianfan": QianfanProvider,     # 新增
        "kimi": KimiProvider,
        "minimax": MiniMaxProvider,     # 新增
        "ollama": LiteLLMProvider,
    }

    MODEL_PREFIX_MAP = {
        "openai": "",                    # gpt-4o
        "anthropic": "anthropic/",       # anthropic/claude-sonnet-4-20250514
        "ollama": "ollama/",             # ollama/llama3
    }

    def resolve(self, provider_name: str = None) -> BaseLLMProvider:
        config = ConfigManager.load()
        pc = config.get_provider(provider_name or config.default_provider)
        cls = self.PROVIDER_MAP[pc.name]
        return cls(**self._build_kwargs(pc))
```

### Task 4: 补齐 Provider

**新建文件：**


| 文件                                  | Provider          | 厂商               |
| ----------------------------------- | ----------------- | ---------------- |
| `agenticx/llms/zhipu_provider.py`   | `ZhipuProvider`   | 智谱 AI（GLM 系列）    |
| `agenticx/llms/qianfan_provider.py` | `QianfanProvider` | 百度千帆（文心一言）       |
| `agenticx/llms/minimax_provider.py` | `MiniMaxProvider` | MiniMax（abab 系列） |


三者均继承 `BaseLLMProvider`，各约 100-150 行。优先使用各厂商的 OpenAI-compatible API（降低复杂度），fallback 到原生 SDK。

**支持的厂商与模型清单：**


| 厂商        | Provider 类      | 默认模型                     | API 风格                        |
| --------- | --------------- | ------------------------ | ----------------------------- |
| OpenAI    | LiteLLMProvider | gpt-4o                   | OpenAI 原生                     |
| Anthropic | LiteLLMProvider | claude-sonnet-4-20250514 | Anthropic 原生                  |
| 智谱        | ZhipuProvider   | glm-4-plus               | OpenAI Compatible             |
| 火山引擎      | ArkLLMProvider  | doubao-seed-1-6          | OpenAI Compatible             |
| 阿里百炼      | BailianProvider | qwen-plus                | OpenAI Compatible (DashScope) |
| 百度千帆      | QianfanProvider | ernie-4.0-8k             | OpenAI Compatible / 原生        |
| Kimi      | KimiProvider    | kimi-k2-0711-preview     | OpenAI Compatible             |
| MiniMax   | MiniMaxProvider | abab6.5s-chat            | OpenAI Compatible             |
| Ollama    | LiteLLMProvider | llama3                   | OpenAI Compatible (local)     |


---

## Phase 2: AI 代码生成引擎

**目标：** `agx generate agent "描述"` 生成可运行的 Python 代码。

### Task 1: CodeGenEngine 核心

**文件：** 新建 `agenticx/cli/codegen_engine.py`

**核心流程：**

```
用户描述 → 选择元 Skill → 构建 Prompt → 调用 LLM → 提取代码 → 后处理 → 写入文件
```

**详细设计：**

```python
class CodeGenEngine:
    """AI-powered code generation engine using meta skills."""

    def __init__(self, provider: BaseLLMProvider):
        self.provider = provider
        self.skill_loader = SkillBundleLoader()

    def generate(
        self,
        target: str,          # "agent" | "workflow" | "skill" | "tool"
        description: str,     # 用户自然语言描述
        context: dict = None  # 额外上下文（已有代码、项目结构等）
    ) -> GeneratedCode:
        # 1. 选择并加载对应的元 Skill
        skill_name = self._select_meta_skill(target)
        skill_content = self.skill_loader.get_skill_content(skill_name)

        # 2. 构建 system prompt
        system_prompt = self._build_system_prompt(skill_content, target)

        # 3. 构建 user prompt
        user_prompt = self._build_user_prompt(description, context)

        # 4. 调用 LLM
        response = self.provider.invoke(
            prompt=user_prompt,
            system=system_prompt,
            temperature=0.2,      # 低温度保证代码质量
            max_tokens=4096
        )

        # 5. 从响应中提取代码块
        code = self._extract_code(response.content)

        # 6. 后处理
        code = self._post_process(code, target)

        return GeneratedCode(code=code, target=target, description=description)
```

**元 Skill 映射：**


| target     | 元 Skill                      | 用途               |
| ---------- | ---------------------------- | ---------------- |
| `agent`    | `agenticx-agent-builder`     | Agent 创建的 API 知识 |
| `workflow` | `agenticx-workflow-designer` | 工作流 API 知识       |
| `skill`    | `agenticx-skill-manager`     | SKILL.md 格式规范    |
| `tool`     | `agenticx-tool-creator`      | 工具创建 API 知识      |


**System Prompt 结构：**

```
你是 AgenticX 代码生成器。你的任务是根据用户描述生成可直接运行的 Python 代码。

## AgenticX API 参考
{meta_skill_content}

## 代码规范
- 使用完整的 import 路径（from agenticx import ...）
- 包含 if __name__ == "__main__" 入口
- 使用用户配置的 LLM Provider：{provider_info}
- 代码包含类型注解和必要的 docstring
- 工具函数使用 @tool 装饰器

## 输出格式
用 

```python 

``` 包裹完整代码，不要有省略号或占位符。
```

### Task 2: agx generate 命令组

**文件：** 新建 `agenticx/cli/generate_commands.py`，注册到 `main.py`

**命令：**


| 命令                           | 说明             | 示例                                          |
| ---------------------------- | -------------- | ------------------------------------------- |
| `agx generate agent "描述"`    | 生成 Agent 代码    | `agx generate agent "一个能搜索网页并总结的研究助手"`      |
| `agx generate workflow "描述"` | 生成 Workflow 代码 | `agx generate workflow "先搜索再分析最后写报告的三步流水线"` |
| `agx generate skill "描述"`    | 生成 SKILL.md    | `agx generate skill "PDF 表格提取和合并"`          |
| `agx generate tool "描述"`     | 生成 Tool 代码     | `agx generate tool "调用天气API获取实时天气"`         |


**公共参数：**


| 参数                  | 说明         | 默认值                        |
| ------------------- | ---------- | -------------------------- |
| `--provider` / `-p` | 使用的 LLM 厂商 | config 中的 default_provider |
| `--model` / `-m`    | 使用的模型      | provider 的默认模型             |
| `--output` / `-o`   | 输出文件路径     | 自动推断（如 `agents/{name}.py`） |
| `--dry-run`         | 只打印代码，不写文件 | False                      |
| `--run`             | 生成后立即执行    | False                      |


**使用示例：**

```bash
# 基本用法
agx generate agent "一个数据分析助手，能读取CSV文件并生成可视化图表"

# 指定 provider 和输出
agx generate agent "网络安全扫描助手" --provider anthropic --output agents/security_scanner.py

# 生成后立即运行
agx generate workflow "爬取新闻 → 摘要提取 → 翻译成英文" --run

# 只预览不写文件
agx generate tool "查询 PostgreSQL 数据库" --dry-run
```

**输出示例：**

```
$ agx generate agent "一个能搜索网页并总结的研究助手"

🤖 正在生成 Agent 代码...
   Provider: openai (gpt-4o)
   元 Skill: agenticx-agent-builder

📝 生成完成，写入 agents/web_researcher.py

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider
from agenticx.tools import tool

@tool
def search_web(query: str) -> str:
    """Search the web and return results."""
    import requests
    ...

agent = Agent(
    id="web-researcher",
    name="Web Researcher",
    role="Web Research Specialist",
    goal="Search the web and produce concise summaries",
    organization_id="default"
)
...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 运行: agx run agents/web_researcher.py
```

### Task 3: 代码后处理

**文件：** `agenticx/cli/codegen_engine.py` 内的 `_post_process()` 方法

**处理步骤：**

1. **代码提取**：从 LLM 响应中提取

```python

``` 块
2. **语法校验**：`ast.parse()` 检查语法正确性
3. **Import 修复**：确保所有 agenticx 导入路径正确
4. **Provider 注入**：将生成代码中的 LLM Provider 替换为用户配置的实际 Provider
5. **代码格式化**：可选使用 `black` 格式化
6. **安全检查**：确保没有 `eval()`、硬编码密钥等安全问题

```python
def _post_process(self, code: str, target: str) -> str:
    # Syntax check
    try:
        ast.parse(code)
    except SyntaxError as e:
        code = self._fix_syntax(code, e)

    # Ensure correct imports
    code = self._fix_imports(code)

    # Inject user's provider config
    code = self._inject_provider(code)

    # Optional: format with black
    code = self._format_code(code)

    return code
```

### Task 4: 端到端验证

验证场景：


| #   | 输入                                          | 期望输出                 |
| --- | ------------------------------------------- | -------------------- |
| 1   | `agx generate agent "数据分析助手"`               | 可运行的 Agent + 工具代码    |
| 2   | `agx generate workflow "搜索→分析→报告"`          | 三节点 Workflow 代码      |
| 3   | `agx generate skill "Excel 处理"`             | 合规的 SKILL.md         |
| 4   | `agx generate tool "天气查询 API"`              | @tool 装饰的函数          |
| 5   | `agx generate agent "..." --provider zhipu` | 使用 ZhipuProvider 的代码 |
| 6   | `agx generate agent "..." --run`            | 生成 + 立即执行            |


---

## Phase 3: 交互式 Studio 模式

**目标：** `agx studio` 提供多轮对话式的智能体构建体验（类 Coze 编程）。

### Task 1: Studio REPL

**文件：** 新建 `agenticx/cli/studio.py`

```
$ agx studio

╔══════════════════════════════════════════════╗
║  AgenticX Studio v0.3.0                      ║
║  AI-powered agent building environment       ║
║  Provider: openai (gpt-4o)                   ║
╚══════════════════════════════════════════════╝

Type your requirements in natural language.
Commands: /run, /save, /show, /undo, /config, /exit

studio> 帮我创建一个能分析股票数据的智能体

🤖 正在生成...

我为你创建了一个股票分析智能体，包含以下组件：

📄 agents/stock_analyst.py
┌──────────────────────────────────────────┐
│ Agent: Stock Analyst                      │
│ Tools: fetch_stock_data, analyze_trend    │
│ Output: 结构化分析报告 (Pydantic)         │
└──────────────────────────────────────────┘

studio> 加一个对比多只股票的功能

🤖 更新代码中...

✅ 新增 compare_stocks 工具和对应 Task。

studio> /run
⏳ 执行中... agents/stock_analyst.py
✅ 执行完成 (3.2s)
[输出结果...]

studio> 把它改成工作流，先抓数据再分析再生成报告

🤖 重构为 Workflow...

📄 workflows/stock_pipeline.py
┌──────────────────────────────────────────┐
│ [Fetch Data] → [Analyze] → [Report]      │
│  stock_fetcher  analyst     reporter      │
└──────────────────────────────────────────┘

studio> /save
✅ 已保存:
   agents/stock_analyst.py
   workflows/stock_pipeline.py

studio> /exit
```

**核心功能：**


| 功能        | 说明                                       |
| --------- | ---------------------------------------- |
| 自然语言输入    | 描述需求，自动判断生成 Agent/Workflow/Tool          |
| 增量修改      | 在已生成代码基础上迭代，不用重新描述                       |
| `/run`    | 直接在 Studio 中执行生成的代码                      |
| `/save`   | 将当前代码写入文件                                |
| `/show`   | 展示当前生成的所有代码                              |
| `/undo`   | 撤销上一步修改                                  |
| `/config` | 查看/切换 LLM Provider                       |
| `/export` | 导出为完整项目（含 config.yaml, requirements.txt） |


### Task 2: 会话管理

**设计要点：**

- **对话历史**：维护完整的 user-assistant 对话记录
- **代码上下文**：每轮生成后将代码加入上下文，下一轮 LLM 能看到已有代码
- **项目感知**：扫描当前项目结构，LLM 知道已有哪些 Agent/Tool/Workflow
- **元 Skills 动态加载**：根据用户当前需求自动切换对应的元 Skill

### Task 3: 执行能力

**与 `agx run` 集成：**

```python
async def execute_generated_code(file_path: str) -> ExecutionResult:
    """Run generated code and capture output."""
    proc = await asyncio.create_subprocess_exec(
        sys.executable, file_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    return ExecutionResult(
        exit_code=proc.returncode,
        stdout=stdout.decode(),
        stderr=stderr.decode()
    )
```

如果执行失败，Studio 会将错误信息反馈给 LLM 自动修复。

---

## Phase 4: 智能模板增强

**目标：** 现有的 `agx project create` / `agx agent create` 增加 `--ai` 模式。

### Task 1: 增强现有命令

```bash
# 传统模式（不变）
agx project create my-app --template basic

# AI 增强模式（新增 --ai）
agx project create my-stock-analyzer --ai "一个股票分析应用，包含数据抓取、技术分析和报告生成三个智能体"

# AI 增强 Agent 创建
agx agent create analyst --ai "专注于技术面分析，能计算 MACD、RSI、布林带指标"
```

**工作方式：**

1. 先用传统模板生成项目骨架（目录结构、config、requirements）
2. 再用 CodeGenEngine 填充 Agent/Workflow/Tool 的具体实现
3. 结果：完整的、可运行的项目

---

## 实现优先级与依赖关系

```
Phase 1 (配置)
  ├── T1: config schema         ← 无依赖
  ├── T2: agx config commands   ← 依赖 T1
  ├── T3: ProviderResolver      ← 依赖 T1
  └── T4: 补齐 Providers        ← 无依赖（可并行）

Phase 2 (代码生成)          ← 依赖 Phase 1
  ├── T1: CodeGenEngine         ← 依赖 P1-T3 + 元 Skills
  ├── T2: agx generate commands ← 依赖 P2-T1
  ├── T3: 代码后处理            ← 依赖 P2-T1
  └── T4: 端到端验证            ← 依赖 P2-T2 + P2-T3

Phase 3 (Studio)            ← 依赖 Phase 2
  ├── T1: REPL 基础             ← 依赖 P2-T1
  ├── T2: 会话管理              ← 依赖 P3-T1
  └── T3: 执行能力              ← 依赖 P3-T1

Phase 4 (模板增强)          ← 依赖 Phase 2
  └── T1: --ai flag             ← 依赖 P2-T1
```

## 工作量估算


| Phase   | 新增文件  | 修改文件  | 预估行数      | 预估工时      |
| ------- | ----- | ----- | --------- | --------- |
| Phase 1 | 5     | 3     | ~1200     | 2-3 天     |
| Phase 2 | 2     | 2     | ~800      | 2-3 天     |
| Phase 3 | 1     | 1     | ~600      | 2 天       |
| Phase 4 | 0     | 2     | ~200      | 1 天       |
| **合计**  | **8** | **8** | **~2800** | **7-9 天** |


## 风险与缓解


| 风险              | 缓解                                            |
| --------------- | --------------------------------------------- |
| LLM 生成的代码质量不稳定  | 后处理层做 ast.parse + import fix；低温度生成；必要时多次采样取最佳 |
| 各厂商 API 兼容性差异   | 优先走 OpenAI-compatible API；Provider 层统一适配      |
| Studio 多轮上下文溢出  | 压缩历史消息；只保留最近代码 + 关键对话                         |
| 用户期望代码开箱即用但依赖缺失 | 生成代码时同时输出 requirements；`--run` 模式先检查依赖        |


## 与现有系统的关系


| 现有组件                             | 关系                                      |
| -------------------------------- | --------------------------------------- |
| `scaffold.py`                    | Phase 4 增强，不替换                          |
| `agenticx/llms/`                 | Phase 1 补齐 Provider + ProviderResolver  |
| `agenticx/skills/`               | Phase 2 消费元 Skills 作为 system prompt     |
| `agenticx/tools/skill_bundle.py` | Phase 2 通过 SkillBundleLoader 加载元 Skills |
| `~/.agenticx/hooks/config.yaml`  | Phase 1 统一到 `~/.agenticx/config.yaml`   |
| `agenticx/core/agent_builder.py` | Phase 2 可复用其 YAML→Agent 逻辑              |


