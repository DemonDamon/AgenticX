# Plan: GAIA Benchmark 集成与提交流水线

Plan-Id: 2026-06-15-gaia-benchmark-integration
Status: draft (待用户确认后执行)
Owner: Damon Li

---

## 0. 背景与目标

当前仓库已具备通用评测能力（`BenchmarkRunner`），但未提供 GAIA 专用的数据适配、结果导出与官方提交流程闭环。目标是在不改动现有评测框架核心行为的前提下，新增一条可复用的 GAIA 集成流水线：**数据加载 -> Task 适配 -> 执行评测 -> 结果标准化 -> 提交文件导出与校验**。

---

## 1. 范围与非目标

### In scope
- 新增 GAIA 数据加载与字段映射层（转为 AgenticX 可执行任务结构）。
- 基于 `BenchmarkRunner` 封装 GAIA 专用执行入口（支持断点续跑与失败记录）。
- 新增 GAIA 提交文件导出器与 schema 校验。
- 增加最小可运行文档与冒烟测试（小样本端到端）。

### Out of scope
- 不改造 `agenticx/observability/evaluation.py` 的通用框架设计。
- 不引入与 GAIA 无关的评测平台适配。
- 不实现自动上传官方平台（仅产出合规提交包与人工提交流程说明）。

---

## 2. 需求定义（FR / NFR / AC）

### FR-1 GAIA 数据适配
- FR-1.1 支持读取 GAIA 官方任务文件（json/jsonl/csv 以实际发布格式为准）。
- FR-1.2 提供稳定映射：`gaia_record -> AgenticX task payload`。
- FR-1.3 对缺失字段、异常样本输出可追踪错误信息并跳过，不中断整批。

### FR-2 GAIA 专用评测执行入口
- FR-2.1 新增 GAIA runner 脚本，复用 `BenchmarkRunner` 执行。
- FR-2.2 支持指定模型、并发、超时、样本范围（如 `--limit`、`--offset`）。
- FR-2.3 支持断点续跑：已有结果样本默认跳过，可强制重跑。

### FR-3 结果标准化与提交导出
- FR-3.1 产出逐题原始结果（含模型输出、耗时、错误信息）。
- FR-3.2 产出 GAIA 官方提交格式文件（字段、命名、编码严格对齐）。
- FR-3.3 增加导出前 schema 校验，校验失败时给出具体字段错误。

### FR-4 可复现与可审计
- FR-4.1 每次运行产出 run manifest（时间、commit、模型、参数、样本范围）。
- FR-4.2 保留原始输出与转换后输出，便于回溯争议样本。

### NFR
- NFR-1 与现有评测主链路解耦，默认不影响其他 benchmark。
- NFR-2 不新增重型依赖，优先使用标准库与仓库既有依赖。
- NFR-3 小样本（10~20 题）应可在单机稳定跑通端到端。

### AC（验收）
- AC-1 给定一份 GAIA 样本数据，可成功转换并执行评测。
- AC-2 运行结束后同时得到：逐题结果文件 + 官方提交文件 + manifest。
- AC-3 提交文件可通过本地校验器（与 GAIA 要求一致）。
- AC-4 失败样本不阻断整批，失败原因可定位。
- AC-5 小样本冒烟测试通过，README 可指导他人独立复现流程。

---

## 3. 实施阶段（可分批提交）

### Phase 0 — 规范冻结（先调研再编码）
1. 确认 GAIA 当前版本的任务字段与提交格式（官方文档/仓库）。
2. 形成映射表：输入字段、输出字段、边界情况（空答案、多段文本、特殊字符）。
3. 确认运行约束：是否允许工具调用、超时口径、重试策略。

产出：
- `docs/benchmarks/gaia-format-notes.md`（字段映射与提交规范摘要）

### Phase 1 — 数据加载与映射层
4. 新增 `agenticx/observability/gaia_loader.py`（读取与解析）。
5. 新增 `agenticx/observability/gaia_adapter.py`（转换为 runner 所需任务对象）。
6. 新增基础校验函数（必填字段、ID 唯一性、格式合法性）。

产出：
- 可复用的 `load_gaia_tasks(...)` 接口。

### Phase 2 — 执行编排层
7. 新增 `scripts/run_gaia_benchmark.py`（CLI 入口）。
8. 复用 `BenchmarkRunner` 执行，落盘中间结果（支持 resume）。
9. 增加运行 manifest 写入（模型、参数、git commit、时间戳）。

产出：
- 一条命令即可跑 GAIA 小样本评测。

### Phase 3 — 导出与校验层
10. 新增 `agenticx/observability/gaia_exporter.py`（提交格式生成）。
11. 新增 `agenticx/observability/gaia_validator.py`（本地 schema 校验）。
12. CLI 增加 `--export-submission` 与 `--validate-only` 模式。

产出：
- `results/*.jsonl`（逐题结果）
- `submission/*.json`（官方提交包）

### Phase 4 — 文档与验收
13. 新增 `docs/guides/gaia-benchmark.md`（准备数据、执行、导出、提交）。
14. 增加常见失败案例与排障（字段缺失、编码问题、超时）。
15. 跑通 AC-1~AC-5 的小样本验收并记录样例命令。

---

## 4. 测试计划

- `tests/test_gaia_loader.py`：数据读取与字段映射。
- `tests/test_gaia_exporter.py`：导出字段完整性与命名校验。
- `tests/test_gaia_validator.py`：非法提交包拦截与错误信息可读性。
- `tests/test_smoke_gaia_e2e.py`：小样本端到端（load -> run -> export -> validate）。

命令建议：
- `pytest tests/test_gaia_loader.py tests/test_gaia_exporter.py -q`
- `pytest tests/test_smoke_gaia_e2e.py -q`

---

## 5. 目录与文件建议

- Create: `agenticx/observability/gaia_loader.py`
- Create: `agenticx/observability/gaia_adapter.py`
- Create: `agenticx/observability/gaia_exporter.py`
- Create: `agenticx/observability/gaia_validator.py`
- Create: `scripts/run_gaia_benchmark.py`
- Create: `docs/benchmarks/gaia-format-notes.md`
- Create: `docs/guides/gaia-benchmark.md`
- Create: `tests/test_gaia_loader.py`
- Create: `tests/test_gaia_exporter.py`
- Create: `tests/test_gaia_validator.py`
- Create: `tests/test_smoke_gaia_e2e.py`

---

## 6. 风险与缓解

- 风险-1：GAIA 官方格式版本变更导致导出不兼容。  
  缓解：将格式版本写入 manifest，validator 按版本分支校验。

- 风险-2：样本包含复杂答案（多行/特殊字符）导致提交失败。  
  缓解：统一编码与转义策略，并在 exporter 单测覆盖边界样本。

- 风险-3：长任务评测中断后重复计费或重复执行。  
  缓解：以样本 ID 为幂等键，resume 时跳过已完成样本。

---

## 7. 执行前确认项（请用户拍板）

1. 先接入 GAIA 哪个 split（dev / validation / test）？
2. 本轮是否允许 tools 调用，还是纯文本模型评测？
3. 提交文件目标格式（若 GAIA 新版有多种模板）采用哪一版？
4. 是否需要在首版就支持多模型批量对比导出？

