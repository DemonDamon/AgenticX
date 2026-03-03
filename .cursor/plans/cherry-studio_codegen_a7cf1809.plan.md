---
name: cherry-studio codegen
overview: 将 Cherry Studio 的 4 个可迁移机制内化到 AgenticX：P0 MCPHub 多连接聚合、P1a .agents/skills 目录支持、P1b AgentPreset 系统、P1c 知识库意图识别，并附 P2 skills_sync 工具。每个功能点均有冒烟测试。
todos:
  - id: p0-mcp-hub
    content: 新建 agenticx/tools/mcp_hub.py：MCPHub 多连接聚合 + Auto Mode，含冒烟测试
    status: completed
  - id: p1a-agents-skills
    content: 修改 agenticx/tools/skill_bundle.py DEFAULT_SEARCH_PATHS 加 .agents/skills，含冒烟测试
    status: completed
  - id: p1b-preset
    content: 新建 agenticx/presets.py：AgentPreset + create_agent_from_preset，含冒烟测试
    status: completed
  - id: p1c-rag-intent
    content: 新建 agenticx/knowledge/search_orchestration.py：KnowledgeSearchOrchestrator + intent 模式，含冒烟测试
    status: completed
  - id: p2-skill-sync
    content: 新建 agenticx/tools/skill_sync.py：skills_sync / check_skills_sync，含冒烟测试
    status: completed
isProject: false
---

# Cherry Studio → AgenticX codegen 计划

## 功能点清单


| #   | 功能点                      | 优先级 | 上游证据                                                          | AgenticX 落点                                                     | 验收场景                                                           |
| --- | ------------------------ | --- | ------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | MCPHub 多连接聚合 + Auto Mode | P0  | `MCPService.ts:171,203`; Hub `list/inspect/invoke/exec`       | `agenticx/tools/mcp_hub.py`（新建）                                 | 2个 MCPClientV2 实例聚合工具列表；auto_mode 注入所有工具到 Agent                |
| 2   | .agents/skills 目录支持      | P1  | `.agents/skills/public-skills.txt`（源码验证）                      | `agenticx/tools/skill_bundle.py` 第165-170行 DEFAULT_SEARCH_PATHS | 扫描 `.agents/skills/` 目录发现技能，优先级高于 `.claude/skills/`            |
| 3   | AgentPreset 系统           | P1  | Cherry Studio AssistantPreset，`create_agent_from_preset`      | `agenticx/presets.py`（新建）                                       | 从 YAML 加载预设；`create_agent_from_preset(preset, model)` 生成 Agent |
| 4   | 知识库 RAG 意图识别             | P1  | `searchOrchestrationPlugin.ts`；`knowledgeRecognition: 'force' | 'intent'`                                                       | `agenticx/knowledge/search_orchestration.py`（新建）               |
| 5   | skills_sync 工具           | P2  | `scripts/skills-sync.ts`；`public-skills.txt`                  | `agenticx/tools/skill_sync.py`（新建）                              | 将 .agents/skills 中公开技能同步到 .claude/skills（文件复制非符号链接）            |


---

## 详细实现说明

### #1 — MCPHub（P0）

**新建** `[agenticx/tools/mcp_hub.py](agenticx/tools/mcp_hub.py)`

核心接口：

```python
class MCPHub:
    def __init__(self, clients: List[MCPClientV2]): ...
    async def discover_all_tools(self) -> List[MCPToolInfo]: ...
    async def call_tool(self, name: str, arguments: dict) -> Any: ...
    def get_tools_for_agent(self) -> List[BaseTool]: ...  # Auto Mode 入口

class MCPHubConfig(BaseModel):
    servers: List[MCPServerConfig]
    auto_mode: bool = False  # True 时所有工具自动注入 Agent
```

关键设计：

- `MCPHub` 持有 N 个 `MCPClientV2` 实例
- `discover_all_tools()` 并发调用各 client 的 `discover_tools()`，合并去重（`server_name.tool_name` 唯一键）
- `call_tool()` 按工具名路由到正确的 client
- 工具名冲突时：`{server_name}__{tool_name}` 加前缀，并记录 `_tool_routing` 映射
- `auto_mode=True` 时，`get_tools_for_agent()` 返回所有工具的 `RemoteToolV2` 包装

**冒烟测试** `tests/test_smoke_cherry_studio_mcp_hub.py`：

- 使用 Mock `MCPClientV2`（避免实际 MCP 服务器）
- Happy path：2个 client，各 2 个工具，合并为 4 个
- 冲突处理：同名工具加前缀
- 路由：call_tool 转发到正确 client

---

### #2 — .agents/skills 目录支持（P1）

**修改** `[agenticx/tools/skill_bundle.py](agenticx/tools/skill_bundle.py)` 第 164-170 行

```python
# 当前 DEFAULT_SEARCH_PATHS
DEFAULT_SEARCH_PATHS = [
    Path("./.agent/skills"),        # 现有
    Path.home() / ".agent" / "skills",
    Path("./.claude/skills"),       # 现有
    Path.home() / ".claude" / "skills",
]

# 修改后（插入 .agents/skills，优先级最高）
DEFAULT_SEARCH_PATHS = [
    Path("./.agents/skills"),       # 新增：Cherry Studio 约定（优先级最高）
    Path("./.agent/skills"),        # 保留向后兼容
    Path.home() / ".agents" / "skills",  # 新增：全局
    Path.home() / ".agent" / "skills",
    Path("./.claude/skills"),
    Path.home() / ".claude" / "skills",
]
```

**冒烟测试** `tests/test_smoke_cherry_studio_agents_skills.py`：

- 在 `.agents/skills/` 放置 SKILL.md，验证扫描发现
- `.agents/` 优先于 `.claude/` 同名技能

---

### #3 — AgentPreset 系统（P1）

**新建** `[agenticx/presets.py](agenticx/presets.py)`

核心接口：

```python
@dataclass
class AgentPreset:
    name: str
    role: str
    goal: str
    backstory: Optional[str] = None
    prompt: Optional[str] = None
    tool_names: List[str] = field(default_factory=list)
    settings: Dict[str, Any] = field(default_factory=dict)
    # 无 llm / llm_config_name —— 实例化时指定

def create_agent_from_preset(
    preset: AgentPreset,
    llm: Any,                     # LLM 实例
    llm_config_name: Optional[str] = None,
    **overrides,                  # 覆盖任意字段
) -> Agent: ...

def load_preset_from_yaml(path: Path) -> AgentPreset: ...
def load_preset_from_dict(data: dict) -> AgentPreset: ...
```

YAML 格式约定（与 SKILL.md 类似的 frontmatter 风格，或纯 YAML）：

```yaml
name: code-reviewer
role: Code Review Expert
goal: Review code for quality and bugs
tool_names: [file_read, code_analysis]
settings:
  temperature: 0.3
```

**冒烟测试** `tests/test_smoke_cherry_studio_preset.py`：

- 从 dict 加载预设，验证字段正确
- `create_agent_from_preset` 返回有效 `Agent`，llm 正确绑定
- 无 model 的预设不能直接调用（无 llm 时抛 ValueError）
- overrides 能覆盖字段

---

### #4 — 知识库 RAG 意图识别（P1）

**新建** `[agenticx/knowledge/search_orchestration.py](agenticx/knowledge/search_orchestration.py)`

核心接口：

```python
class KnowledgeRecognitionMode(str, Enum):
    FORCE = "force"    # 始终检索（Cherry Studio 'off'）
    INTENT = "intent"  # LLM 判断后按需检索（Cherry Studio 'on'）

@dataclass
class KnowledgeSearchResult:
    documents: List[Document]
    query_used: str
    mode: KnowledgeRecognitionMode
    intent_detected: bool  # intent 模式下是否触发了检索

class KnowledgeSearchOrchestrator:
    def __init__(
        self,
        knowledge: Knowledge,
        mode: KnowledgeRecognitionMode = KnowledgeRecognitionMode.FORCE,
        llm_provider: Optional[Any] = None,  # intent 模式需要
        intent_prompt_template: Optional[str] = None,
    ): ...

    async def search(
        self,
        user_message: str,
        top_k: int = 5,
    ) -> KnowledgeSearchResult: ...

    async def _analyze_intent(self, user_message: str) -> bool:
        """调用 LLM 判断是否需要检索（返回 True/False）"""
        ...
```

意图分析提示词（简化版 Cherry Studio 的 `SEARCH_SUMMARY_PROMPT`）：

```
You are deciding if knowledge base search is needed.
User message: {message}
Reply with XML: <need_search>true</need_search> or <need_search>false</need_search>
```

**冒烟测试** `tests/test_smoke_cherry_studio_rag_intent.py`：

- force 模式：始终调用 knowledge.search，不调用 LLM
- intent 模式 + LLM 返回 true：触发检索
- intent 模式 + LLM 返回 false：跳过检索，返回空文档
- LLM 不可用时 intent 模式 fallback 到 force

---

### #5 — skills_sync 工具（P2）

**新建** `[agenticx/tools/skill_sync.py](agenticx/tools/skill_sync.py)`

核心接口：

```python
def sync_skills(
    source_dir: Path,         # .agents/skills
    target_dir: Path,         # .claude/skills
    public_skills_file: Optional[Path] = None,  # public-skills.txt
) -> SyncResult: ...

def check_skills_sync(source_dir: Path, target_dir: Path, ...) -> CheckResult: ...

@dataclass
class SyncResult:
    synced: List[str]   # 已同步的技能名
    skipped: List[str]  # 跳过（未变更）
    errors: List[str]   # 出错的技能名
```

关键约束：使用 `shutil.copy2`（文件复制，非符号链接），跨平台安全。

**冒烟测试** `tests/test_smoke_cherry_studio_skills_sync.py`：

- 全量同步：source 有 3 个技能，全部复制到 target
- 增量：target 已存在且内容相同，跳过
- public-skills.txt 过滤：只同步声明为公开的技能
- 覆盖：target 内容不同时覆盖

---

## 需要修改的文件汇总


| 文件                                                | 类型  | 说明                                    |
| ------------------------------------------------- | --- | ------------------------------------- |
| `agenticx/tools/mcp_hub.py`                       | 新建  | MCPHub 主体                             |
| `agenticx/tools/skill_sync.py`                    | 新建  | skills_sync 工具                        |
| `agenticx/presets.py`                             | 新建  | AgentPreset 系统                        |
| `agenticx/knowledge/search_orchestration.py`      | 新建  | RAG 意图识别                              |
| `agenticx/tools/skill_bundle.py`                  | 修改  | DEFAULT_SEARCH_PATHS 加 .agents/skills |
| `agenticx/tools/__init__.py`                      | 修改  | 导出 MCPHub、SkillSync                   |
| `agenticx/knowledge/__init__.py`                  | 修改  | 导出 KnowledgeSearchOrchestrator        |
| `tests/test_smoke_cherry_studio_mcp_hub.py`       | 新建  |                                       |
| `tests/test_smoke_cherry_studio_agents_skills.py` | 新建  |                                       |
| `tests/test_smoke_cherry_studio_preset.py`        | 新建  |                                       |
| `tests/test_smoke_cherry_studio_rag_intent.py`    | 新建  |                                       |
| `tests/test_smoke_cherry_studio_skills_sync.py`   | 新建  |                                       |


