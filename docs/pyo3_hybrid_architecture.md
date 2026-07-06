# AgenticX PyO3 混合架构方案

> 目标：在保持 Python 生态兼容的前提下，将计算密集型、高频调用、状态管理类模块逐步迁移至 Rust，通过 PyO3 提供零成本 Python 绑定。

---

## 1. 项目结构总览

```
agenticx/
├── core/              # Agent 生命周期、消息路由、执行引擎
├── hooks/             # 声明式 Hook、LLM Hook、Tool Hook、注册表
├── tools/             # 工具基类、MCP Hub、执行器、安全策略、远程调用
├── memory/            # 多层级记忆（短期/语义/情景/工作区）、混合搜索、压缩
├── workflows/         # 工作流编排、条件路由、并行执行
├── llm/               # LLM 调用层、Provider 抽象、流式处理
├── knowledge/         # 知识库、向量存储、文档解析
└── utils/             # 通用工具、配置、日志
```

**核心特征**：
- 纯 Python 项目，无现有 Rust 代码
- 重度依赖异步（asyncio）和 pydantic 模型校验
- 高频路径：工具调用 → 执行器 → 安全策略 → MCP Hub → 远程调用
- 记忆系统涉及大量向量检索、相似度计算、数据压缩

---

## 2. 模块 Rust 化可行性与收益评估

### 2.1 优先级矩阵

| 模块 | 优先级 | 收益 | 复杂度 | 理由 |
|------|--------|------|--------|------|
| `memory/hybrid_search` | P0 | ⭐⭐⭐⭐⭐ | 中 | 向量检索、BM25、相似度计算是 CPU 密集型，Rust 可提升 5-10x |
| `tools/executor` | P0 | ⭐⭐⭐⭐⭐ | 中 | 工具调用频率极高，参数校验+路由可用 Rust 加速 |
| `memory/compaction_flush` | P1 | ⭐⭐⭐⭐ | 低 | 数据压缩/序列化，Rust 有成熟 crate |
| `hooks/registry` | P1 | ⭐⭐⭐⭐ | 低 | Hook 匹配是字典查找+模式匹配，Rust 更快 |
| `workflows/engine` | P1 | ⭐⭐⭐⭐ | 高 | 图遍历、条件路由，但需保留 Python 回调 |
| `tools/security` | P2 | ⭐⭐⭐ | 中 | 策略引擎，规则匹配可 Rust 化 |
| `knowledge/vector_store` | P2 | ⭐⭐⭐ | 高 | 依赖外部向量 DB，Rust 层收益有限 |
| `core/message_router` | P3 | ⭐⭐ | 高 | 与 Python asyncio 深度耦合，迁移成本高 |
| `llm/provider` | P3 | ⭐⭐ | 高 | 主要是 I/O 等待，CPU 收益小 |

### 2.2 预期收益量化

| 场景 | 当前 Python | 预期 Rust | 提升 |
|------|-------------|-----------|------|
| 混合搜索（10k 文档） | ~120ms | ~15ms | 8x |
| Hook 注册表查找（1k hooks） | ~5ms | ~0.3ms | 15x |
| 工具参数校验 | ~8ms | ~1ms | 8x |
| 记忆压缩（1MB 数据） | ~200ms | ~30ms | 6x |
| 工作流图遍历 | ~50ms | ~10ms | 5x |

---

## 3. PyO3 绑定接口设计

### 3.1 项目布局

```
agenticx/
├── python/                    # 现有 Python 代码
├── crates/
│   ├── ax-memory/             # 记忆系统 Rust 核心
│   ├── ax-executor/           # 工具执行器 Rust 核心
│   ├── ax-hooks/              # Hook 注册表 Rust 核心
│   └── ax-workflow/           # 工作流引擎 Rust 核心
├── Cargo.toml                 # Workspace 定义
├── pyproject.toml             # maturin 构建配置
└── src/lib.rs                 # PyO3 模块入口
```

### 3.2 Cargo.toml (Workspace)

```toml
[workspace]
members = ["crates/*"]
resolver = "2"

[workspace.dependencies]
pyo3 = { version = "0.22", features = ["extension-module", "abi3-py39"] }
pyo3-asyncio = { version = "0.22", features = ["tokio-runtime"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.40", features = ["full"] }
parking_lot = "0.12"
rayon = "1.10"
```

### 3.3 pyproject.toml (Maturin)

```toml
[build-system]
requires = ["maturin>=1.7"]
build-backend = "maturin"

[project]
name = "agenticx-rs"
version = "0.1.0"
description = "Rust acceleration core for AgenticX"
requires-python = ">=3.9"

[tool.maturin]
manifest-path = "Cargo.toml"
python-source = "python"
module-name = "agenticx._internal"
```

### 3.4 核心模块绑定设计

#### 3.4.1 混合搜索 (ax-memory)

```rust
// crates/ax-memory/src/search.rs
use pyo3::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub doc_id: String,
    pub score: f64,
    pub metadata: serde_json::Value,
}

#[pyclass]
pub struct HybridSearcher {
    index: tantivy::Index,
    vector_store: Arc<VectorStore>,
    alpha: f64, // 混合权重
}

#[pymethods]
impl HybridSearcher {
    #[new]
    fn new(index_path: &str, alpha: f64) -> PyResult<Self> { ... }

    /// 添加文档到索引
    fn add_document(&mut self, doc_id: &str, text: &str, vector: Vec<f32>) -> PyResult<()> { ... }

    /// 混合搜索：BM25 + 向量相似度
    fn search(&self, query: &str, query_vector: Vec<f32>, top_k: usize) -> PyResult<Vec<SearchResult>> {
        // Rust 内部并行计算
        let bm25_results = self.bm25_search(query, top_k * 2)?;
        let vector_results = self.vector_search(&query_vector, top_k * 2)?;
        let merged = self.merge_results(bm25_results, vector_results, self.alpha);
        Ok(merged.into_iter().take(top_k).collect())
    }

    /// 批量搜索（利用 Rayon 并行）
    fn search_batch(&self, queries: Vec<(String, Vec<f32>)>, top_k: usize) -> PyResult<Vec<Vec<SearchResult>>> {
        Ok(queries.into_par_iter()
            .map(|(q, v)| self.search(&q, v, top_k).unwrap())
            .collect())
    }

    fn save(&self, path: &str) -> PyResult<()> { ... }
    fn load(&mut self, path: &str) -> PyResult<()> { ... }
}
```

**Python 侧包装**（保持 API 兼容）：

```python
# agenticx/memory/hybrid_search.py
from agenticx._internal import HybridSearcher as _HybridSearcher

class HybridSearcher:
    """Python 包装器，保持原有 API 不变"""
    def __init__(self, index_path: str, alpha: float = 0.5):
        self._inner = _HybridSearcher(index_path, alpha)

    def search(self, query: str, query_vector: list[float], top_k: int = 10) -> list[SearchResult]:
        raw = self._inner.search(query, query_vector, top_k)
        return [SearchResult.from_raw(r) for r in raw]

    async def search_async(self, query: str, query_vector: list[float], top_k: int = 10) -> list[SearchResult]:
        # 在线程池中执行 Rust 代码，避免阻塞 asyncio
        return await asyncio.get_event_loop().run_in_executor(
            None, self._inner.search, query, query_vector, top_k
        )
```

#### 3.4.2 工具执行器 (ax-executor)

```rust
// crates/ax-executor/src/lib.rs
use pyo3::prelude::*;
use std::collections::HashMap;

#[pyclass]
pub struct ToolExecutor {
    registry: HashMap<String, PyObject>, // tool_name -> Python callable
    policy_engine: PolicyEngine,
    timeout_ms: u64,
}

#[pymethods]
impl ToolExecutor {
    #[new]
    fn new(timeout_ms: u64) -> Self { ... }

    /// 注册 Python 工具（保持 Python 生态兼容）
    fn register_tool(&mut self, name: &str, handler: PyObject) {
        self.registry.insert(name.to_string(), handler);
    }

    /// 执行工具调用（Rust 负责路由+策略，Python 负责实际执行）
    fn execute(&self, py: Python, tool_name: &str, args: &str) -> PyResult<PyObject> {
        // 1. Rust 层快速参数校验
        let parsed: serde_json::Value = serde_json::from_str(args)
            .map_err(|e| pyo3::exceptions::PyValueError::new_err(e.to_string()))?;

        // 2. Rust 层策略检查（权限、速率限制等）
        self.policy_engine.check(tool_name, &parsed)
            .map_err(|e| pyo3::exceptions::PyPermissionError::new_err(e))?;

        // 3. 调用 Python 工具实现
        let handler = self.registry.get(tool_name)
            .ok_or_else(|| pyo3::exceptions::PyKeyError::new_err(tool_name))?;

        handler.call1(py, (args,))
    }

    /// 批量执行（并行）
    fn execute_batch(&self, py: Python, calls: Vec<(String, String)>) -> PyResult<Vec<PyObject>> {
        calls.into_iter()
            .map(|(name, args)| self.execute(py, &name, &args))
            .collect()
    }
}
```

#### 3.4.3 Hook 注册表 (ax-hooks)

```rust
// crates/ax-hooks/src/registry.rs
use pyo3::prelude::*;
use parking_lot::RwLock;

#[pyclass]
pub struct HookRegistry {
    hooks: RwLock<Vec<HookDef>>, // 读写锁，高并发安全
    index: RwLock<HookIndex>,    // 预构建的查找索引
}

#[derive(Clone)]
struct HookDef {
    name: String,
    event_pattern: String,
    priority: i32,
    handler: PyObject,
}

#[pymethods]
impl HookRegistry {
    #[new]
    fn new() -> Self { ... }

    fn register(&self, name: &str, pattern: &str, priority: i32, handler: PyObject) -> PyResult<()> {
        let mut hooks = self.hooks.write();
        let mut index = self.index.write();
        hooks.push(HookDef { name: name.to_string(), event_pattern: pattern.to_string(), priority, handler });
        index.rebuild(&hooks);
        Ok(())
    }

    /// 根据事件匹配 Hook（Rust 层 O(1) 索引查找）
    fn match_hooks(&self, py: Python, event_type: &str, payload: &str) -> PyResult<Vec<PyObject>> {
        let index = self.index.read();
        let matched = index.query(event_type);

        // 按优先级排序返回
        let mut results: Vec<_> = matched.iter()
            .map(|&idx| self.hooks.read()[idx].clone())
            .collect();
        results.sort_by_key(|h| -h.priority);

        Ok(results.into_iter().map(|h| h.handler).collect())
    }
}
```

#### 3.4.4 工作流引擎 (ax-workflow)

```rust
// crates/ax-workflow/src/engine.rs
use pyo3::prelude::*;
use petgraph::graph::DiGraph;

#[pyclass]
pub struct WorkflowEngine {
    graph: DiGraph<NodeDef, EdgeCondition>,
    node_handlers: HashMap<String, PyObject>,
}

#[pymethods]
impl WorkflowEngine {
    #[new]
    fn new() -> Self { ... }

    fn add_node(&mut self, node_id: &str, node_type: &str, handler: Option<PyObject>) { ... }
    fn add_edge(&mut self, from: &str, to: &str, condition: Option<String>) { ... }

    /// 执行工作流（Rust 负责图遍历，Python 负责节点逻辑）
    fn execute(&self, py: Python, initial_input: &str) -> PyResult<String> {
        let mut current = self.find_start_node()?;
        let mut context: serde_json::Value = serde_json::from_str(initial_input).unwrap_or_default();

        while let Some(node) = current {
            // 调用 Python 节点处理器
            if let Some(handler) = self.node_handlers.get(&node.id) {
                let result = handler.call1(py, (context.to_string(),))?;
                let result_str: String = result.extract(py)?;
                context = serde_json::from_str(&result_str).unwrap_or_default();
            }

            // Rust 层决定下一个节点
            current = self.find_next_node(&node, &context);
        }

        Ok(context.to_string())
    }
}
```

---

## 4. 构建与发布

### 4.1 本地开发构建

```bash
# 安装 maturin
pip install maturin

# 开发构建（自动创建虚拟环境并安装）
maturin develop

# 发布构建
maturin build --release

# 跨平台 wheel 构建（CI 中使用）
maturin build --release --target universal2-apple-darwin  # macOS 通用
maturin build --release --target x86_64-unknown-linux-gnu # Linux
```

### 4.2 CI/CD 配置 (GitHub Actions)

```yaml
# .github/workflows/rust-core.yml
name: Build Rust Core

on:
  push:
    paths:
      - 'crates/**'
      - 'Cargo.toml'
      - 'src/**'

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        python: ['3.9', '3.10', '3.11', '3.12']
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}
      - uses: PyO3/maturin-action@v1
        with:
          command: build
          args: --release --out dist
      - uses: actions/upload-artifact@v4
        with:
          name: wheels-${{ matrix.os }}-${{ matrix.python }}
          path: dist/*.whl
```

### 4.3 发布到 PyPI

```bash
# 一次性配置
maturin publish --username __token__ --password $PYPI_TOKEN

# 或在 CI 中自动发布
maturin publish --non-interactive --token $PYPI_TOKEN
```

---

## 5. 迁移策略

### 5.1 渐进式迁移路线图

```
Phase 1 (Week 1-2): 基础设施
  ├── 搭建 Cargo workspace + maturin 构建
  ├── 创建 `agenticx._internal` 模块
  └── 编写第一个无状态工具（如 JSON 校验器）验证流程

Phase 2 (Week 3-4): 记忆系统
  ├── 迁移 hybrid_search → ax-memory
  ├── 迁移 compaction_flush → ax-memory
  └── Python 侧保留 ORM/存储层，Rust 负责计算

Phase 3 (Week 5-6): 执行层
  ├── 迁移 tools/executor → ax-executor
  ├── 迁移 hooks/registry → ax-hooks
  └── 保持 Python 工具实现不变，Rust 负责路由+策略

Phase 4 (Week 7-8): 工作流
  ├── 迁移 workflows/engine → ax-workflow
  └── 图遍历 Rust 化，节点逻辑仍由 Python 处理

Phase 5 (Week 9+): 优化与扩展
  ├── 性能基准测试与调优
  ├── 根据实际收益决定后续模块
  └── 考虑 SIMD、GPU 加速等
```

### 5.2 兼容性保证

| 策略 | 实现方式 |
|------|----------|
| API 兼容 | Python 包装器保持原有接口签名 |
| 数据兼容 | serde_json 作为跨语言序列化层 |
| 异常兼容 | Rust panic 转换为 Python 异常 |
| 异步兼容 | pyo3-asyncio + tokio 桥接 |
| 类型兼容 | pydantic 模型在 Python 侧，Rust 用 serde |

### 5.3 回滚方案

```python
# agenticx/memory/hybrid_search.py
import os

USE_RUST = os.environ.get("AGX_USE_RUST", "1") == "1"

try:
    if USE_RUST:
        from agenticx._internal import HybridSearcher as _HybridSearcher
        RUST_AVAILABLE = True
    else:
        RUST_AVAILABLE = False
except ImportError:
    RUST_AVAILABLE = False

if RUST_AVAILABLE:
    class HybridSearcher:
        def __init__(self, ...):
            self._inner = _HybridSearcher(...)
        ...
else:
    # 回退到纯 Python 实现
    from .hybrid_search_py import HybridSearcher
```

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 构建复杂度增加 | 中 | maturin 简化构建；CI 自动化；提供预编译 wheel |
| 跨平台兼容性 | 中 | 使用 abi3 特性构建通用 wheel；CI 覆盖主流平台 |
| 调试难度增加 | 中 | 保留 Python 回退实现；完善 Rust 侧日志；使用 `cargo test` |
| 团队学习成本 | 低 | 渐进式迁移；从独立模块开始；文档+代码示例 |
| GIL 竞争 | 中 | 计算密集型操作释放 GIL（`py.allow_threads`）；使用 `rayon` 并行 |
| 异步桥接复杂度 | 中 | 使用 `pyo3-asyncio` 标准模式；避免自定义事件循环 |
| 第三方依赖冲突 | 低 | Cargo workspace 统一管理；与 Python 依赖解耦 |

---

## 7. 快速开始示例

```bash
# 1. 克隆并进入项目
cd agenticx

# 2. 安装 Rust（如未安装）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 3. 安装 Python 依赖
pip install -e ".[dev]"

# 4. 构建 Rust 扩展
maturin develop

# 5. 验证安装
python -c "from agenticx._internal import HybridSearcher; print('Rust core loaded')"

# 6. 运行基准测试
python benchmarks/search_benchmark.py
```

---

## 8. 附录：关键 crate 选型

| 用途 | Crate | 版本 |
|------|-------|------|
| Python 绑定 | pyo3 | 0.22+ |
| 异步桥接 | pyo3-asyncio | 0.22+ |
| 异步运行时 | tokio | 1.40+ |
| 并发原语 | parking_lot | 0.12+ |
| 并行计算 | rayon | 1.10+ |
| 全文检索 | tantivy | 0.22+ |
| 向量计算 | ndarray + simsimd | 最新 |
| 序列化 | serde + serde_json | 1.0+ |
| 图结构 | petgraph | 0.6+ |
| 正则匹配 | regex | 1.10+ |

---

*文档版本: v1.0 | 最后更新: 2025-01*
