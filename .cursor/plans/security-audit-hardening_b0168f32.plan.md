---
name: security-audit-hardening
overview: 重写安全审计报告（修正误报、补充遗漏、建立威胁模型），并针对报告中确认的真实风险点落地代码级安全加固：安全反序列化封装、沙箱后端修复、工具守卫扩面。
todos:
  - id: rewrite-audit
    content: 重写 agenticx/audit_report_20260407.md：修正误报、补充新发现、建立威胁模型、统一风险分级
    status: completed
  - id: safe-pickle
    content: 新建 agenticx/utils/safe_pickle.py（RestrictedUnpickler + HMAC 签名），替换 3 处 pickle.load 调用点
    status: completed
  - id: fix-sandbox-backend
    content: 修复 SandboxSkillBackend 对齐真实 sandbox API，未知类型抛错；收窄 LocalSkillBackend 的 globals 暴露
    status: completed
  - id: extend-pre-tool-guard
    content: 扩展 pre_tool_guard 覆盖 run_terminal_cmd 等更多 shell 类工具
    status: completed
  - id: fix-eval
    content: 将 volcengine/mcp/agent.py 中 eval() 替换为 ast.literal_eval 或 simpleeval
    status: completed
  - id: smoke-tests
    content: 编写冒烟测试：safe_pickle、sandbox_backend、pre_tool_guard 扩展覆盖
    status: completed
isProject: false
---

# 安全审计报告优化与 AgenticX 安全加固

## 一、审计报告重写

现有 [`agenticx/audit_report_20260407.md`](agenticx/audit_report_20260407.md) 存在以下问题需修正：

### 1.1 需修正的条目

- **#2 Shell Bundle 命令注入 — 误报**：`shell_bundle.py:73` 使用 `subprocess.run([script_path] + args.args)`，为参数列表模式，**不经 shell 解析**，`;` 不会被当作命令分隔符。应降级为"参数边界校验建议"而非"高危命令注入"。
- **#1 Pickle 反序列化 — 缺前提链路**：确认 3 处 `pickle.load` 真实存在，但报告未分析"攻击者如何写入 `.pkl` 文件"这一前提。需补充攻击路径可达性分析。
- **#3 沙箱类型逃逸 — 标题/正文矛盾**：标题写"高风险"，正文写"中"。且 `SandboxSkillBackend` 与真实 `agenticx/sandbox/types.py` 的 `SandboxType` 枚举完全不匹配（`types.py` 无 `SUBPROCESS`/`DOCKER`/`MICROSANDBOX`，仅有 `CODE_INTERPRETER`/`BROWSER`/`AIO`），属于**代码已断链**而非单纯"静默降级"。
- **修复建议质量**：`import pickle5, hjson, msgpack, or json` 非合法 Python；`hmac.new(...).verify(sig)` 调用不存在。

### 1.2 需新增的条目（本次探索发现）

| 风险 | 位置 | 说明 |
|------|------|------|
| `shell=True` 命令注入 | `cli/agent_tools.py:1124` | 当命令含 `; && \|\| \| $` 等时走 `shell=True`，用户/模型传入的 command 经完整 bash 解析 |
| 不安全 `eval()` | `cli/templates/volcengine/mcp/agent.py:31` | 计算器工具直接 `eval(expression)` 无 `ast.literal_eval` |
| 不安全 `eval()` | `embodiment/workflow/engine.py:314` | `eval(condition, eval_context)` 中 `context_dict` 可能污染 `__builtins__` |
| `exec` + `allow_globals` | `tools/skill_execution_backend.py:105` | `allow_globals=True` 时把当前进程 `globals()` 全量暴露 |
| `SandboxSkillBackend` API 断链 | `tools/skill_execution_backend.py:176` | 导入不存在的 `ExecutionRequest`、`SandboxType.SUBPROCESS` 等，从未真正走过沙箱路径 |

### 1.3 报告新结构

```
# AgenticX 安全审计报告 v2
## 方法论与范围
## 威胁模型（攻击面定义）
## 发现清单（按 CVSS 定性分级）
  - 每条含：风险描述、涉及代码、攻击前提与可达性、PoC、影响面、修复建议
## 已有防线盘点
## 修复优先级矩阵
## 附录：安全架构改进建议
```

---

## 二、代码级安全加固

### 2.1 安全反序列化封装（P0）

**问题**：3 处 `pickle.load` 无任何校验。

**方案**：新建 [`agenticx/utils/safe_pickle.py`](agenticx/utils/safe_pickle.py)，提供 HMAC 签名校验的 `safe_pickle_dump` / `safe_pickle_load`，以及仅允许白名单类的 `RestrictedUnpickler`。

```python
class RestrictedUnpickler(pickle.Unpickler):
    ALLOWED_MODULES_CLASSES = {
        ("builtins", "dict"), ("builtins", "list"), ("builtins", "set"),
        ("builtins", "tuple"), ("builtins", "str"), ("builtins", "int"),
        ("builtins", "float"), ("builtins", "bool"), ("builtins", "bytes"),
        ("numpy", "ndarray"), ("numpy", "dtype"),
        ("numpy.core.multiarray", "_reconstruct"),
    }
    def find_class(self, module, name):
        if (module, name) not in self.ALLOWED_MODULES_CLASSES:
            raise pickle.UnpicklingError(f"Blocked: {module}.{name}")
        return super().find_class(module, name)
```

替换点：
- [`storage/vectordb_storages/faiss.py:44`](agenticx/storage/vectordb_storages/faiss.py) — `_load_index`
- [`integrations/mem0/vector_stores/faiss.py:88`](agenticx/integrations/mem0/vector_stores/faiss.py) — `_load`
- [`observability/utils.py:550`](agenticx/observability/utils.py) — `import_from_pickle`

### 2.2 修复 SandboxSkillBackend（P0）

**问题**：`SandboxSkillBackend` 导入的 `SandboxType.SUBPROCESS`/`ExecutionRequest` 在真实 `sandbox/types.py` 中不存在，该后端从未真正走过沙箱路径，默认回退到 `LocalSkillBackend`（等同 `exec`）。

**方案**：
- 对齐真实 `agenticx/sandbox/base.py` 的 `Sandbox.create()` API（async 上下文管理器 + `SandboxType` 真实枚举）
- 未知 `sandbox_type` 时 `raise ValueError` 而非静默降级
- `get_default_backend()` 保持返回 `LocalSkillBackend`，但在 `LocalSkillBackend.execute` 中**移除 `allow_globals=True` 对 `globals()` 的暴露**，改为显式安全白名单

### 2.3 扩展 pre_tool_guard 覆盖面（P1）

**问题**：当前 `pre_tool_guard` 仅在 `tool_name == "bash_exec"` 或 `context["command"]` 存在时做正则检查，其他执行 shell 的工具（如 `run_terminal_cmd`、MCP 工具）完全绕过。

**方案**：修改 [`agenticx/hooks/bundled/pre_tool_guard/handler.py`](agenticx/hooks/bundled/pre_tool_guard/handler.py)：
- 扩展命令提取逻辑：除 `bash_exec` 外，对 `run_terminal_cmd`、`shell_exec`、`terminal` 等已知 shell 类工具名也提取 `command`/`cmd`/`script` 参数
- 在 `tool_input` 中递归搜索可能的命令字段（`command`, `cmd`, `script`, `code`）

### 2.4 eval 安全收窄（P1）

**问题**：`cli/templates/volcengine/mcp/agent.py:31` 直接 `eval(expression)`。

**方案**：替换为 `ast.literal_eval` 或专用安全计算库（如 `simpleeval`），仅允许数学表达式。

### 2.5 LocalSkillBackend 安全收窄（P1）

**问题**：`allow_globals=True` 时 `exec_globals.update(globals())` 把宿主所有符号暴露给技能代码。

**方案**：移除 `globals()` 注入，改为仅注入明确白名单模块（`json`, `re`, `os.path`, `datetime` 等安全子集）。

---

## 三、测试

- 为 `safe_pickle.py` 编写冒烟测试：正常 load/dump、恶意 payload 被 `RestrictedUnpickler` 拦截、HMAC 篡改检测
- 为修复后的 `SandboxSkillBackend` 编写测试：未知类型抛错、已知类型正确映射
- 为扩展后的 `pre_tool_guard` 编写测试：多种工具名下的命令提取与拦截
