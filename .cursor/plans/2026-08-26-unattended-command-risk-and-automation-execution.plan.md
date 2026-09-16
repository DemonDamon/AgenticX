# 无人值守命令风险分级与定时任务可执行性修复

Planned-with: Claude Opus 5

## 背景与证据链

2026-08-25 20:00–20:02 合并的一批 runtime commit 引入了 OS 级命令沙箱与读隔离：

```
1aa91bb7 2026-08-25 20:01:58  feat(runtime): confine reads to the workspace on macOS and Linux
b0d2f0b4 2026-08-25 20:01:52  feat(runtime): make dispatch_tool_async the single policy chokepoint
1c46a152 2026-08-25 20:00:59  feat(runtime): judge command risk segment by segment
ed845e92 2026-08-25 20:00:41  feat(runtime): confine shell commands with an OS-level sandbox
```

合并后约 4 小时（`2026-08-25T16:18:34Z`），已稳定运行数月的定时任务「A股收盘价量日报」
（`~/.agenticx/automation_tasks.json` 中 `atask_19d61f08ffe_8b2se0`，会话
`4c008d75-4961-4e4a-84ae-a5bcb31e1dbc`）首次完全失败，未产出任何报告。该任务此前可用，
证据是工作区 `/Users/damon/Desktop/machi定时任务测试_A股大盘价量获取/` 内存在历史产物
`daily_report_2026-08-13.md`、`A股日报_20260806.md`。

该会话的失败被两个独立原因叠加造成，且**都不是**用户可通过设置界面解决的：

**原因 A — 工作区读隔离阻断 skill 目录**

`file_read` / `cat` / `list_files` 读 `~/.agenticx/skills/a-stock-daily-report/SKILL.md`
一律返回：

```
ERROR: path escapes workspace: /Users/damon/.agenticx/skills/a-stock-daily-report/SKILL.md
(allowed roots: /Users/damon/Desktop/machi定时任务测试_A股大盘价量获取,
 /Users/damon/.agenticx/taskspaces/4c008d75-.../default, /Users/damon/.agenticx/desktop-use)
```

`skill_use` 已经把 SKILL.md 正文写进 `session.context_files["skill:<name>"]`
（`agenticx/cli/studio_skill.py` 的 `skill_use()`，约 L116-118），但任务提示词与
SKILL.md 正文都要求模型再去 `file_read` 磁盘上的同一个文件，于是必然撞墙。
模型随后反复重试、并尝试用 Python `shutil.copy` 绕行，全部失败。

**原因 B — 无人值守闸拒绝所有受保护操作，且沙箱档位无关**

`agenticx/studio/server.py` 的 `_resolve_confirm_gate()` 第一行即：

```python
if unattended:
    return RiskAwareAutoConfirmGate(unattended=True)
```

而 `turn_is_unattended` 在 `server.py` L2689-2690 由 `avatar_id.startswith("automation:")`
推出，因此**定时任务必然走无人值守闸，完全不读 `run_mode`**。
`RiskAwareAutoConfirmGate.request_confirm()`（`agenticx/runtime/confirm.py` L295-310）
对任何 `is_protected_confirm(payload)` 为真的请求直接返回 False，工具侧渲染成：

```
CANCELLED: 非白名单命令未执行（无人值守运行不批准受保护操作）
```

`/Users/damon/Desktop/.../.venv/bin/python daily_a_stock.py` 被判为
`non_whitelisted` / `unrecognized_command`（非低风险），因此被拒。

**为什么用户侧的两个下拉都无效（已实测）**

- 改「运行模式」为 `auto`：无人值守分支在读 `run_mode` 之前就 return 了，无效。
- 改沙箱档位为「脱离隔离」：`path escapes workspace` 出自 `_resolve_workspace_path()`
  （`agenticx/cli/agent_tools.py` L3421-3486），只看会话工作区根与
  `AGX_DESKTOP_UNRESTRICTED_FS`，与 `command_permissions` 无关；且
  `danger-full-access` 会额外要求一次 `host_full_access` 确认
  （`agent_tools.py` L4074-4091），该类别在 `NEVER_AUTO_APPROVED_CATEGORIES` 内，
  无人值守下必否 —— 结果比默认档位更严，不是更松。

**原因 C — 现有唯一放行口 `permissions.allowed_tools` 不可用（安全缺陷）**

`tool_allowed_without_confirm()`（`agenticx/cli/agent_tools.py` L107-137）在建闸之前
生效，因此 `permissions.allowed_tools: ["bash_exec"]` 确实能让无人值守跑 Python。
但实测该开关同时放行了删库与关机：

```
'rm -rf /Users/damon/Desktop'  -> non_whitelisted ['unrecognized_command'] waived=True
'shutdown -h now'              -> non_whitelisted ['unrecognized_command'] waived=True
'curl -X POST https://…'       -> non_whitelisted ['unrecognized_command'] waived=True
'git push origin main'         -> high ['version_control_change']          waived=True
```

根因是 `classify_simple_command()`（`agenticx/runtime/command_safety.py` L281-313）
把 `rm` / `shutdown` / `curl` 等归入 `KNOWN_NON_READONLY_COMMANDS`（L68-75）后，
只发出泛化的 `unrecognized_command`，**从未发出** `destructive_filesystem` /
`system_disruption` / `external_publish`。当前只有 `find -delete`、`sed -i`、`tar`
这三条 guarded 规则会产出 `destructive_filesystem`（L366-465）。
于是 `NEVER_AUTO_APPROVED_CATEGORIES`（L582-587）形同虚设。

`command_safety.py` L575-578 的注释已记录过这个坑的一次修复尝试：

```
#: ``destructive_filesystem`` was added 2026-08-24. The UI said deletions
#: would still be asked, but the code set did not include it -- then
#: ``allowed_tools: ["bash_exec"]`` let ``rm -rf`` skip confirmation.
#: Copy that promises more than the code is worse than neither.
```

即：上次只把类别加进了「永不放行」集合，**没有让分类器真正产出该类别**，洞仍然开着。

## In scope

1. 让 `classify_simple_command` 对已知危险命令产出精确风险类别，使
   `NEVER_AUTO_APPROVED_CATEGORIES` 真正生效。
2. 在 1 的基础上，为定时任务提供一个**窄口径**的放行能力：允许执行工作区内已存在的
   脚本，且不放行任何 never-类别。
3. 消除 `skill_use` 与工作区读隔离之间的断层：技能正文已注入时不得再逼模型读磁盘。
4. 前后端 never-类别词表保持单一来源。

## Out of scope（no-scope-creep 边界）

- 不改沙箱后端实现（`command_sandbox.py` 的 seatbelt / bwrap profile 生成逻辑）。
- 不改工作区根解析（`_resolve_workspace_path`）的既有语义，不新增虚拟挂载类型。
- 不动 `run_mode` / `RunMode` 词表与安全中心 UI 布局（上一批 plan 刚收口）。
- 不改 `~/.agenticx/automation_tasks.json` 的调度字段结构。
- 不引入新的沙箱档位（明确保留三档）。
- 不为本 plan 新增第三方依赖。

## Suggested-Impl-Model

| 子任务 | 推荐模型 | 理由 |
|--------|----------|------|
| FR-1 命令风险分级 | 代码专精中档（如 Codex 系列） | 纯后端 + 表驱动 + 测试密集，规则边界清楚 |
| FR-2 定时任务窄放行 | 强推理档（如 GPT-5.x） | 跨 confirm gate / 会话上下文，安全敏感、易开洞 |
| FR-3 skill 注入去重 | 代码专精中档 | 单点改动，落点明确 |
| FR-4 词表同步 | Composer/Fast 档 | 常量搬运 + 一条断言 |

---

## FR-1：命令风险分级落到实处

**文件**：`agenticx/runtime/command_safety.py`

**落点**：`classify_simple_command()`（当前 L281-313）在 `READ_ONLY_COMMANDS` 判定之后、
`KNOWN_NON_READONLY_COMMANDS` 分支之前，插入按名字分派的精确规则。

新增模块级常量（放在 `KNOWN_NON_READONLY_COMMANDS`，即当前 L68-75 之后）：

```python
#: 命令名 → 风险类别。归入 NEVER_AUTO_APPROVED_CATEGORIES 的名字必须在此列出，
#: 否则「永不放行」只是文案：分类器发不出该类别，集合就永远匹配不上。
COMMAND_RISK_CATEGORIES: dict[str, str] = {
    # 删除 / 覆盖：不可逆
    "rm": "destructive_filesystem",
    "rmdir": "destructive_filesystem",
    "mv": "destructive_filesystem",
    "dd": "destructive_filesystem",
    "mkfs": "destructive_filesystem",
    # 主机 / 系统级
    "shutdown": "system_disruption",
    "reboot": "system_disruption",
    "poweroff": "system_disruption",
    "kill": "system_disruption",
    "pkill": "system_disruption",
    "chmod": "system_disruption",
    "chown": "system_disruption",
    "sudo": "host_full_access",
    "su": "host_full_access",
    # 效果离开本机
    "curl": "external_publish",
    "wget": "external_publish",
    "ssh": "external_publish",
    "scp": "external_publish",
    "rsync": "external_publish",
    # 装依赖：磁盘写 + 取远端代码
    "pip": "dependency_change",
    "pip3": "dependency_change",
    "npm": "dependency_change",
    "yarn": "dependency_change",
    "pnpm": "dependency_change",
    "brew": "dependency_change",
    "apt": "dependency_change",
    "apt-get": "dependency_change",
    "cargo": "dependency_change",
    # 解释器：可开 socket、可写盘
    "python": "arbitrary_code_execution",
    "python3": "arbitrary_code_execution",
    "node": "arbitrary_code_execution",
    "npx": "arbitrary_code_execution",
}
```

`classify_simple_command` 改动意图（before → after）：

```python
# before（L294 起）
    if name in KNOWN_NON_READONLY_COMMANDS:
        return SafetyVerdict(
            contained=False,
            findings=[RiskFinding("unrecognized_command", f"{name} 不是只读命令，需要你判断这次的用途")],
        )

# after
    category = COMMAND_RISK_CATEGORIES.get(name)
    if category is not None:
        return SafetyVerdict(
            contained=False,
            findings=[RiskFinding(category, _risk_evidence(name, category, parts))],
        )
    if name in KNOWN_NON_READONLY_COMMANDS:
        # 仍在识别集合里但没有专门规则：保持泛化理由，不要静默放行。
        return SafetyVerdict(
            contained=False,
            findings=[RiskFinding("unrecognized_command", f"{name} 不是只读命令，需要你判断这次的用途")],
        )
```

`_risk_evidence(name, category, parts)` 为新增私有函数，返回中文人读理由，
须包含命令名，例如 `rm` → `"rm 会删除文件，删除不可撤销"`，
`curl` → `"curl 会把数据发往本机之外"`。禁止返回空字符串。

**注意**：`cp` / `ln` / `mkdir` / `touch` 故意**不**列入 `COMMAND_RISK_CATEGORIES`。
它们的写入边界由 OS 沙箱的 writable roots 保证，落在 `unrecognized_command` 即可；
列入 `destructive_filesystem` 会让工作区内的正常拷贝永远无法自动放行，
与 FR-2 直接冲突。

**AC-1**：新增 `tests/test_command_safety.py` 用例（与既有 `test_find_delete_requires_approval`
同风格）：

- `assess_command("rm -rf /tmp/x")` 的 `findings` 含 code `destructive_filesystem`
- `assess_command("shutdown -h now")` 含 `system_disruption`
- `assess_command("curl -X POST https://example.com")` 含 `external_publish`
- `assess_command("sudo ls")` 含 `host_full_access`
- `assess_command("timeout 5 rm -rf /tmp/x")` 含 `destructive_filesystem`
  （验证 `_classify_delegating` 仍先剥壳）
- `assess_command("cp a.txt b.txt")` **不含**任何 never-类别
- 断言 `COMMAND_RISK_CATEGORIES` 的取值集合 ⊇ `NEVER_AUTO_APPROVED_CATEGORIES`
  （这条防止将来再次出现「类别在集合里但分类器发不出」）

**AC-2**：新增 `tests/test_agent_tools.py` 用例，配置
`permissions.allowed_tools = ["bash_exec"]` 时：

- `rm -rf <path>` 仍返回 `CANCELLED`
- `shutdown -h now` 仍返回 `CANCELLED`
- 工作区内 `python <workspace>/script.py` 得到放行

---

## FR-2：定时任务可执行工作区内已有脚本

**文件**：`agenticx/cli/agent_tools.py`、`agenticx/cli/config_manager.py`

**动机**：FR-1 之后，`python <script>` 的类别是 `arbitrary_code_execution`，
**不在** never 集合内，因此可以安全地为无人值守开一个窄口。

**落点 1** — `agenticx/cli/config_manager.py` 的 `PermissionsConfig`
（`command_permissions` 字段附近，当前约 L153-162）新增：

```python
    #: 无人值守（含 automation:* 定时任务）是否可执行工作区内已存在的脚本。
    #: 仅对满足全部条件的调用生效：非 never 类别、可执行文件位于会话 writable
    #: roots 之内、且该文件在调用前已存在。默认关闭。
    unattended_allow_workspace_scripts: bool = False
```

**落点 2** — `agenticx/cli/agent_tools.py` 的 `_confirm()`
（当前 L2829 起），在 `tool_allowed_without_confirm(...)` 那一条判断
（当前约 L2850）**之后**、`is_protected_confirm` 之前，插入新的放行分支：

```python
    if _unattended_workspace_script_allowed(payload_context, risk_codes, session):
        _log.info(
            "[confirm] auto-approved id=%s tool=%s by unattended workspace-script rule",
            request_id,
            payload_context.get("tool"),
        )
        return True
```

新增私有函数 `_unattended_workspace_script_allowed(context, risk_codes, session)`，
**全部**条件为真才返回 True：

1. `ConfigManager.get_value("permissions.unattended_allow_workspace_scripts")` 为真
2. `set(risk_codes) & NEVER_AUTO_APPROVED_CATEGORIES` 为空
3. `context["tool"]` 属于 `{"bash_exec", "bash_bg_start"}`
4. 命令的每一个 simple segment 的可执行文件与脚本实参，经
   `_resolve_workspace_path(..., session)` 解析后都落在会话 writable roots 内，
   且 `Path.exists()` 为真（**已存在**是关键：现写现跑等于任意代码执行）
5. 命令不含绝对路径重定向（复用 `absolute_redirect_targets(command)`，须为空）

`_confirm()` 目前没有 `session` 形参，需要在签名中新增
`session: Optional[StudioSession] = None`，并在 `_bash_exec_prepare` 与
`_apply_command_sandbox` 两处调用点透传。**其余 `_confirm()` 调用点不要改**，
默认 None 时该分支直接返回 False。

**落点 3** — Desktop 设置面板：在安全中心的
`desktop/src/components/settings/security/PermissionsAdvancedPanel.tsx` 增加一个开关，
绑定 `unattended_allow_workspace_scripts`。该面板现有 `persist()` 已支持
`path_rules` / `denied_tools`（见其 L120、L143-145），按同样方式扩展；
后端读写在 `agenticx/studio/server.py` 的 permissions GET/PUT（当前约 L7507-7576），
须把新字段加入两侧的读取与白名单。开关文案必须说明「仅放行工作区内已存在的脚本；
删除、关机、外发类操作仍会被拒绝」。

**AC-3**：`tests/test_agent_tools.py` 覆盖，开关为 True 且无人值守时：

- 工作区内已存在的 `python <workspace>/daily.py` → 放行
- 工作区外的 `python /tmp/x.py` → `CANCELLED`
- 先 `file_write` 再执行的新脚本 → `CANCELLED`（条件 4 的 exists 检查）
- `rm -rf <workspace>/sub` → `CANCELLED`（never 类别优先）
- `python x.py > /etc/hosts` → `CANCELLED`（绝对重定向）
- 开关为 False 时上述全部 `CANCELLED`

---

## FR-3：skill 正文已注入时不再要求读磁盘

**文件**：`agenticx/cli/agent_tools.py`

**落点**：`_tool_skill_use()`（当前 L5933-5975）的成功返回文案。

现状返回值包含 `base_dir=` 与 `skill_md=` 两个绝对路径（L5973-5974），
模型据此去 `file_read`，在工作区隔离下必然失败。

改动意图：成功文案中**不再暴露** `skill_md` 绝对路径，改为明确告知正文已在上下文内，
并显式禁止再读磁盘。例如：

```
OK: activated skill '<name>'. 正文已注入本轮上下文（context_files 键 skill:<name>），
请直接使用，不要再用 file_read/bash_exec 读取该技能目录——工作区之外不可读。
```

`base_dir` 可保留（诊断用），但同一句里须说明该目录在工作区之外不可读。

**AC-4**：`tests/test_agent_tools.py` 断言 `_tool_skill_use` 的成功返回值
不含 `skill_md=`，且含「不要再用 file_read」字样。

---

## FR-4：never-类别词表单一来源

**文件**：`desktop/src/utils/confirm-scope.ts`、`agenticx/runtime/command_safety.py`

`command_safety.py` L572-573 的注释声明前端 `neverReusableCategories` 必须与后端同步，
但当前 `desktop/src/utils/confirm-scope.ts` 中**不存在**该常量（已 grep 确认无匹配）。

改动意图：在 `desktop/src/utils/confirm-scope.ts` 补上常量并在
「记住此选择 / 复用审批」相关判断中使用：

```ts
/** 与后端 NEVER_AUTO_APPROVED_CATEGORIES 保持一致（agenticx/runtime/command_safety.py）。 */
export const NEVER_REUSABLE_CATEGORIES: ReadonlySet<string> = new Set([
  "destructive_filesystem",
  "external_publish",
  "host_full_access",
  "system_disruption",
]);
```

并在 `ConfirmDialog` 的策略选项计算处（`desktop/src/components/ConfirmDialog.tsx`
现有 `CONFIRM_DIALOG_POLICY_OPTIONS` 使用点，约 L37 附近的 `protectedRequest` 判断旁）
排除「白名单放行 / 低风险自动执行」选项。

**AC-5**：`desktop/src/utils/confirm-scope.test.ts` 断言该集合恰好为上述四项；
`desktop/src/components/ConfirmDialog.test.tsx` 断言 `risk_categories` 含
`destructive_filesystem` 时不提供可复用策略选项。

---

## 临时缓解（已于 2026-08-26 落地，非本 plan 实施项）

在上述改动完成前，A 股日报改由 macOS launchd 直接执行，不经过 agent：

- `~/Library/LaunchAgents/com.damon.astock-daily-report.plist`，工作日 00:17
- 日志：`~/.agenticx/logs/automation/astock-launchd.{out,err}.log`
- 已验证 `runs = 1`、`last exit code = 0`，产出 `daily_report_2026-08-26.md`

同时 `~/.agenticx/automation_tasks.json` 中该任务的提示词已改为直接运行
工作区内脚本、并禁止读取 `~/.agenticx/skills`。FR-2 完成后，可关闭 launchd
改回 Machi 定时任务；在此之前两者并存会导致重复采集，**须择一启用**。

## 验收总表

| 编号 | 验收点 |
|------|--------|
| AC-1 | 危险命令产出精确风险类别；`COMMAND_RISK_CATEGORIES` ⊇ never 集合 |
| AC-2 | `allowed_tools: ["bash_exec"]` 不再放行 `rm -rf` / `shutdown` |
| AC-3 | 新开关仅放行工作区内已存在脚本，六条边界用例全绿 |
| AC-4 | `skill_use` 返回文案不再引导读磁盘 |
| AC-5 | 前后端 never 类别一致，受保护请求不提供复用选项 |
| AC-6 | 定时任务「A股收盘价量日报」在开关开启后端到端跑完并产出当日报告 |
| AC-7 | `agx serve --host 127.0.0.1 --port <临时端口>` 冷启动成功，`/api/session`、`/api/avatars`、`/api/sessions` 返回 200（改过 `server.py` 的强制门槛） |
