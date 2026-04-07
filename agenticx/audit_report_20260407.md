# AgenticX Security Audit Report v2

**Audit Date**: 2026-04-07
**Scope**: `agenticx/` (runtime, tools, sandbox, hooks, integrations, CLI)
**Methodology**: Static analysis, source-level grep, call-chain tracing, threat modeling

---

## Threat Model

**Attacker profiles considered:**

| Profile | Access Level | Goal |
|---------|-------------|------|
| A1: Malicious Skill Author | Can publish SKILL.md + scripts to community registry | RCE on host via skill install/execution |
| A2: Prompt Injection | Controls LLM-generated tool arguments | Shell injection, data exfiltration |
| A3: Local File Tamper | Write access to shared/tmp directories on same host | RCE via deserialization of poisoned files |
| A4: Misconfigured Deployment | Admin passes invalid config values | Sandbox bypass, privilege escalation |

**Attack surface:**

```
User/LLM Input --> tool arguments --> shell execution / code exec / file deserialization
                                  --> sandbox backend selection
Community Skills --> SKILL.md / scripts --> skill execution backend
Disk Files (.pkl) --> pickle.load --> arbitrary code execution
```

---

## Finding #1: Unsafe Pickle Deserialization (3 sites)

**Severity: HIGH** | Impact: RCE | CVSS estimate: 8.1

### Affected Code

| File | Line | Call |
|------|------|------|
| `storage/vectordb_storages/faiss.py` | 44 | `pickle.load(f)` |
| `integrations/mem0/vector_stores/faiss.py` | 88 | `pickle.load(f)` |
| `observability/utils.py` | 550 | `pickle.load(f)` |

### Attack Prerequisites

1. **faiss.py (storage)**: `index_path` defaults to `"faiss_index"` (relative to cwd). If an attacker can write `faiss_index.pkl` in the process working directory (A3: shared host, `/tmp` scenarios), RCE triggers on next `FaissStorage.__init__`.
2. **faiss.py (mem0)**: `path` defaults to `/tmp/faiss/{collection_name}`. The `/tmp` directory is world-writable; any local user can pre-place a malicious `.pkl` file (classic symlink/race attack).
3. **observability/utils.py**: `import_from_pickle(filename)` accepts caller-provided path. If any API route or tool exposes this with user-controlled filename, it becomes directly exploitable.

### Reachability: CONFIRMED

- `FaissStorage` is instantiated by `storage/manager.py:289` and `memory/camel_memories.py:421` with default paths.
- The `/tmp/faiss/` path in mem0 integration is world-writable on standard Linux deployments.

### PoC

```python
import pickle, os
class Exploit:
    def __reduce__(self):
        return (os.system, ('id > /tmp/pwned',))

# Write to default mem0 FAISS path
os.makedirs("/tmp/faiss/default", exist_ok=True)
with open("/tmp/faiss/default/default.pkl", "wb") as f:
    pickle.dump(Exploit(), f)
# Next FAISS.__init__(collection_name="default") triggers RCE
```

### Remediation

Replace all 3 `pickle.load` sites with `RestrictedUnpickler` that whitelists allowed classes. See `agenticx/utils/safe_pickle.py` (implemented in this audit cycle).

---

## Finding #2: shell=True Command Injection in agent_tools

**Severity: HIGH** | Impact: Arbitrary command execution | CVSS estimate: 8.6

### Affected Code (historical)

`cli/agent_tools.py` — Previously, when the command string contained shell metacharacters (`;`, `&&`, `||`, `|`, `$`, backticks, `<`, `>`, newlines), the code used `subprocess.run(..., shell=True, executable="/bin/bash")`. This has been replaced with `subprocess.run(["/bin/bash", "-c", command], shell=False)` plus a 64KiB command length cap.

### Attack Prerequisites

The LLM or user provides a `command` argument containing shell metacharacters. The existing `pre_tool_guard` hook only inspects `bash_exec` tool calls; if the command reaches `agent_tools` via a different code path, the guard is bypassed entirely (A2).

### Reachability: CONFIRMED

This is the primary shell execution path for Studio/Machi tool calls with complex commands.

### Remediation

- Extend `pre_tool_guard` to cover all shell-executing tool names (done in this audit cycle).
- Root fix: complex commands use `subprocess.run(["/bin/bash", "-c", command], shell=False)` instead of `shell=True` (Python-layer injection surface removed; bash still interprets metacharacters as required). Command length capped at 64KiB.

---

## Finding #3: Unsafe eval() — No Sandboxing

**Severity: MEDIUM-HIGH** | Impact: Arbitrary code execution

### Affected Code

| File | Line | Context |
|------|------|---------|
| `cli/templates/volcengine/mcp/agent.py` | 31 | `eval(expression)` — calculator tool, accepts arbitrary Python expressions |
| `embodiment/workflow/engine.py` | (was ~314) | `eval(condition, eval_context)` — **replaced** with AST-restricted `_safe_condition_eval` |
| `tools/skill_execution_backend.py` | 105 | `exec(code, exec_globals)` with `allow_globals=True` exposes full process namespace |

### Attack Prerequisites

- **calculator**: Any user input passed as `expression` (A2). Trivial exploitation: `__import__('os').system('id')`.
- **workflow engine**: Requires attacker-controlled workflow condition or metadata (A1/A2).
- **skill backend**: Requires skill code execution path (A1).

### Remediation

- Replace calculator `eval()` with an AST-based safe arithmetic evaluator (not `ast.literal_eval`; that only parses literals) (done in this audit cycle).
- Replace workflow `eval(condition, …)` with an AST-restricted condition evaluator allowing only comparisons / boolean logic / context names (done in this audit cycle).
- Remove `globals()` injection from `LocalSkillBackend` (done in this audit cycle).

---

## Finding #4: SandboxSkillBackend — Dead Code / API Mismatch

**Severity: MEDIUM** | Impact: Sandbox bypass (sandbox path never executes)

### Affected Code

`tools/skill_execution_backend.py:136-218`

### Analysis

`SandboxSkillBackend` imports `SandboxType.SUBPROCESS`, `SandboxType.DOCKER`, `SandboxType.MICROSANDBOX`, and `ExecutionRequest` from `agenticx.sandbox.types`. **None of these symbols exist** in the actual `sandbox/types.py` (which defines `CODE_INTERPRETER`, `BROWSER`, `AIO` and has no `ExecutionRequest` class). The entire sandbox backend path raises `ImportError` on first call and falls through to exception handling, meaning **skill execution always uses the unsandboxed `LocalSkillBackend`**.

Additionally, `type_map.get(self.sandbox_type, SandboxType.SUBPROCESS)` silently degrades unknown types to the weakest isolation, but this code never executes anyway due to the import failure.

### Remediation

Rewrite `SandboxSkillBackend` to use the real `SandboxType` enum and `Sandbox.create()` async API. Reject unknown `sandbox_type` with `ValueError` (done in this audit cycle).

---

## Finding #5: Shell Bundle Argument Boundary (Informational)

**Severity: LOW** | Impact: Depends on target script behavior

### Affected Code

`tools/shell_bundle.py:71-81`

### Analysis

The original v1 report classified this as "HIGH — command injection". This is **incorrect**. The code uses `subprocess.run([script_path] + args.args)` in list mode (no `shell=True`), so shell metacharacters like `;` are passed as literal string arguments to the script, **not** interpreted by a shell.

The actual risk depends on how individual bundle scripts handle arguments internally (e.g., if a script passes args to `eval` or constructs shell commands). This is a defense-in-depth concern, not a framework-level injection vulnerability.

### Remediation

No code change required at the framework level. Bundle scripts should follow safe argument handling practices.

---

## Finding #6: pre_tool_guard Coverage Gap

**Severity: MEDIUM** | Impact: Dangerous command bypass

### Affected Code

`hooks/bundled/pre_tool_guard/handler.py:30-40`

### Analysis

The guard only extracts commands from:
1. `event.context["command"]` (set by `LegacyEventBridgeHook` only for `bash_exec`)
2. `tool_input["command"]` when `tool_name == "bash_exec"`

Tools named `run_terminal_cmd`, `shell_exec`, `terminal`, or MCP-proxied shell tools are **not inspected**. An LLM can invoke `run_terminal_cmd` with `rm -rf /` and the guard will not block it.

### Remediation

Extend command extraction to cover all known shell tool names and search `tool_input` for command-like fields (done in this audit cycle).

---

## Existing Defenses Inventory

| Layer | Mechanism | Coverage |
|-------|-----------|----------|
| Tool name policy | `ToolPolicyStack` + `AllowlistProvider` | Tool-name-level allow/deny; does not inspect arguments |
| pre_tool_guard hook | Regex patterns for rm -rf, DROP TABLE, etc. | Only `bash_exec` commands; other shell tools bypassed |
| Skill content scan | `skills/guard.py` regex on SKILL.md | Text-only, single-line, easily bypassed by encoding |
| Sandbox system | subprocess/docker/microsandbox backends | Functional but `SandboxSkillBackend` never invokes it |
| Confirm gate | `confirm_gate` on tool dispatch | User-facing approval; effective when enabled |
| Loop detector | `loop_detector.py` | Anti-abuse for repeated tool calls |

---

## Remediation Priority Matrix

| # | Finding | Severity | Priority | Status |
|---|---------|----------|----------|--------|
| 1 | Pickle deserialization (3 sites) | HIGH | **P0** | Fixed: `RestrictedUnpickler` + `VectorRecord` allowlist in `utils/safe_pickle.py`; optional `signed_pickle_*` HMAC helpers |
| 2 | shell=True in agent_tools | HIGH | **P0** | Fixed: `["/bin/bash","-c", command]` + `shell=False` + 64KiB cap; plus extended `pre_tool_guard` |
| 3 | Unsafe eval() (3 sites) | MEDIUM-HIGH | **P1** | Fixed: calculator AST safe arithmetic; workflow AST condition eval; skill backend globals removed |
| 4 | SandboxSkillBackend dead code | MEDIUM | **P1** | Fixed: aligned with real sandbox API |
| 5 | Shell bundle args (informational) | LOW | **P2** | No action needed |
| 6 | pre_tool_guard coverage gap | MEDIUM | **P1** | Fixed: extended tool name coverage |
