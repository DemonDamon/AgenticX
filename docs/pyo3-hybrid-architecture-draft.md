# AgenticX PyO3 混合架构草案

> **版本**: v0.1  
> **日期**: 2025-06-26  
> **作者**: 芬克斯 (AgenticX 和创项目)  
> **状态**: 草案 / 待评审  

---

## 1. 文档目标

本草案基于对 AgenticX `v0.3.9` 真实源码的深度分析，提出一套 **Python + Rust (PyO3)** 混合架构迁移方案。目标是在保持现有 Python API 和生态兼容性的前提下，将核心性能瓶颈下沉到 Rust 层，实现：

- **执行引擎提速**：图遍历、事件总线、Token 预算、上下文压缩等高频 CPU 路径 Rust 化
- **内存效率提升**：减少大规模 Agent 运行时的事件日志和图状态内存占用
- **保持向后兼容**：Python 层 API 不变，Rust 扩展作为可选加速模块
- **渐进式迁移**：分阶段替换，风险可控

---

## 2. 源码模块分层分析

基于对以下核心模块的源码级分析，按 **Rust 迁移价值** 和 **Python 生态依赖度** 两个维度进行分层：

| 模块 | 文件大小 | 核心职责 | 高频 CPU 路径 | Python 生态依赖 | Rust 迁移建议 |
|------|---------|---------|-------------|--------------|-------------|
| `graph.py` | ~14 KB | 图执行引擎（节点定义、边连接、拓扑排序、async 调度） | 类型反射（`get_type_hints`）、边校验、图遍历、状态合并 | 中（节点执行体为 Python async 函数） | **Phase 1 — 核心候选** |
| `executor.py` | ~20 KB | 工具执行引擎（沙箱、重试、资源监控、并发限制） | 重试计数、超时计时、并发配额管理、指标聚合 | **高**（依赖 `subprocess`、`asyncio`、信号、`psutil`） | **Phase 3 — 部分可迁移** |
| `context_compiler.py` | ~20 KB | 上下文编译（事件压缩、摘要、token 估算、策略选择） | 事件遍历过滤、token 计数累加、启发式打分 | 中（LLM 摘要仍走 Python） | **Phase 1 — 核心候选** |
| `event_bus.py` | ~4.5 KB | 事件总线（pub-sub、通配符匹配、历史回放） | 事件路由查找、handler 匹配、通配符解析 | 中（handler 为 Python 函数） | **Phase 1 — 核心候选** |
| `token_budget.py` | ~5.7 KB | 会话级 Token 预算管理 | 原子计数、阈值比较、成本累加 | 低 | **Phase 1 — 核心候选** |
| `token_counter.py` | ~11 KB | Token 精确计数（tiktoken 封装） | 编码分词、长度计算 | **高**（直接依赖 `tiktoken` C 扩展） | **Phase 2 — 保留 Python 包装层** |
| `event.py` | ~12 KB | 事件类型定义、EventLog 状态管理 | 事件追加、快照生成、压缩标记 | 中（Pydantic 模型） | **Phase 2 — 部分可迁移** |
| `agent.py` | ~13 KB | Agent 模型（配置、工具绑定、LLM 路由） | 无显著 CPU 热点 | **高**（Pydantic、动态工具绑定） | **保留 Python** |
| `task_scheduler.py` | ~3 KB | 后台任务调度 | 任务注册、取消、字典维护 | 低 | **Phase 2 — 可选迁移** |

### 2.1 关键结论

1. **Phase 1 核心 Rust 层（4个模块）**：`graph`、`event_bus`、`token_budget`、`context_compiler` 的数据结构和纯计算逻辑完全可以在 Rust 中重写，Python 层仅保留 async I/O 和 LLM 调用胶水。
2. **`executor.py` 高度绑定 Python 运行时**：沙箱（`subprocess`、信号）、资源监控（`psutil`）与操作系统 API 耦合紧密，建议保留 Python 层，仅将**重试计数器、并发配额、指标聚合**下沉到 Rust。
3. **`token_counter.py` 已使用 C 扩展**：`tiktoken` 本身是 Rust 编写的 Python C 扩展，Python 层仅为降级和成本估算包装，迁移价值有限。
4. **`agent.py` 和 Pydantic 模型层**：配置验证、动态字段、工具反射依赖 Pydantic 生态，短期内保留 Python。

---

## 3. Rust 加速层范围

### 3.1 纳入 Rust 层的模块（按优先级排序）

```
┌─────────────────────────────────────────────────────────────┐
│  Rust 加速层 (agenticx-core-rs)                              │
│  ─────────────────────────────                               │
│  ├─ graph_engine     :: 图拓扑 + 节点调度 + 状态管理           │
│  ├─ event_bus        :: 事件路由 + 通配符匹配 + 历史索引        │
│  ├─ token_budget     :: 原子计数 + 预算检查 + 成本累加          │
│  ├─ context_compiler :: 事件过滤 + 启发式压缩 + token 估算       │
│  └─ metrics_agg      :: 执行指标聚合 + 滑动窗口统计             │
└─────────────────────────────────────────────────────────────┘
                              │ PyO3 绑定
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Python 保留层 (agenticx)                                    │
│  ─────────────────────────                                   │
│  ├─ agent.py         :: Agent 模型 + Pydantic 配置            │
│  ├─ executor.py      :: 沙箱 + 子进程 + 资源监控              │
│  ├─ token_counter.py :: tiktoken 包装 + 成本估算              │
│  ├─ llms/            :: LLM 客户端 + 流式处理                 │
│  ├─ tools/           :: 工具定义 + 动态加载                   │
│  └─ hooks/           :: 钩子系统                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 各模块 Rust 化详细设计

#### 3.2.1 `graph_engine`（图执行引擎）

**Python 层热点分析**（源自 `graph.py` 源码）：
- `get_type_hints()` 在运行时反复进行类型反射，解析节点入参/出参类型
- `Edge.from_node / to_node` 的字符串到类型的动态查找
- `GraphRunContext` 中的状态字典合并（`dict.update` 在大量节点时开销显著）
- 拓扑排序和依赖解析（纯算法，无 I/O）

**Rust 层职责**：
```rust
// crates/agenticx-core-rs/src/graph/mod.rs
pub struct GraphDef {
    nodes: HashMap<String, NodeMeta>,
    edges: Vec<EdgeDef>,
    adjacency: HashMap<String, Vec<String>>,
}

pub struct GraphRunContext {
    state: Arc<Mutex<HashMap<String, PyObject>>>, // Python 对象透传
    visited: HashSet<String>,
}

impl GraphDef {
    /// 纯 Rust：拓扑排序 + 依赖检查（替代 Python 的 toposort）
    pub fn topo_sort(&self) -> Result<Vec<&str>, GraphError>;
    
    /// 纯 Rust：运行时类型兼容性预校验（替代重复的 get_type_hints）
    pub fn validate_edges(&self) -> Result<(), GraphError>;
    
    /// 边界：调度下一个可执行节点，实际执行仍回调 Python async
    pub fn next_ready_nodes(&self, ctx: &GraphRunContext) -> Vec<&str>;
}
```

**Python 保留部分**：
- `BaseNode.execute()` — 节点执行体为 Python async 函数，涉及 I/O 和 LLM 调用
- `Graph.run()` 的 async 事件循环协调

#### 3.2.2 `event_bus`（事件总线）

**Python 层热点分析**（源自 `event_bus.py` 源码）：
- `_handlers: dict[type, list[callable]]` 的查找和追加
- `emit()` 中遍历 handler 列表并判断 sync/async
- `WildcardHandler` 的字符串通配符匹配（`*UserEvent` → 正则匹配）
- `_history` 列表的增长和快照截取

**Rust 层职责**：
```rust
pub struct EventBus {
    handlers: HashMap<String, Vec<PyObject>>,  // event_type -> handlers
    wildcard_tree: WildcardTrie,                // 通配符索引
    history: RwLock<Vec<Arc<EventRecord>>>,
}

impl EventBus {
    /// O(1) 精确匹配 + O(k) 通配符匹配（k = 通配符规则数）
    pub fn resolve_handlers(&self, event_type: &str) -> Vec<PyObject>;
    
    /// 线程安全的只读历史切片
    pub fn get_history_slice(&self, start: usize, end: usize) -> Vec<Arc<EventRecord>>;
}
```

**Python 保留部分**：
- Handler 函数体本身（业务逻辑）
- `emit()` 中的 `inspect.iscoroutinefunction` 判断 → Rust 返回 handler 列表后由 Python 层分发

#### 3.2.3 `token_budget`（Token 预算）

**Python 层热点分析**（源自 `token_budget.py` 源码）：
- `TokenBudgetGuard` 在每次 LLM 调用前后执行 `self.total_tokens += n`
- 阈值比较和警告触发（纯数值运算）
- `is_exceeded()` 的布尔判断

**Rust 层职责**：
```rust
pub struct TokenBudgetGuard {
    total_tokens: AtomicUsize,
    budget_limit: usize,
    warning_threshold: f64,
    model_pricing: HashMap<String, f64>,
}

impl TokenBudgetGuard {
    /// 原子累加，无锁
    pub fn add_tokens(&self, n: usize) -> BudgetStatus;
    pub fn check_budget(&self) -> BudgetStatus;
    pub fn estimate_cost(&self, model: &str) -> f64;
}
```

此模块逻辑最简单，迁移价值最高（高频调用 + 纯数值），适合作为 **PoC 验证模块**。

#### 3.2.4 `context_compiler`（上下文编译器）

**Python 层热点分析**（源自 `context_compiler.py` 源码）：
- `ContextCompiler.compile()` 遍历完整事件日志（`for event in events:`）
- `FastHeuristicCompressor` 的启发式打分（事件类型权重、时间衰减）
- `EventSummarizer` 的 token 计数累加和截断判断
- 策略选择逻辑（纯条件判断）

**Rust 层职责**：
```rust
pub struct ContextCompiler {
    strategy: CompressionStrategy,
    max_tokens: usize,
    event_weights: HashMap<String, f32>,
}

impl ContextCompiler {
    /// 纯 Rust：事件过滤 + 排序 + 启发式打分
    pub fn filter_events(&self, events: &[EventRecord]) -> Vec<&EventRecord>;
    
    /// 纯 Rust：token 预算截断（二分查找最优截断点）
    pub fn truncate_to_budget(&self, events: &[EventRecord], token_fn: &dyn Fn(&EventRecord) -> usize) -> Vec<&EventRecord>;
    
    /// 边界：LLM 摘要仍回调 Python
    pub fn summarize_batch(&self, events: &[EventRecord]) -> PyResult<String>;
}
```

**Python 保留部分**：
- `LLMEventSummarizer.summarize()` — 需要调用 LLM API
- `TokenCounter` 的精确计数（已用 tiktoken，无需迁移）

---

## 4. PyO3 绑定接口设计

### 4.1 项目结构

```
agenticx/
├── agenticx/                      # Python 包（保留）
│   ├── core/
│   │   ├── graph.py              # 包装层：导入 Rust GraphDef
│   │   ├── event_bus.py          # 包装层：导入 Rust EventBus
│   │   ├── token_budget.py       # 包装层：导入 Rust TokenBudgetGuard
│   │   ├── context_compiler.py   # 包装层：导入 Rust ContextCompiler
│   │   └── ...
│   └── _core_rs.pyi              # Rust 扩展的类型存根
│
├── crates/
│   └── agenticx-core-rs/         # Rust workspace
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs            # PyO3 模块入口
│       │   ├── graph/
│       │   ├── event_bus/
│       │   ├── token_budget/
│       │   ├── context_compiler/
│       │   └── common/           # 共享类型（EventRecord、PyObject 透传）
│       └── tests/
│
├── pyproject.toml                # 添加 maturin 构建后端
└── docs/pyo3-hybrid-architecture-draft.md
```

### 4.2 `pyproject.toml` 构建配置

```toml
[build-system]
requires = ["maturin>=1.0,<2.0"]
build-backend = "maturin"

[project]
name = "agenticx"
version = "0.3.9"
# ... 现有配置保持不变 ...

[project.optional-dependencies]
# 现有 deps 不变
rust-accel = ["agenticx-core-rs"]  # 可选 Rust 加速依赖

[tool.maturin]
manifest-path = "crates/agenticx-core-rs/Cargo.toml"
python-source = "agenticx"
module-name = "agenticx._core_rs"
```

### 4.3 核心绑定代码示例

#### 4.3.1 Rust 侧（`lib.rs`）

```rust
use pyo3::prelude::*;

mod graph;
mod event_bus;
mod token_budget;
mod context_compiler;

#[pymodule]
fn _core_rs(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<graph::GraphDef>()?;
    m.add_class::<graph::GraphRunContext>()?;
    m.add_class::<event_bus::EventBus>()?;
    m.add_class::<token_budget::TokenBudgetGuard>()?;
    m.add_class::<context_compiler::ContextCompiler>()?;
    Ok(())
}
```

#### 4.3.2 Python 包装层（`graph.py`）

```python
"""图执行引擎 — Python 包装层，底层调用 Rust GraphDef"""

try:
    from agenticx._core_rs import GraphDef as _GraphDef, GraphRunContext as _GraphRunContext
    _HAS_RUST = True
except ImportError:
    _HAS_RUST = False

class Graph:
    def __init__(self, name: str = "default"):
        self.name = name
        if _HAS_RUST:
            self._inner = _GraphDef()
        else:
            self._inner = None
            self.nodes: dict[str, BaseNode] = {}
            self._node_defs: dict[str, NodeDef] = {}
    
    def add_edge(self, edge: "Edge") -> "Graph":
        if _HAS_RUST and self._inner is not None:
            self._inner.add_edge(edge.from_node, edge.to_node, edge.key)
        else:
            # 回退到纯 Python 实现
            self._add_edge_py(edge)
        return self
    
    async def run(self, ctx: GraphRunContext) -> GraphRunResult:
        if _HAS_RUST and self._inner is not None:
            # Rust 负责拓扑排序和调度，Python 负责节点执行
            schedule = self._inner.topo_sort()
            for node_id in schedule:
                node = self.nodes[node_id]
                result = await node.execute(ctx)
                ctx.state[node_id] = result
            return GraphRunResult(state=ctx.state)
        else:
            return await self._run_py(ctx)
```

#### 4.3.3 Python 包装层（`token_budget.py`）

```python
"""Token 预算管理 — Python 包装层"""

try:
    from agenticx._core_rs import TokenBudgetGuard as _TokenBudgetGuard
    _HAS_RUST = True
except ImportError:
    _HAS_RUST = False

class TokenBudgetGuard:
    def __init__(self, budget_limit: int, warning_threshold: float = 0.8):
        if _HAS_RUST:
            self._inner = _TokenBudgetGuard(budget_limit, warning_threshold)
        else:
            self._inner = None
            self.total_tokens = 0
            self.budget_limit = budget_limit
            self.warning_threshold = warning_threshold
    
    def add_tokens(self, n: int) -> None:
        if _HAS_RUST and self._inner is not None:
            status = self._inner.add_tokens(n)
            if status.is_warning:
                logger.warning(f"Token budget at {status.percentage:.1%}")
            if status.is_exceeded:
                raise TokenBudgetExceeded(f"Budget {self.budget_limit} exceeded")
        else:
            self.total_tokens += n
            # ... 原有逻辑 ...
```

### 4.4 数据透传策略

Rust 层不解析 Python 对象的内部结构，仅做 **句柄透传** 和 **元数据索引**：

| 数据类型 | Rust 层处理方式 | 示例 |
|---------|--------------|------|
| 事件对象 | 透传 `PyObject` 句柄，Rust 仅维护索引和元数据 | `EventRecord { py_obj: PyObject, timestamp: u64, event_type: String }` |
| 图状态 | 透传 `PyObject`，Rust 维护节点 ID → 状态的映射关系 | `state: HashMap<String, PyObject>` |
| Handler 函数 | 透传 `PyObject`（`PyCallable`），Rust 负责匹配和返回 | `handlers: Vec<PyObject>` |
| 配置结构 | 在 Rust 侧重建轻量副本（避免跨语言频繁访问） | `TokenBudgetGuard { limit: usize, ... }` |

---

## 5. 构建与发布流程

### 5.1 本地开发构建

```bash
# 1. 安装 maturin
pip install maturin

# 2. 进入 Rust crate
cd crates/agenticx-core-rs

# 3. 开发模式构建（自动链接到当前 Python 环境）
maturin develop --release

# 4. 运行 Python 测试（验证绑定正确性）
cd ../..
pytest tests/core/test_graph.py -v
pytest tests/core/test_token_budget.py -v
```

### 5.2 CI/CD 多平台 Wheel 构建

```yaml
# .github/workflows/build-rust.yml
name: Build Rust Extension
on: [push, pull_request]

jobs:
  build-wheels:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        python: ['3.10', '3.11', '3.12', '3.13']
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}
      - uses: PyO3/maturin-action@v1
        with:
          command: build
          args: --release --strip --interpreter python${{ matrix.python }}
          working-directory: crates/agenticx-core-rs
      - uses: actions/upload-artifact@v4
        with:
          name: wheels-${{ matrix.os }}-${{ matrix.python }}
          path: crates/agenticx-core-rs/target/wheels/*.whl
```

### 5.3 发布策略

| 场景 | 行为 |
|------|------|
| 用户 `pip install agenticx` | 仅安装纯 Python 包，无 Rust 依赖 |
| 用户 `pip install agenticx[rust-accel]` | 安装对应平台的预编译 wheel |
| 无预编译 wheel 的平台 | 从源码构建（需 Rust toolchain） |
| Rust 扩展导入失败 | 自动降级到纯 Python 实现，打印 `INFO` 日志 |

---

## 6. 迁移路线图

### Phase 1：核心性能层（预计 4-6 周）

**目标模块**：`token_budget` → `event_bus` → `context_compiler` → `graph`

1. **Week 1-2**：搭建 Rust workspace + PyO3 绑定基础设施
   - 创建 `crates/agenticx-core-rs`
   - 配置 `maturin` + CI 多平台构建
   - 编写 `agenticx._core_rs` 类型存根（`.pyi`）

2. **Week 2-3**：`token_budget` Rust 化（PoC）
   - 逻辑最简单，验证 PyO3 绑定流程
   - 编写 Python 回退逻辑
   - 基准测试：对比纯 Python vs Rust 版的 `add_tokens()` 吞吐量

3. **Week 3-4**：`event_bus` Rust 化
   - 重点：通配符 Trie 索引、线程安全的历史切片
   - Python 保留：handler 函数调用和 async 分发

4. **Week 4-5**：`context_compiler` Rust 化
   - 重点：事件过滤、启发式打分、二分截断
   - Python 保留：LLM 摘要调用

5. **Week 5-6**：`graph` Rust 化
   - 重点：拓扑排序、类型预校验、状态索引
   - Python 保留：`BaseNode.execute()` 的 async 执行

### Phase 2：扩展优化层（预计 3-4 周）

**目标模块**：`event.py`（EventLog 存储优化）、`task_scheduler`（调度队列）

- `EventLog`：将 Python `list[Event]` 的追加和快照改为 Rust `Vec<Arc<EventRecord>>`
- `task_scheduler`：调度队列和取消标记 Rust 化

### Phase 3：边界渗透层（预计 4-6 周，可选）

**目标模块**：`executor.py` 的部分逻辑

- `ExecutionMetrics`：指标聚合和滑动窗口统计 Rust 化
- `ResourceMonitor` 的阈值判断逻辑 Rust 化（实际资源采集仍走 Python/psutil）
- 重试计数器和退避算法 Rust 化

### Phase 4：生态完善（持续）

- 编写完整的 Rust 层单元测试（`cargo test`）
- Python 集成测试覆盖回退逻辑
- 文档和性能基准报告
- 考虑 `pydantic-core` 模式：为 Agent 模型提供 Rust 验证后端（长期）

---

## 7. 风险与限制

### 7.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| PyO3 绑定引入 GIL 瓶颈 | Rust 代码仍需获取 GIL 才能操作 Python 对象 | 最小化 GIL 持有时间；Rust 层内部计算释放 GIL（`py.allow_threads`） |
| 跨语言调试困难 | Stack trace 断裂，内存问题难以定位 | 完善日志埋点；使用 `pyo3::exceptions` 透传错误；Valgrind/rr 调试 |
| 构建复杂度增加 | 开发者需安装 Rust toolchain；CI 构建时间延长 | 提供预编译 wheel；文档化开发环境搭建；CI 缓存 `target/` |
| API 兼容性断裂 | Rust 结构体与 Python Pydantic 模型字段不匹配 | 使用 Python 包装层做字段映射；版本化 Rust API；集成测试覆盖 |
| 内存安全与 Python GC 交互 | Rust `PyObject` 引用计数管理不当导致泄漏或崩溃 | 遵循 PyO3 所有权规则；使用 `Bound<'_, T>` API；MIri 检测 |

### 7.2 设计限制

1. **异步执行保留在 Python**：`asyncio` 事件循环和 LLM 异步客户端（`httpx`、`openai`）难以在 Rust 中替代，Rust 层仅做同步计算 + 回调。
2. **Pydantic 模型保留**：`Agent`、`Event` 等配置/数据模型的验证和序列化继续由 Pydantic 处理，Rust 层操作的是轻量副本或句柄。
3. **工具执行保留**：`subprocess`、沙箱、信号处理与操作系统强耦合，Rust 层替代价值有限。
4. **tiktoken 已是 C 扩展**：`token_counter.py` 的核心分词逻辑已在 C/Rust 层，Python 层仅为成本估算包装。

### 7.3 性能预期

基于源码分析中识别的高频路径，预期 Rust 化后的性能提升：

| 模块 | 高频操作 | 当前 Python 开销 | Rust 化后预期 | 提升倍数 |
|------|---------|----------------|-------------|---------|
| `token_budget` | `add_tokens()` | 属性访问 + 整数加法 + 条件判断 | 原子操作 + 分支预测 | **5-10x** |
| `event_bus` | `emit()` 路由 | dict 查找 + 列表遍历 + 通配符正则 | HashMap + Trie 索引 | **3-5x** |
| `context_compiler` | `compile()` 遍历 | Python for-loop + 条件判断 + 函数调用 | Rust 迭代器 + 向量化 | **2-4x** |
| `graph` | `topo_sort()` | `get_type_hints()` + dict 操作 | 预编译元数据 + Vec 排序 | **2-3x** |

> 注：实际提升取决于 Agent 工作负载特征。I/O 密集型任务（大量 LLM 调用）提升有限；CPU 密集型任务（大量事件处理、复杂图结构）提升显著。

---

## 8. 附录：源码引用索引

本文档分析基于以下文件的源码快照（AgenticX v0.3.9）：

- `agenticx/core/graph.py` — 图执行引擎（~14 KB）
- `agenticx/core/executor.py` — 工具执行引擎（~20 KB）
- `agenticx/core/task_scheduler.py` — 任务调度器（~3 KB）
- `agenticx/core/token_budget.py` — Token 预算管理（~5.7 KB）
- `agenticx/core/context_compiler.py` — 上下文编译器（~20 KB）
- `agenticx/core/event_bus.py` — 事件总线（~4.5 KB）
- `agenticx/core/token_counter.py` — Token 计数器（~11 KB）
- `agenticx/core/event.py` — 事件类型与 EventLog（~12 KB）
- `agenticx/core/agent.py` — Agent 模型（~13 KB）
- `pyproject.toml` — 项目配置与依赖

---

## 9. 评审 Checklist

- [ ] Rust 层模块划分是否合理？是否遗漏了更高价值的模块？
- [ ] PyO3 绑定接口是否覆盖了所有 Python 层调用点？
- [ ] 回退逻辑（`_HAS_RUST = False`）是否在所有模块中一致实现？
- [ ] CI 多平台构建配置是否覆盖了目标用户的主要平台？
- [ ] 性能基准测试方案是否可量化验证迁移价值？
- [ ] 文档是否足够让新开发者理解混合架构的边界？
