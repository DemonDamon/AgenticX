# Plan: AgenticX 运行时不变量内化 05 —— 执行档位（技能静态分档接到安装与加载边界）

Planned-with: GLM-5.4（Trae）
Suggested-Impl-Model: GLM-5.4
Status: implemented
Plan-Id: 2026-11-27-runtime-invariants-05-extension-execution-profile
Parent-Plan: `.cursor/plans/pending/2026-11-27-runtime-invariants-master.plan.md`

> 规划阶段的说明：本环境允许只读探针。本文件的事实来自**阅读核实**（给出 `文件:行号`，行号以当前工作树 `61ffb4d6` 为准）加**已执行的只读验证命令**（下文「规划阶段已执行的探针」清单；基线数字均为实际输出）。没有执行任何写操作（唯一写入的文件是本 plan）。

规划阶段已执行的探针（全部只读）：

1. `/opt/miniconda3/bin/python3 -m pytest tests/test_skill_guard_cls_patterns.py tests/test_skill_import_repo.py tests/test_pending_queue.py tests/test_skillhub_install_guard.py -q --no-cov` → **47 passed**。
2. `/opt/miniconda3/bin/python3 -m pytest tests/test_skillhub_adapter_install.py tests/test_registry_hub_clawhub_owner.py tests/test_action_audit.py -q --no-cov` → **30 passed**。
3. `/opt/miniconda3/bin/python3 -m pytest tests/runtime/test_studio_safety.py -q --no-cov` → **14 passed**。
4. `/opt/miniconda3/bin/python3 -m pytest tests/test_smoke_openskills_skill_bundle.py tests/test_smoke_nexu_skill_metadata.py tests/test_smoke_openclaw_skill_gate.py -q --no-cov` → **57 passed**。
5. `/opt/miniconda3/bin/python3 -m pytest tests/test_skill_manage_rollback.py tests/test_skill_manage_preview_apply.py tests/test_skillhub_agent_tools.py tests/test_skill_freeze.py -q --no-cov` → **11 passed, 1 failed**（`tests/test_skill_manage_rollback.py::test_rollback_to_previous_version`，`TypeError: the JSON object must be str, bytes or bytearray, not coroutine`——本机 HEAD 既有失败，与 05 无关，见核实结论第 7 节 F-9）。
6. `PYTHONPATH=/tmp/agx-ci-deps:"$PWD" /opt/miniconda3/bin/python3 scripts/ci/python-regressions.py` → **243 passed**（门禁基线）。
7. `RATCHET_BASE_REF=HEAD /opt/miniconda3/bin/python3 scripts/ci/ratchet.py` → 5 条规则全部通过（`ledger-read-bypass` 2/2、`checkpoint-save-bypass` 0/0、`resume-anchor-bypass` 0/0、`dispatch-mailbox-bypass` 0/0、`harness-outlet-bypass` 0/0）。
8. 一行式 python 探针（`classify_tier(compute_code_stats(...))` 对五种夹具形态的实测输出）：纯 md → `T-MD`；11 个 `.py` 小文件 → `T-HEAVY`；md 含 `wget` 围栏块 → `T-REF`；**md + `.agx-skill-provenance.json` 侧车 → `T-LITE`**（这条直接决定了 D-3 的隐藏文件排除设计）；references 目录 + 纯 md 无风险块 → `T-MD`（T-MD 判定先于 T-REF，见核实结论第 1 节）。
9. `git grep` 若干：`scan_skill(` 全部调用方（8 行命中 = 1 定义 + 1 内部递归 + 6 个安装入口，与 master plan 现状盘点一致）；`\.tier\b` 全部消费方（4 处，全在 guard 模块内部序列化）；`T-MD|T-LITE|T-REF|T-HEAVY` 字面量（仅 `guard_classify.py`）；技能语料中 `tier:` frontmatter 字段占用（零命中）；`should_allow(` 全部调用方（9 处）；ratchet 候选 pattern 实测（见核实结论第 6 节）。

## Goal

让 master plan 的闭环判据第 5 条成立：**安装一个声明档与实测档不一致的技能包与一个 AGX Bundle，都被拒绝；越权调用的审计记录在重启后仍能查到。**

拆成验收条件：

- **AC-1（单技能包拒绝）**：SKILL.md frontmatter 声明了档位（`tier:`）且与实测档不一致的技能包，经每一条单技能安装路径都被拒绝：`should_allow` 族（skill_manage 写入、pending proposal 批准、import_repo 两条路径）返回阻塞；registry 落盘族（`write_registry_skill` / `write_registry_skill_dir`，覆盖 clawhub 工具、studio `/api/registry/install`、SkillHub 安装、AGX native registry）抛 `SkillProfileMismatchError` 且不写任何字节。拒绝无条件（先于信任级策略，`builtin` 也拒；`acknowledge_high_risk` 不能绕过）。
- **AC-2（AGX Bundle 拒绝）**：bundle 内含档位不一致技能的 AGX Bundle，`install_bundle` 返回 `success=False`、`error_code="tier_mismatch"`，且**零落盘**（技能目录、bundles.json、mcp.json 都不写）；`scan_bundle_source` 的返回载荷列出每个被拒技能的声明档与实测档。声明一致或未声明的 bundle 照常安装。
- **AC-3（越权审计重启可查）**：安装拒绝（`INSTALL_REJECTED` / `BUNDLE_REJECTED`）与加载拒绝（`LOAD_DENIED`）经 `agenticx/runtime/studio_safety.py` 的持久出口落盘：本地 `safety/extension_gate.jsonl` 独立追加文件 + 企业审计 outbox 镜像（`emit_action_audit`）；记录只落盘不进内存，`studio_safety._reset()`（模拟重启，清掉全部内存结构）后从文件仍能查到；非企业桌面（outbox 为 no-op）也至少有本地文件成立。
- **AC-4（一致照常、存量零影响）**：声明档与实测档一致的技能包照常安装与加载；未声明档位的存量技能（全部现有技能，grep 零占用）行为逐字不变：不测、不拒、不审计。
- **AC-5（开关与零回归）**：`AGX_SKILL_PROFILE_GATE=0`（或 `runtime.skill_profile_gate=0`）后，不 attach、不拒绝、不排除、不审计，安装与加载路径与 05 之前逐字一致；47/30/14/57 既有基线与 243 门禁、5 条 ratchet 规则全部保持。

同时满足 master plan「入口」与边界字段的落点约束：不改 `guard_classify.py` 的判定逻辑与 `guard_engine.py` 的规则（只消费 `classify_tier` / `compute_code_stats` 的结论）；`agenticx/safety/audit.py` 的内存环形缓冲不动；`agenticx/studio/server.py` 一行不改（注册表安装路径的拒绝经 `registry_hub` 落盘点覆盖）。

参考依据见 master plan『背景与参考来源』。

## 核实结论

### 0. 阅读范围和方法

阅读 + 只读探针（见头部清单）。引用的行号已在当前工作树 `61ffb4d6` 逐条复核。用到的既有 API（签名、参数名、字段、枚举值）在 Tasks 的「依赖的现有 API」表里给出出处；没有亲自读到的 API 一律不进入代码块，而是列入 `### 未经执行验证的假设清单`。

### 1. 四档现在到底分什么、结果去哪了

**结论：四档是「扫描深度分档」，判定在 `classify_tier`（`guard_classify.py:117-133`），实测档的输出挂在 `ScanResult.tier`（`guard_types.py:60`），但该字段只在 guard v2 引擎里赋值；默认配置跑的是 v1，`tier` 恒为 `None`。全部 6 个安装入口只消费 `verdict`（经 `should_allow` 的信任级策略或裸 `verdict == "dangerous"` 检查），`tier` 从不参与任何安装/加载/执行决策——它只被序列化进扫描载荷与 HTML 报告。05 的实测档因此必须直接调用 `classify_tier`（钉死 `scan_mode="standard"`），不能读 `result.tier`。**

判定规则（`guard_classify.py:117-133`，master plan 写 `118-133`，当前 HEAD 定义起于 `:117`，docstring 在 `:118`——行号偏 1 行，内容一致）：

| 模式 | 规则（按判定顺序） |
| --- | --- |
| `quick` | 恒 `T-MD` |
| `full` | `code_file_count > 0 → T-HEAVY`，否则 `T-REF` |
| `standard`（默认） | ① `all_md 且 high_risk_blocks==0 且 medium_risk_blocks==0 且 code_file_count==0 → T-MD`；② `executable_lines>200 或 code_file_count>10 或 executable_size>100KB → T-HEAVY`（阈值 `:17-19`）；③ `has_references_dir 或 high>0 或 medium>0 → T-REF`；④ 其余 `T-LITE` |

注意 ①在③之前：纯 md 无风险块的技能即使带 `references/` 目录也判 `T-MD`（探针实测确认）。风险块统计来自 `FENCE_BLOCK_RE` 围栏内容（`:25-28,106-113`）。**四档的真实拼写：`T-MD` / `T-LITE` / `T-REF` / `T-HEAVY`（大写连字符），全仓字面量只在 `guard_classify.py`。**

`scan_skill` 的输出结构与分档去向（`guard.py:77-82` 是共享入口）：

- `scan_skill`（`:77-82`）按配置分发 v1 / v2：v2 走 `scan_skill_v2`（`guard_engine.py:390-477`），内部**算了两次**分档——`:405-407` 用（`cfg.scan_mode`，deep 时 `full`）选扫描策略，`:454-456` 用 `cfg.scan_mode` 重算一遍写进 `result.tier`；v1 走 `scan_skill_v1`（`guard_v1.py:216-246`），**不产出 tier**。`GuardConfig` 默认 `version: int = 1`（`guard_config.py:20`）、`scan_mode: "standard"`（`:21`）。
- **分档的全部消费方**（grep `\.tier\b` 实测 4 处）：`guard.py:132`（`scan_skill_deep` 透传）、`guard.py:149-150`（`scan_result_to_payload` 序列化）、`guard_report.py:52`（HTML 报告展示）。没有任何调用方用 tier 做决策。
- 6 个安装入口及其消费方式（行号当前 HEAD 全部命中 master plan 盘点）：

| 入口 | 位置 | 分档消费 |
| --- | --- | --- |
| skill_manage 写入 | `cli/agent_tools.py:11056` `scan_skill` → `:11057 should_allow` | 只用 verdict |
| pending proposal 批准 | `skills/pending_queue.py:141` → `:142 should_allow` | 只用 verdict |
| GitHub 导入 | `skills/import_repo.py:194` → `:195 should_allow` | 只用 verdict |
| GitHub tarball 装技能 | `skills/import_repo.py:380` → `:381 should_allow` | 只用 verdict |
| 注册表包扫描 | `extensions/registry_hub.py:187-198`（`scan_skill_package`，`:198` 调 `scan_skill`） | ScanResult 交给调用方，调用方只看 `verdict`（`agent_tools.py:12165`、`server.py:10554`） |
| AGX Bundle | `extensions/installer.py:198`（`scan_bundle_source` 内）→ `merge_verdicts` → `install_bundle :261-274` | 只用 overall verdict |

`should_allow` 的其余调用方（`agent_tools.py:11135` hook 命令扫描、`:11465` patch 预览、`managed/memory_dream.py:231`、`learning/skill_quality_gate.py:142`）全部走 `scan_skill_markdown_text`（纯文本、无目录），这些路径天然不涉档位。

**对设计的影响**：(a) 实测档用 `classify_tier(compute_code_stats(dir), scan_mode="standard")` 直接算，与 guard 版本、扫描模式、深度解耦——否则 `quick` 模式会把所有技能判成 `T-MD` 产生海量假拒绝；(b) 校验挂在 `scan_skill` 包装层（`guard.py:77`），v1/v2 都生效，master plan「约束接在共享的扫描结论处」正是这一层；(c) 6 个入口分两族：`should_allow` 族（4 个，改一处全生效）与「verdict-only + 落盘」族（注册表族经 `write_registry_skill*`、bundle 族经 `install_bundle`），需要各自接门。

### 2. 声明档放哪里

**结论：声明档放 SKILL.md frontmatter 顶层标量 `tier:`，词表限定四档；bundle manifest（`agx-bundle.yaml`）不加字段——bundle 内技能自带 SKILL.md，`scan_bundle_source` 逐技能扫描时自然读得到。缺省值=未声明 → 跳过校验（存量技能零影响）；声明了但取值不在四档内 → 同样跳过（记 warning），不拒绝。frontmatter 解析现状与兼容性如下。**

- **技能 frontmatter 现状**（`skills/frontmatter.py`）：解析的标量是 `name` / `description` / `source`（`_frontmatter_get_scalar`，`:32-37`）；`normalize_skill_md`（`:69-112`）与 `ensure_skill_source`（`:115-132`）**逐字保留未知字段**（只重写 name/description/source 行），所以加 `tier:` 不会破坏任何写入路径。loader 侧（`tools/skill_bundle.py:931-945`）另解析 `tag` / `icon` / `examples` / `requires` / `metadata.agenticx.gate`，未知键静默忽略（`_parse_frontmatter_scalar`，`:1019-1027`）。
- **bundle manifest 现状**（`extensions/bundle.py`）：`agx_bundle` / `name` / `version` / `description` / `author` / `license` + `components.skills[].{path,description}`（`BundleSkillRef :70-78`；解析 `:207-225`）——没有档位字段，`_parse_skills` 对未知键静默丢弃。
- **命名冲突实测**：全部内置技能语料 `tier:` 零占用（grep `^tier:` SKILL.md 无命中）；全仓 `execution_profile` / `execution_tier` 零占用。字段名选 `tier` 的理由：(1) 与 `ScanResult.tier`、`classify_tier`、扫描载荷里的 `"tier"` 键（`guard.py:149-150`）同一词汇，声明与实测对得上号；(2) near-plugin plan（插件包 manifest 解析与静态安全扫描，本仓库没有该文件）合入后如需在 manifest 侧声明，只需扩展 `read_declared_tier` 这一个函数（manifest 值→frontmatter 值的映射收敛在一处），SKILL.md 侧字段不动——这就是留给它的兼容余量。备选 `execution_tier:`（更冷门、零冲突风险）被否：多一个词汇就多一处 schema 对齐面，且与既有 `tier` 载荷键割裂。
- **未声明与非法值的处置**（兼容性关键，需主会话确认，见「已定案事项」D-b）：未声明 → 完全跳过（存量技能没有任何 `tier:` 行，强制声明会把整个生态一次性全部拒之门外，违背「先接现有四档」的最小化边界）。取值非法（如 `tier: premium`）→ 按未声明跳过 + `logger.warning`：恶意方本来就能靠「不声明」绕过（未声明=无契约），拒绝非法值不增加任何安全性，只会误伤第三方技能对 `tier` 一词的无关用法；但记录 warning 让打错字（`T-MDF`）的作者能在日志里看到。读取时做 `strip().strip("\"'").upper()` 归一（`"T-md"` 等价 `"T-MD"`），降低大小写笔误的假阴性。
- **对实测档的一个关键陷阱（探针实锤）**：`compute_code_stats` 不跳过隐藏文件（`guard_classify.py:78-96` 无 dot-file 过滤），而安装器会往技能目录写 `.agx-skill-provenance.json`（`.json` 扩展名）——探针实测：纯 md 技能 + provenance 侧车 → 实测从 `T-MD` 掉到 `T-LITE`。skill_manage 的安装序恰好是「先写 provenance 再 scan_skill」（`agent_tools.py:11049-11056`），注册表族装完也写 provenance——**如果不处理，任何声明 `T-MD` 的技能都会被安装器自己的簿记文件打假**。05 的实测函数必须把隐藏文件排除在测量外（D-3；与 `write_registry_skill_dir` 拷贝时跳过 dot-file 的既有行为 `registry_hub.py:831` 一致：装进去的内容本来就是「可见文件集」）。**不改动 `compute_code_stats` 本身**（那会改变 v2 引擎自己的分档输出=改扫描结论，越界）。

### 3. 「执行类调用」在现状里的落点与统一口径

**结论：技能没有独立 execute()——「执行」一个技能=把 SKILL.md 内容注入 agent 上下文，现状有三条方法面：`SkillTool` 的 `list`（元数据，`skill_bundle.py:1319-1367`）、`read`（`get_skill_content`，`:1168-1204`，`_handle_read :1369-1391`）、`process_llm_request` 渐进注入（`:1393-1439`，同样走 `get_skill_content`）；技能里的脚本由 agent 经 `bash_exec` 等通用工具执行，属既有 guardrail 面，05 不碰。三条方法全部以 `loader._skills` 为唯一事实源。统一口径：安装边界逐安装路径硬拒绝（不一致的包不落盘）；加载边界在 `SkillBundleLoader.scan()` 一次性把不一致的技能挡在 `_skills` 之外——此后 list 不可见、read 取不到内容、注入无内容可注，**逐方法都过同一道门**；运行期不再拦。这与「只在安装与加载边界校验」自洽：read/注入是「加载」的消费动作，其内容在 scan 时已验证。**

执行面逐条核实：

| 方法 | 入口 | 数据源 | 05 后的行为 |
| --- | --- | --- | --- |
| `list` | `SkillTool._handle_list :1319` → `loader.list_skills() :1206` | `_skills` | 不一致技能不在列表（未登记） |
| `read` | `SkillTool._handle_read :1369` → `loader.get_skill_content :1168` | `_skills`（`get_skill :1154-1166`） | 返回 None → 上层报 not found |
| 渐进注入 | `process_llm_request :1393-1439` | 同上 | `skill_content` 为空 → 不注入（`:1420-1422` 既有分支） |
| `get_skill_variants` | `:1229-1233` | `_skill_variants` | 登记发生在 variants 写入**之前**被挡（见下） |

「逐方法鉴权」的实现落点：把门放在 `scan()` 的候选循环里、**variants 登记（`:826-831`）之前**（而不是 `get_skill_content` 内逐次校验），理由：(a) `get_skill_content` 的注入消费方（`process_llm_request`）绝不能把拒绝文案当指令注入，返回 None 是既有安全分支；(b) scan 一次一测（只测声明了档位的技能，成本受控），逐 read 一测会让注入路径在每轮 LLM 调用上都做目录扫描；(c) 挡在登记前保证 `get_skill_variants` 也不泄漏。复用既有 gate-check 的代码形态（`_check_gate` 块 `:870-876` 同款 warning+continue）。备选「在 `get_skill_content` 里逐调用鉴权」被否：注入路径语义危险 + 成本高，且 `_skills` 已挡时它是死代码。

master plan 原文「执行类调用逐方法鉴权」与「只在安装与加载边界」的 reconciliation（写进 Design D-5，需实施者原样理解）：参考实现取的是「host API 按能力域逐方法授权」；AgenticX 技能的 host API 就是 loader 的服务面（list/read/variants/inject），四个方法各自独立消费 `_skills`——把不一致技能挡在 `_skills` 之外，等于每个方法都通过了同一道档位鉴权，而校验动作只发生在安装与加载两个边界，运行期（bash_exec 等）不再拦。

### 4. 审计落盘

**结论：「重启后仍能查到」用 studio_safety 的持久出口，推荐给档位事件开独立的追加文件 `safety/extension_gate.jsonl`（同款 20MB 上限与丢弃语义），企业镜像复用既有 `_bridge_enterprise`（`emit_action_audit`）。不复用 `safety/events.jsonl`：它与 pipeline 高频事件（含每 20 次调用 1 条的 PASS_THROUGH 采样，`studio_safety.py:188-209`）共享 20MB 预算且满盘后丢新事件（`:103-110`），低频高价值的档位拒绝可能恰好在满盘窗口被丢；独立文件让闭环判据「重启后仍能查到」不依赖 pipeline 文件的容量状态，测试也不用填 20MB 来验证独立性。内存 `SafetyAuditLog`（`safety/audit.py:36-41`，deque 环形缓冲，重启即丢）按 master plan 已定不作持久出口，且其 `SafetyStage` 枚举没有档位事件类型——不动它，也不给它加。**

三路分发与两个持久出口的现状（`agenticx/runtime/studio_safety.py`）：

- `_record`（`:154-212`）是三路分发的汇点：内存环（`layer.audit_log`）→ `_append_events`（`:95-117`，本地 `~/.agenticx/safety/events.jsonl`，`_events_path :91-92`）→ `_bridge_enterprise`（`:120-144`，`emit_action_audit`）。满盘语义：`path.stat().st_size >= 20MB` 即丢弃直到轮换（`:103-110`，仓库内**没有**自动轮换代码，grep `rotate` 仅此一处 warning 文案）——已写入的行不丢，丢的是满盘后的新事件。
- 企业侧 `emit_action_audit`（`action_audit.py:116-142`）：`audit_enabled()`（`:58-69`）要求 `enterprise.enabled=True` 且有 token，否则整条 no-op；outbox `~/.agenticx/action_audit/outbox.jsonl` 同样 20MB 满即丢（`:128-136`），但设计上由桌面 uploader 拉走清空。`_bridge_enterprise` 把任意 record dict 映射成 outbox 行：`kind="safety_event"`、`subject=f"{stage}:{action}"`、`decision_source=f"studio_safety/{mode}"`（`:128-142`）——record 的键集与 `_record` 产出一致（`ts/stage/tool_name/action/rule_ids/severity/details/mode/latency_ms/session_id/tool_call_id/agent_id/args_digest`，`:172-186`）。
- 测试隔离：`tests/conftest.py` 的 autouse fixture 把 `$HOME` 指到每测沙箱，`agx_home()` 是调用时解析（`utils/agx_home.py:123-125`），所以档位审计测试不需要 patch 路径函数——直接读 `agx_home()/"safety"/"extension_gate.jsonl"` 即可；`tests/runtime/test_studio_safety.py:28-35` 的 `_events_path` monkeypatch 模式可作备选。

**对设计的影响**：`studio_safety.py` 新增 `_GATE_EVENTS_NAME = "extension_gate.jsonl"`、`_gate_events_path()`、`_append_gate_events()`（复用 `_lock` 与 `_append_events` 同款容错）和公共 `emit_extension_gate_event(record)`（补默认 `ts` 后写独立文件 + `_bridge_enterprise([record])`）。档位事件不进内存环（`audit.py` 冻结 + 枚举不含）——master plan 说「三路分发落盘：本地 events.jsonl 与企业 outbox」中的持久两路都覆盖，内存路刻意不参与并在 docstring 写明。20MB 独立预算：档位事件低频（安装/加载拒绝），独立上限与丢弃语义和 pipeline 文件保持同款常数风格。

### 5. 安装入口的完整清单与测试基线

**结论：单技能安装分两族（`should_allow` 族 4 条路径 + registry 落盘族，后者是 clawhub 工具、studio `/api/registry/install`、SkillHub、AGX native registry 的共同汇合点 `write_registry_skill*`，studio server.py 不改也能被覆盖）；AGX Bundle 安装唯一入口是 `install_bundle`（桌面 bootstrap 与 studio 端点都经它）。AGX Bundle 当前没有任何测试（`test_bundle_mcp_source.py` 只剩 pycache，源文件已不存在），05 的两个「拒绝」判据全部可以用本地目录密闭构造，不需要网络。基线数字见头部探针清单。**

入口全景（两类、七族、全部经 `scan_skill` 或落盘函数）：

| # | 安装族 | 入口函数 | 决策点 | 05 接门位置 |
| --- | --- | --- | --- | --- |
| 1 | agent 写技能（create/update/patch apply） | `agent_tools.py:11049-11062` | `should_allow :11057` | `should_allow`（改一处） |
| 2 | pending proposal 批准 | `pending_queue.py:139-158` | `should_allow :142` | 同上 |
| 3 | GitHub 导入 | `import_repo.py:168-215` | `should_allow :195` | 同上 |
| 4 | GitHub tarball | `import_repo.py:345-419` | `should_allow :381` | 同上 |
| 5 | clawhub_install 工具 | `agent_tools.py:12162-12190`（verdict gate `:12165`，写 `:12178`） | verdict-only + 落盘 | `write_registry_skill_dir`（raise） |
| 6 | studio `/api/registry/install`（**server.py 不可改**） | `server.py:10510-10581`（verdict gate `:10554`，写 `:10569`） | verdict-only + 落盘 | 同上（经 `write_registry_skill_package → write_registry_skill_dir`） |
| 7 | SkillHub 确定性安装 | `skillhub_adapter.py:504-630`（文本扫描 `:535/:604`，写 `:551/:620`） | verdict-only + 落盘 | 同上 |
| 8 | AGX native registry | `registry_hub.py:862-872` / `:874-885` → `write_registry_skill :780` | 落盘 | `write_registry_skill`（raise） |
| 9 | AGX Bundle | `installer.py:223-384`（`scan_bundle_source :179` 内 `scan_skill :198`；桌面 `delivery/bootstrap.py:40-44` 与 `server.py:10323-10364` 都经它） | overall verdict | `install_bundle`（error_code=tier_mismatch，零落盘） |

值得主会话知晓的既有缺口（F-5）：SkillHub 安装路径只扫 SKILL.md **文本**（`scan_skill_markdown_text`），附属文件（`scripts/` 等）不经过任何模式扫描就随 `write_registry_skill_dir` 落盘。05 的档位门放在落盘点恰好让这条路径获得「声明与实测一致」的约束，但**深度模式扫描的补齐不在 05 范围**（那是扫描规则面）。

测试基线（规划阶段实际执行，见头部）：

| 测试 | 基线 |
| --- | --- |
| `test_skill_guard_cls_patterns.py` + `test_skill_import_repo.py` + `test_pending_queue.py` + `test_skillhub_install_guard.py` | 47 passed |
| `test_skillhub_adapter_install.py` + `test_registry_hub_clawhub_owner.py` + `test_action_audit.py` | 30 passed |
| `tests/runtime/test_studio_safety.py` | 14 passed |
| `test_smoke_openskills_skill_bundle.py` + `test_smoke_nexu_skill_metadata.py` + `test_smoke_openclaw_skill_gate.py` | 57 passed |
| `test_skill_manage_rollback.py` + `test_skill_manage_preview_apply.py` + `test_skillhub_agent_tools.py` + `test_skill_freeze.py` | 11 passed, **1 failed（F-9 既有）** |
| 门禁 `python-regressions.py` | 243 passed |
| ratchet | 5 条全过 |

任务给定本机既有失败（验收口径「与实施前一致」）：`tests/test_meta_tools.py::test_meta_tools_list_skills_and_mcps`（本机全局 MCP 配置）、`tests/test_studio_server.py` 4 例；**另有 F-9 一例任务清单未列**（见第 7 节）。

### 6. ratchet：提或不提

**结论：不提议新规则。现有 5 条一条不调大、一条不触发；05 的全部代码（含测试）不引入这 7 个字面量：`run_dir / "events.jsonl"`、`runs/*/events.jsonl`、`save_agent_state(`、`project_resume_anchor(`、`.mailbox.json`、`.context.json`、`RunEvent(`。**

不提的理由（每条都有实测支撑）：

1. **05 的不变量形态与 01/03/04 不同。** 已有规则锁的是「唯一构造点」型不变量——`RunEvent(`、`save_agent_state(`、`.mailbox.json` 这类字面量在合法归属地之外基线为 0，新增即违规。05 的门是「经共享扫描结论 / 经落盘函数」的**结构性**约束：绕过它意味着新增一条完全不经 `scan_skill` 也不经 `write_registry_skill*` 的技能落盘路径——那是一个新函数 + 显式的复制代码，评审直接可见，没有可归零的字面量代理能抓住「悄悄冒出来的新安装路径」（`shutil.copytree` / `mkdir` / `write_text` 都是通用原语，实测大量合法命中）。
2. **候选 pattern 实测都会命中合法使用者。** `classify_tier(` 现有调用方仅 `guard_engine.py:406,456`（基线 2），05 的 `profile_gate.py` 会让基线变成 3 且无法区分合法/非法调用者；`write_registry_skill_dir(` 现有 3 个合法调用点（`registry_hub.py:844-860` 内部转发 + `skillhub_adapter.py:551,620`）；四档字面量 `T-MD` 等若锁死在 `guard_classify.py` + `profile_gate.py`，near-plugin plan 合入后其 manifest schema 处理大概率需要引用档位词汇，规则会变成跨 plan 的摩擦面。
3. master plan 02 节只给 01、04 指派了后续规则（「子 plan 01、04 产出后各接一条」），05 未被指派；风险条「档位设计过度」的缓解就是最小化。

### 7. 与 master plan 假设不同、或需主会话知晓的事实

- **F-1 默认 guard 是 v1，v1 不产出 tier。** `GuardConfig.version` 默认 1（`guard_config.py:20`），`scan_skill_v1` 不算分档（`guard_v1.py:216-246`）；master plan「技能静态扫描已有四档」只在 v2 配置、deep 扫描、或直接调 `classify_tier` 时成立。影响：05 的实测档直接调 `classify_tier`（D-3），不依赖引擎版本。需在 v2 下冒烟一次（Verification）。
- **F-2 `classify_tier` 依赖 `scan_mode` 参数。** `quick` 恒 `T-MD`、`full` 把有代码的技能全推 `T-HEAVY`（`guard_classify.py:119-122`）——档位测量必须钉死 `standard`，否则操作员改扫描模式会制造系统性假拒绝/假通过。`scan_skill_v2` 自己也用一个模式算策略、另一个（同配置）算 `result.tier`（`guard_engine.py:405-407,454-456`），进一步说明 `result.tier` 不是稳定的判据来源。
- **F-3 provenance 侧车会打假 T-MD 声明。** 探针实测：`.agx-skill-provenance.json`（安装器簿记，`.json` 扩展名）会把纯 md 技能的实测档从 `T-MD` 推到 `T-LITE`（`compute_code_stats` 不过滤隐藏文件，`all_md` 破坏）。D-3 的测量函数必须把隐藏文件排除在测量外（staging 只拷可见文件），且**不能**改 `compute_code_stats`（那会改 v2 引擎自己的扫描结论，越界）。
- **F-4 `scan_skill` 调用方数量与 master plan 一致**（6 个安装入口；grep 共 8 行 = 定义 `guard.py:77` + 内部递归 `:96` + 6 个入口），行号在当前 HEAD `61ffb4d6` 逐条复核全部命中 master plan 盘点（`installer.py:198`、`registry_hub.py:198`、`import_repo.py:194,380`、`pending_queue.py:141`、`agent_tools.py:11056`）。
- **F-5 SkillHub 安装路径的附属文件不经模式扫描**（`skillhub_adapter.py:535,604` 只扫 SKILL.md 文本；`write_registry_skill_dir` 整目录落盘）。05 在落盘点接档位门后这条路径至少受「声明与实测一致」约束；深度扫描补齐不在 05 范围。
- **F-6 `installer.py:301-315` 的 MCP 合并现状**：逐 server 读 JSON 配置文件、整个对象塞进 `mcpServers[name]`（`:302-314`），`_save_mcp_json` 原子替换（`:159-171`）。MCP server 配置没有四档语义（不是技能内容、guard 扫描不覆盖、没有 SKILL.md 载体）——**05 不给它定档**，记录为 near-plugin plan 合入后的 manifest 演进点（master plan「bundle 内的 MCP server 配置怎么定档」的答案：不定，写明理由）。
- **F-7 既有 `should_allow` 文案风格是英文短句**（`"blocked: dangerous (community source, N findings)"` 等，`guard.py:184-192`）——05 的拒绝文案接同一风格：`"blocked: tier mismatch (declared T-MD, measured T-HEAVY)"`；两个面向用户/agent 的中文格式化函数（`format_guard_rejection_message :212-240`、`format_guard_block_for_user :243-262`）需补一行档位说明（03 的教训：文案必须逐字一致，测试断言钉死）。
- **F-8 `conftest.py` 的 HOME 沙箱**（autouse，每测独立 tmp_path）使 `agx_home()` 与调用时 `Path.home()` 自动隔离；但 `installer.py` 的五个路径常量是**模块级** `Path.home()`（`:35-40`），import 时定死——bundle 测试必须显式 monkeypatch `_AGENTICX_HOME` / `_BUNDLES_JSON` / `_SKILLS_BUNDLES_DIR` / `_AVATARS_PRESETS_DIR` / `_MEMORY_TEMPLATES_DIR` / `_MCP_JSON` 六个常量（Task 2 测试夹具）。
- **F-9 `tests/test_skill_manage_rollback.py::test_rollback_to_previous_version` 在当前 HEAD 本机失败**（`TypeError: the JSON object must be str, bytes or bytearray, not coroutine` + `coroutine '_tool_skill_manage' was never awaited`，单独复跑同样失败）——任务给定已知失败清单之外的一例，与 05 无关（async 工具调用未 await 的既有缺陷），验收按「与实施前一致」口径，需主会话确认。
- **F-10 AGX Bundle 无任何现存测试**（全 tests/ 无 `install_bundle`/`parse_bundle_manifest` 引用；`test_bundle_mcp_source` 仅剩 `__pycache__` 里的 pyc）。05 的 AC-2 测试是 bundle 安装的第一批密闭测试（本地目录构造 manifest + 技能，无网络）。
- **F-11 master plan 行号复核**（`61ffb4d6` vs main `90a53345`）：`guard_classify.py:118-133` → 实际 `:117-133`（偏 1）；其余 `guard.py:77`、`installer.py:198`、`installer.py:301-315`、`studio_safety.py:42,103-110`、`audit.py:36-41`、`registry_hub.py:198`、`import_repo.py:194,380`、`pending_queue.py:141`、`agent_tools.py:11056` 全部仍准。
- **F-12 near-plugin plan 重叠**：`2026-11-17-near-plugin-package-adoption-master.plan.md`（插件包 manifest 解析与静态安全扫描）不在本仓库。05 按自包含设计：声明档字段的读取收敛在 `profile_gate.read_declared_tier` 一处，SKILL.md `tier:` 字段与 `normalize_skill_md` 的未知字段保留语义（F-2 节）保证 near-plugin 合入后无需改动既有技能即可对齐；plan 落地后如需对齐 schema，改一个函数即可。

## Root cause

闭环判据今天不成立，是四个缺口叠加：

1. **分档无消费**：四档只是扫描结论（`result.tier`，v2 才有），6 个安装入口全部只看 `verdict`；没有任何安装、加载、执行决策读档位（核实结论 1）。
2. **声明档不存在**：frontmatter 与 bundle manifest 都没有档位字段，"声明 vs 实测"无从谈起（核实结论 2）。
3. **加载无门**：`SkillBundleLoader.scan()` 只做 frontmatter 解析 + gate + 去重，装完之后的目录内容可以任意变化，注入 agent 的内容与装时扫描的内容之间没有不变量（核实结论 3）。
4. **拒绝与越权无持久审计**：现有的持久出口是 pipeline 事件的 `safety/events.jsonl`（与档位无关、满盘丢新）与企业 outbox；`SafetyAuditLog` 是内存环（核实结论 4）。

实施者可以用这条链自查：Task 1 完成后缺口 2/4 关闭（字段存在、审计出口存在、`should_allow` 族拒绝生效）；Task 2 完成后缺口 1 对注册表族与 bundle 族关闭（全部落盘路径有门）；Task 3 完成后缺口 3 关闭（加载面闭环，AC-3 的 LOAD_DENIED 可测）。

## Design

每个决定写清选了什么、备选是什么、为什么。

### D-1 声明档字段：SKILL.md frontmatter 顶层标量 `tier:`

- 选了：`tier: T-MD|T-LITE|T-REF|T-HEAVY`（读时 `strip().strip("\"'").upper()` 归一）。未声明 → 跳过；非法值 → 跳过 + warning。bundle manifest 不加字段。
- 备选甲：`execution_tier:`（更冷门）——弃：与 `ScanResult.tier`、载荷 `tier` 键词汇割裂。备选乙：manifest 侧声明（`components.skills[].tier`）——弃 v1：bundle 内技能自带 SKILL.md，一处声明两个入口只会制造「frontmatter 与 manifest 打架」的新不变量；near-plugin 合入后若需要 manifest 声明，在 `read_declared_tier` 一个函数里扩展映射（F-12 的兼容余量）。
- 非法值不拒绝的理由见核实结论 2（恶意方靠省略即可绕过，拒绝非法值零安全增益、纯增生态误伤）；warning 保证打字错误可见。
- master plan「声明档与实测档不一致即拒绝」的无条件性落在拒绝动作上（D-4/D-6/D-7：先于信任级、不可 ack），不落在「必须声明」上——强制声明会拒绝全部存量技能，违背「先接现有四档」的边界。

### D-2 实测档：直接消费 `classify_tier`，钉死 `standard` 模式

- 选了：`measure_tier(skill_dir) = classify_tier(compute_code_stats(staged_visible_copy), scan_mode="standard")`。测量先 staging（只拷非隐藏文件到临时目录）再算。
- 钉死 `standard`：`quick` 恒 `T-MD`、`full` 恒重侧（F-2），操作员改扫描模式不能改变档位契约；测量与安装/加载两侧必须同一模式。
- staging 排除隐藏文件：`.agx-skill-provenance.json` 侧车会把 `T-MD` 打成 `T-LITE`（F-3 探针实锤），且 `write_registry_skill_dir` 落盘时本来就跳过 dot-file（`registry_hub.py:867`）——注册表路径的「装进去的内容」与「测量的内容」同构。bundle（`copytree` 全量拷贝）与 GitHub tarball（`os.rename` 全量落盘）两条路径不保证这一同构，属既有拷贝语义，本 plan 不改（见「实施后评审处置」#3 的接受理由）。不改 `compute_code_stats`（v2 引擎自己也在用它，改它=改扫描结论，越界）。
- 备选：读 `result.tier`——弃：v1 引擎不产出（F-1）、`scan_mode` 敏感（F-2）、同一函数里被算两次（核实结论 1）。

### D-3 新模块 `agenticx/skills/profile_gate.py`（档位门的全部原语）

- 选了：单一新模块承载 `SKILL_TIERS`、`SkillProfileMismatchError`、`read_declared_tier`、`measure_tier`、`measure_tier_from_markdown`、`check_skill_profile` / `check_skill_profile_text`、`note_profile_rejection`。`SkillProfileCheck` dataclass 放 `guard_types.py`（`ScanResult` 的新字段引用它，`guard_types` 不 import 任何 skills 模块，保持自包含）。
- `check_skill_profile` 先查开关（`skill_profile_gate_enabled`，函数内 import `harden_flags`），关→`None`；再读 SKILL.md frontmatter，无合法声明→`None`；再测量比对。
- `note_profile_rejection`（函数内 import `studio_safety`）把拒绝落两路持久出口，吞一切异常——**审计失败绝不影响拒绝本身**。
- `skills` 包对 `agenticx.runtime` 的 import 全部函数级（现状 `agenticx/skills/*.py` 对 `agenticx.runtime` 模块级引用为零，grep 实测；`tools/skill_bundle.py` 已有模块级 runtime import，但 skills 包保持零边——04 的 D-9 同款纪律）。

### D-4 校验挂点：`scan_skill` 包装层 + `should_allow` 硬阻塞（单技能 `should_allow` 族）

- 选了：`scan_skill`（`guard.py:77-82`）在 v1/v2 结果返回后统一 attach `result.profile = check_skill_profile(skill_dir)`（目录扫描才做；文本路径 `scan_skill_markdown_text` 天然不涉及）。`should_allow`（`:176-193`）在信任级策略**之前**检查 `profile.ok`，不通过即拒绝（含 `builtin`），文案 `"blocked: tier mismatch (declared {d}, measured {m})"`。
- 这就是 master plan 说的「约束接在共享的扫描结论处」：4 条 `should_allow` 族安装路径（skill_manage 写入、pending 批准、import_repo×2）改一处全生效；`scan_result_to_payload` 透出 `profile` 块（API/UI 可见）；两个中文格式化函数补一行档位文案（pending_queue 与 agent_tools 的用户面，F-7）。
- 备选：把档位 mismatch 做成一条 `dangerous` finding 塞进扫描结果——弃两处：(a) 那是改扫描规则/裁决语义（越界）；(b) verdict 通道在 clawhub/studio 路径上是可 ack 的（`acknowledge_high_risk`，`agent_tools.py:12164-12177`、`server.py:10554-10560`），ack 后照装——违背「即拒绝」。
- `scan_skill_deep`（`guard.py:126-134`）重建 `ScanResult` 时透传 `profile`（LLM 复核过滤 findings 不该丢档位结论）。

### D-5 执行面统一口径：安装拒绝 + 加载不登记 + 运行期不拦

（核实结论 3 的完整论证。）安装边界按 D-4/D-6/D-7 逐路径拒绝；加载边界在 `SkillBundleLoader.scan()` 候选循环的 variants 登记（`:826`）之前插入档位门——声明了档位且当前实测不一致的技能不进 `_skills`/`_skill_variants`，`note_profile_rejection(action="LOAD_DENIED", boundary="load")` 落审计；`list` / `read` / `get_skill_variants` / `process_llm_request` 四个方法因为共享 `_skills` 事实源而全部自然关死。运行期（bash_exec 等工具面）零改动。技能检测成本受控：只对**声明了档位**的技能测量（存量技能零开销），扫描期每技能一次。

### D-6 注册表落盘族：`write_registry_skill` / `write_registry_skill_dir` 硬门（raise）

- 选了：两函数在写盘**之前**跑 `check_skill_profile`（dir 族测 `src_dir`；md-only 族用 `check_skill_profile_text(stamped)` 测文本），不一致 → `raise SkillProfileMismatchError(...)` + 审计。这一族覆盖 clawhub 工具、studio `/api/registry/install`（server.py 不可改，F-8 约束下唯一的覆盖点）、SkillHub、AGX native registry 四条路径。
- raise 而非返回错误：函数签名是 `-> Path`，三个调用方（`agent_tools.py:12178`、`server.py:10569`、`skillhub_adapter.py:551,620`）要么有宽捕获要么外层 try/except（`server.py:10501-10508`）；异常冒泡即「拒绝成立」。门放在 `rmtree` 旧目录**之前**（拒绝不破坏已装内容）。
- 备选：改 clawhub 工具与 studio 端点各自接门——弃：studio 端点在不可改清单里；且落盘函数是四条路径的唯一汇合点（现状盘点核实结论 5 表）。

### D-7 AGX Bundle：`install_bundle` 整包拒绝（error_code=tier_mismatch）

- 选了：`scan_bundle_source`（`installer.py:179-208`）在既有逐技能循环里收集 `profile_rejects`（技能名 + 声明档 + 实测档），载荷新增 `profile_rejects` 键（`scan_result_to_payload` 的 `profile` 块同时仍在 `skills[]` 里）；`install_bundle` 在 verdict 检查之后、`with _lock:` 拷贝之前：`profile_rejects` 非空 → 逐技能审计 + `InstallResult(success=False, error_code="tier_mismatch", error="tier mismatch: <name> (declared D, measured M)")`——零落盘（技能目录/bundles.json/mcp.json 全不写）。
- bundle 的 MCP server 配置（`:301-315`）**不定档**（F-6）：无四档语义载体；拒绝只针对技能组件。写进代码注释与 Out of scope。

### D-8 审计出口：独立追加文件 + 企业镜像

- 选了：`studio_safety.py` 新增 `safety/extension_gate.jsonl`（`_gate_events_path()` 调用时经 `agx_home()`），20MB 同款上限 + 满盘丢弃 + warning；公共入口 `emit_extension_gate_event(record)`：补默认 `ts` 后 `_append_gate_events([record])` + `_bridge_enterprise([record])`。record 形状与 pipeline 记录同构（`stage="extension_profile_gate"`、`action ∈ {INSTALL_REJECTED, BUNDLE_REJECTED, LOAD_DENIED}`、`rule_ids=["tier_mismatch"]`、`severity="WARN"`、`mode="enforce"`、`details="declared=D measured=M boundary=B"`），这样 `_bridge_enterprise` 的键映射（subject=`stage:action`、decision_source=`studio_safety/enforce`）零改动可用。
- 内存环不参与（`audit.py` 冻结、`SafetyStage` 枚举无档位事件、master plan 已定它不作持久出口）——docstring 写明。
- 复用 `events.jsonl` 的否决理由与「重启可查」论证见核实结论 4。20MB 独立预算沿用同款常数风格；档位事件低频，独立文件实际长期远低于上限。

### D-9 开关：`AGX_SKILL_PROFILE_GATE` / `runtime.skill_profile_gate`，默认 True

- 选了：`harden_flags.skill_profile_gate_enabled()`（`_resolve_bool`，插在 `harness_ledger_events_enabled` 之后，01/03/04 同款）。关闭后：`check_skill_profile` 直接返回 `None` → `scan_skill` 不 attach、`should_allow` 无档位分支、落盘函数不 raise、loader 不排除、零审计——安装与加载路径与 05 前逐字一致（AC-5）。
- 备选：默认关——弃：闭环判据是要内化的不变量，与 01（D-2）/03（D-11）/04（D-1）的口径一致；`AGX_SKILL_PROFILE_GATE=0` 提供即时回滚。
- 不拆「安装门/加载门」两个开关：同一契约的两侧，拆开会出现「装时验证过、加载时不验」的中间态，没有独立价值。

### D-10 ratchet：不新增（核实结论 6 的完整论证）

现有 5 条规则与基线零触碰；新代码自查不含 7 个禁用字面量。

### D-11 不改的东西（及为什么）

- `guard_classify.py` / `guard_engine.py` / `guard_v1.py` / `guard_patterns.yaml`：判定与规则零改动（只被 import 消费）。
- `agenticx/safety/audit.py`：内存环不动（边界第 3 条）。
- `agenticx/studio/server.py`：不改（任务边界第 6 条）；其注册表安装路径经 D-6 覆盖，bundle 端点经 D-7 覆盖（`install_bundle` 内拒绝，server 只透传 `InstallResult`）。
- `TRUST_POLICY` 矩阵与 verdict 语义：档位拒绝是独立的硬门，不改写 verdict/findings。
- `skills_list_api.py`：从 `loader.scan()` 取数，loader 门生效即生效，零改动。
- MCP server 配置：不定档、不校验（D-7/F-6）。
- `skillhub_install_guard.py`：是提示词意图分类器不是安全守卫（读全文核实），与档位无关。

### 仓库对新 Python 文件的惯例（新代码遵守）

- 包内库模块：首行 docstring，末尾一行 `Author: Damon Li`，`from __future__ import annotations`，绝对导入，注释与 docstring 英文；业务文案（面向用户的拒绝提示）沿用所在函数的既有中文风格。
- 测试文件：首行 docstring + `Author: Damon Li`；夹具全部密闭（tmp_path 构造技能目录与 bundle 目录，无网络）；每个测试读盘断言（审计）直接读 `agx_home()` 下的文件（conftest HOME 沙箱已隔离），不跨测试文件 import 夹具（复制小 helper）。
- 环境变量前缀 `AGX_`，配置键 `runtime.*`，布尔开关经 `harden_flags._resolve_bool`；新开关有关闭后回旧行为的测试。
- ratchet 禁用字面量（现有 5 条规则）不得出现在新代码：`run_dir / "events.jsonl"`、`runs/*/events.jsonl`、`save_agent_state(`、`project_resume_anchor(`、`.mailbox.json`、`.context.json`、`RunEvent(`。
- `agenticx/skills/` 包不新增对 `agenticx.runtime` 的模块级 import（`profile_gate` 内全部函数级）。

## In scope

- `agenticx/skills/profile_gate.py`（新）：档位门原语 + 审计辅助。
- `agenticx/skills/frontmatter.py`：公共 `get_frontmatter_scalar`（复用既有私有 helper）。
- `agenticx/skills/guard_types.py`：`SkillProfileCheck` dataclass；`ScanResult.profile` 字段。
- `agenticx/skills/guard.py`：`scan_skill` attach、`scan_skill_deep` 透传、`scan_result_to_payload` 透出、`should_allow` 硬阻塞、两个格式化函数补档位行。
- `agenticx/runtime/studio_safety.py`：`emit_extension_gate_event` + 独立追加文件 sink。
- `agenticx/runtime/harden_flags.py`：`skill_profile_gate_enabled`。
- `agenticx/extensions/registry_hub.py`：`write_registry_skill` / `write_registry_skill_dir` 硬门。
- `agenticx/extensions/installer.py`：`scan_bundle_source` 收集 + `install_bundle` 拒绝。
- `agenticx/tools/skill_bundle.py`：`scan()` 加载门（variants 登记前）。
- 两个新测试文件（`tests/test_skill_profile_gate.py`、`tests/test_skill_profile_loader_gate.py`），覆盖 AC-1…AC-5；既有基线（47/30/14/57/11+1 既有失败）与门禁 243、ratchet 5 条全部保持。

## Out of scope

- 不做插件 UI；不做市场化权限体系；不做新档位；不做按档位的热更新与运行期动态降级（master plan 风险条：先接现有四档，只在安装与加载边界校验）。
- 不改 guardrail 规则与扫描规则本身：`guard_classify.py` 的判定逻辑、`guard_engine.py` 的规则与 `guard_patterns.yaml`、`guard_v1.py` 的 pattern 清单、`compute_code_stats` 的统计口径，全部零改动；不把档位 mismatch 塞进 findings/verdict。
- 不改 `agenticx/safety/audit.py`（内存环不作持久出口也不动）；不改 `agenticx/studio/server.py`、`agenticx/runtime/replay_ledger/`、`session_event_hub.py`、`coordination/`、`studio/storage/`、`harness/`。
- bundle 的 MCP server 配置不定档、不校验、不改合并逻辑；avatar 与 memory template 组件不涉及。
- 不强制存量技能声明档位；不迁移任何已有技能数据；不修 SkillHub 路径附属文件未经深度扫描的既有缺口（F-5，属扫描规则面）；不修 `test_skill_manage_rollback` 的既有 async 缺陷（F-9）。
- 不新增 ratchet 规则；现有 5 条基线一条不调大、一条不触发。
- near-plugin plan 合入后的 manifest 侧声明档 schema 对齐不在本 plan（预留：`read_declared_tier` 单点扩展，F-12）。
- plan 与代码注释不出现第三方项目/产品名称与链接、客户信息；引用参考依据只写「见 master plan『背景与参考来源』」。

## Precise landing points

| 文件 | 动作 | 位置 | 内容 |
| --- | --- | --- | --- |
| `agenticx/skills/profile_gate.py` | Create | — | 档位门原语（Task 1 代码块 A，完整内容） |
| `agenticx/skills/frontmatter.py` | Modify | `:37`（`_frontmatter_get_scalar` 之后）追加 | 公共 `get_frontmatter_scalar`（Task 1 代码块 B） |
| `agenticx/skills/guard_types.py` | Modify | `:42-61`（`ScanResult` 定义区内） | `SkillProfileCheck` dataclass + `ScanResult.profile` 字段（Task 1 代码块 C） |
| `agenticx/skills/guard.py` | Modify | `:77-82`（`scan_skill`）；`:114` 之后与 `:126-134`（`scan_skill_deep` 的 attach 与重建）；`:152-153` 之间（`scan_result_to_payload`）；`:176-180`（`should_allow` 函数头）；`:223-227` 与 `:248-252`（两个格式化函数的插入点） | attach / 透传 / 透出 / 硬阻塞 / 档位文案（Task 1 代码块 D–H） |
| `agenticx/runtime/studio_safety.py` | Modify | `:41-42`（常量区）；`:144`（`_bridge_enterprise` 之后） | gate 常量 + 独立 sink + 公共 emit（Task 1 代码块 I） |
| `agenticx/runtime/harden_flags.py` | Modify | `:161`（`harness_ledger_events_enabled` 的 return 之后、`:164` `cancelled_prefix_finalize_enabled` 之前） | `skill_profile_gate_enabled`（Task 1 代码块 J） |
| `tests/test_skill_profile_gate.py` | Create（Test） | — | Task 1 全部 + Task 2 追加（完整内容分段给出） |
| `agenticx/extensions/registry_hub.py` | Modify | `:798-799`（`write_registry_skill` 写盘前）；`:822-824`（`write_registry_skill_dir` 的 rmtree 前） | 落盘硬门（Task 2 代码块 K） |
| `agenticx/extensions/installer.py` | Modify | `:193-208`（`scan_bundle_source` 循环与返回）；`:274`（`install_bundle` 的 non_high 检查之后、`:276` `with _lock:` 之前） | 收集与整包拒绝（Task 2 代码块 L） |
| `agenticx/tools/skill_bundle.py` | Modify | `:824`（source-level guard 的 `continue`）与 `:826`（`variants = ...`）之间 | 加载门（Task 3 代码块 M） |
| `agenticx/skills/import_repo.py` | Modify | `:380-382`（`install_skill_full_from_repo` 的 `if not ok:` 之后） | 档位阻塞先于 `acknowledge_high_risk`（Task 2 代码块 N；实施后评审补入） |
| `tests/test_skill_profile_loader_gate.py` | Create（Test） | — | 加载门 + LOAD_DENIED 审计 + 开关关（Task 3，完整内容） |
| `scripts/ci/ratchet-baseline.json` | 不改 | — | 不新增规则（D-10） |
| `agenticx/studio/server.py` | 不改 | — | 注册表路径经 `registry_hub` 覆盖、bundle 路径经 `install_bundle` 覆盖 |
| `agenticx/skills/guard_classify.py` / `guard_engine.py` / `guard_v1.py` / `guard_patterns.yaml` | 不改 | — | 只被 import 消费 |
| `agenticx/safety/audit.py` | 不改 | — | 内存环不动 |

## Tasks

三个串行任务：档位原语 + 审计出口 + `should_allow` 族 → 注册表与 bundle 落盘边界 → 加载边界与闭环。每个任务先写失败的测试，再写实现。**实现与本 plan 一致但测试仍失败时，停下报告，不许改断言。** 新文件给完整代码；被修改的既有文件用「在 `文件:行号` 之间插入 / 把 X 替换为 Y」的精确写法，行号以当前工作树 `61ffb4d6` 为准；同一任务内的行号指未应用本任务之前的状态，应用后以给出的锚点文本定位。

所有测试命令都用 `/opt/miniconda3/bin/python3 -m pytest <文件> -q --no-cov`（`.venv` 没有 pytest）。规划阶段已执行的探针见头部；下列命令中标注「已执行」的是实测输出，其余为待实施时执行。

### Task 1：档位原语 + 审计出口 + 开关 + `should_allow` 族拒绝

依赖的现有 API：

| API | 出处 | 用法 |
| --- | --- | --- |
| `classify_tier(stats, *, scan_mode)` | `agenticx/skills/guard_classify.py:117-133` | 实测档判定（钉 `standard`） |
| `compute_code_stats(skill_dir)` | `agenticx/skills/guard_classify.py:69-114` | 目录统计（staging 后调用，不改它本身） |
| `_extract_frontmatter_block` / `_frontmatter_get_scalar` | `agenticx/skills/frontmatter.py:25-37` | 新公共 helper 的内部实现 |
| `ScanResult`（dataclass） | `agenticx/skills/guard_types.py:53-61` | 加 `profile` 字段 |
| `should_allow(result, source)` | `agenticx/skills/guard.py:176-193` | 硬阻塞插入点 |
| `_resolve_bool(env, key, default)` | `agenticx/runtime/harden_flags.py:57-64` | 新开关 |
| `agx_home()` | `agenticx/utils/agx_home.py:123-125` | 独立 sink 路径（调用时解析） |
| `_bridge_enterprise(records)` / `_wall_ts()` / `_lock` | `agenticx/runtime/studio_safety.py:120-144,79-80,51` | emit 复用 |
| `ConfigManager.get_value`（测试 monkeypatch） | `tests/test_action_audit.py:18-26` 既有模式 | 企业镜像测试 |

#### 代码块 A —— `agenticx/skills/profile_gate.py`（Create，完整内容）

```python
#!/usr/bin/env python3
"""Execution-profile gate: pin the declared skill tier to the measured one.

The skill guard already classifies every skill directory into one of four
static tiers (T-MD / T-LITE / T-REF / T-HEAVY, ``guard_classify.py``).
This module turns that classification into an enforceable contract at the
install and load boundaries:

- a skill may declare its tier in SKILL.md frontmatter (``tier: T-REF``);
- install paths reject packages whose declared tier does not match the
  measured one (single skills, registry packages, AGX Bundles) before a
  single byte lands on disk;
- the loader refuses to register skills whose current content no longer
  matches the declared tier, so every serving method (list / read /
  prompt injection) stays closed;
- every rejection is mirrored into the persistent safety sinks
  (``agenticx/runtime/studio_safety.py``), so it survives restarts.

Skills without a declared tier (the entire legacy corpus) are untouched:
the gate is opt-in per declaration. Unknown or malformed tier values are
treated as undeclared and only logged — an attacker can simply omit the
field, so rejecting garbage values adds no security, only ecosystem
false positives.

Author: Damon Li
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from agenticx.skills.frontmatter import get_frontmatter_scalar
from agenticx.skills.guard_classify import classify_tier, compute_code_stats
from agenticx.skills.guard_types import SkillProfileCheck

logger = logging.getLogger("agenticx.skills")

#: The four static tiers produced by ``classify_tier`` (vocabulary pin).
SKILL_TIERS = ("T-MD", "T-LITE", "T-REF", "T-HEAVY")

#: The measured tier must not depend on the operator's scan mode:
#: ``quick`` forces T-MD and ``full`` forces the heavy side, both of which
#: would produce spurious results. Profile gating always measures with
#: the standard rules so install-time and load-time checks agree.
_MEASURE_SCAN_MODE = "standard"


class SkillProfileMismatchError(ValueError):
    """Raised by disk-landing install helpers when the declared tier is a lie."""


def read_declared_tier(content: str) -> Optional[str]:
    """Return the validated ``tier`` scalar from SKILL.md frontmatter.

    ``None`` when the frontmatter declares no tier or a value outside
    :data:`SKILL_TIERS` (after quote stripping and upper-casing, so
    ``"t-md"`` and ``T-MD`` are the same declaration).
    """
    raw = get_frontmatter_scalar(content, "tier")
    if raw is None:
        return None
    value = raw.strip().strip("\"'").upper()
    if value in SKILL_TIERS:
        return value
    logger.warning("ignoring unknown skill tier declaration: %r", raw)
    return None


def measure_tier(skill_dir: Path) -> Optional[str]:
    """Measure the current tier of a skill directory with the standard rules.

    Hidden dot-files (notably the ``.agx-skill-provenance.json`` sidecar the
    installers write) are excluded on purpose: they are installer
    bookkeeping, not skill content, and the landing helpers already refuse
    to copy them (``write_registry_skill_dir`` skips dot-file path parts).
    Staging only the visible files keeps the measurement identical before
    and after installation; without this a pure-markdown skill would
    measure T-LITE instead of T-MD the moment provenance lands beside it.
    """
    root = Path(skill_dir).expanduser().resolve(strict=False)
    if not root.is_dir():
        return None
    try:
        with tempfile.TemporaryDirectory(prefix="agx-profile-") as td:
            staged = Path(td) / "_skill"
            staged.mkdir(parents=True)
            for src in sorted(root.rglob("*")):
                if not src.is_file():
                    continue
                rel = src.relative_to(root)
                if any(part.startswith(".") for part in rel.parts):
                    continue
                target = staged / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, target)
            return classify_tier(
                compute_code_stats(staged), scan_mode=_MEASURE_SCAN_MODE
            )
    except Exception:
        logger.warning("profile measurement failed for %s", root, exc_info=True)
        return None


def measure_tier_from_markdown(content: str) -> Optional[str]:
    """Measure the tier of an md-only skill from its SKILL.md text."""
    try:
        with tempfile.TemporaryDirectory(prefix="agx-profile-") as td:
            staged = Path(td) / "_skill"
            staged.mkdir(parents=True)
            (staged / "SKILL.md").write_text(content, encoding="utf-8")
            return classify_tier(
                compute_code_stats(staged), scan_mode=_MEASURE_SCAN_MODE
            )
    except Exception:
        logger.warning("profile markdown measurement failed", exc_info=True)
        return None


def check_skill_profile(skill_dir: Path) -> Optional[SkillProfileCheck]:
    """Compare the declared tier of a skill directory against the measured one.

    Returns ``None`` when the gate is off, the directory has no SKILL.md, no
    valid tier is declared (legacy skills pass through untouched), or the
    measurement itself failed (fail open: the pattern scan still ran, and a
    broken stat call must not brick installation).
    """
    from agenticx.runtime.harden_flags import skill_profile_gate_enabled

    if not skill_profile_gate_enabled():
        return None
    root = Path(skill_dir).expanduser().resolve(strict=False)
    skill_md = root / "SKILL.md"
    if not skill_md.is_file():
        return None
    try:
        content = skill_md.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    return check_skill_profile_text(content, skill_dir=root)


def check_skill_profile_text(
    content: str, *, skill_dir: Optional[Path] = None
) -> Optional[SkillProfileCheck]:
    """Declared-vs-measured check for one SKILL.md text.

    ``skill_dir`` is the content root to measure (directory install paths);
    md-only callers omit it and the markdown text itself is staged and
    measured.
    """
    from agenticx.runtime.harden_flags import skill_profile_gate_enabled

    if not skill_profile_gate_enabled():
        return None
    declared = read_declared_tier(content)
    if declared is None:
        return None
    if skill_dir is not None and Path(skill_dir).is_dir():
        measured = measure_tier(skill_dir)
    else:
        measured = measure_tier_from_markdown(content)
    if measured is None:
        return None
    ok = declared == measured
    return SkillProfileCheck(
        declared=declared,
        measured=measured,
        ok=ok,
        reason="" if ok else f"tier mismatch: declared {declared}, measured {measured}",
    )


def note_profile_rejection(
    check: SkillProfileCheck,
    *,
    skill_name: str,
    action: str,
    boundary: str,
) -> None:
    """Persist one profile-gate rejection through the studio safety sinks.

    Best-effort: an audit failure never affects the decision (the caller
    has already rejected). The in-memory ring buffer is intentionally not
    used — it is the tool-dispatch pipeline log, not a persistent outlet.
    """
    try:
        from agenticx.runtime.studio_safety import emit_extension_gate_event

        emit_extension_gate_event(
            {
                "stage": "extension_profile_gate",
                "action": action,
                "tool_name": str(skill_name or ""),
                "rule_ids": ["tier_mismatch"],
                "severity": "WARN",
                "details": (
                    f"declared={check.declared} measured={check.measured} "
                    f"boundary={boundary}"
                ),
                "mode": "enforce",
                "session_id": "",
                "tool_call_id": "",
                "agent_id": "",
                "args_digest": "",
            }
        )
    except Exception:
        logger.debug("profile rejection audit failed", exc_info=True)
```

#### 代码块 B —— `agenticx/skills/frontmatter.py`（`:37`（`_frontmatter_get_scalar` 函数体结束）之后追加；模块无新 import）

```python
def get_frontmatter_scalar(content: str, key: str) -> Optional[str]:
    """Return one scalar frontmatter field of a SKILL.md, or ``None``.

    Public read-only accessor over the same ``key: value`` line grammar the
    normalizer uses; unknown keys never raise. Introduced for the execution
    profile gate (``tier:``), usable by any future manifest-level field.
    """
    fm_block = _extract_frontmatter_block(content)
    if fm_block is None:
        return None
    return _frontmatter_get_scalar(fm_block, key)
```

#### 代码块 C —— `agenticx/skills/guard_types.py`

（c-1）在 `:34-39` 的 `TRUST_POLICY` 常量区之后、`:42` 的 `@dataclass class ScanFinding` 之前插入：

```python
@dataclass
class SkillProfileCheck:
    """Declared-vs-measured skill tier comparison (execution profile gate).

    ``ok`` is False when the SKILL.md ``tier:`` declaration does not match
    the tier measured from the current directory content.
    """

    declared: str
    measured: str
    ok: bool
    reason: str = ""
```

（c-2）把 `:53-61` 的 `ScanResult` 定义替换为（只加最后一行字段）：

```python
@dataclass
class ScanResult:
    verdict: ScanVerdict
    findings: list[ScanFinding] = field(default_factory=list)
    source: str = ""
    score: int | None = None
    grade: str | None = None
    tier: str | None = None
    pattern_set_version: str = ""
    profile: SkillProfileCheck | None = None
```

#### 代码块 D —— `agenticx/skills/guard.py` `scan_skill`（把 `:77-82` 替换为）

```python
def scan_skill(skill_dir: Path, *, source: str = "agent-created") -> ScanResult:
    """Scan all text files in a skill directory for security threats.

    Also compares the declared execution profile (``tier:`` in SKILL.md
    frontmatter) against the measured tier and attaches the outcome to
    ``result.profile`` — the shared conclusion every install entry
    consumes (see profile_gate.py). Applies to both guard engines.
    """
    cfg = load_guard_config()
    if _use_v2(cfg):
        result = scan_skill_v2(skill_dir, source=source, config=cfg)
    else:
        result = scan_skill_v1(skill_dir, source=source)
    if Path(skill_dir).is_dir():
        from agenticx.skills.profile_gate import check_skill_profile

        try:
            result.profile = check_skill_profile(Path(skill_dir))
        except Exception:
            logger.warning("skill profile check failed", exc_info=True)
    return result
```

#### 代码块 E —— `agenticx/skills/guard.py` `scan_skill_deep`

注意：`scan_skill_deep` **直调** `scan_skill_v2`（`:114`），不经过 `scan_skill` 包装层，profile 不会自动挂载——需显式补一次 attach，否则审计 UI 的深度扫描永远看不到档位结论。

（e-1）在 `:114`（`result = scan_skill_v2(skill_dir, source=source, config=cfg, deep=True)`）之后插入：

```python
    if Path(skill_dir).is_dir():
        from agenticx.skills.profile_gate import check_skill_profile

        try:
            result.profile = check_skill_profile(Path(skill_dir))
        except Exception:
            logger.warning("skill profile check failed", exc_info=True)
```

（e-2）把 `:126-134` 的 `ScanResult` 重建块替换为（末行多一个透传）：

```python
        result = ScanResult(
            verdict=merge_verdict(filtered),
            findings=filtered,
            source=result.source,
            score=result.score,
            grade=result.grade,
            tier=result.tier,
            pattern_set_version=result.pattern_set_version,
            profile=result.profile,
        )
```

#### 代码块 F —— `agenticx/skills/guard.py` `scan_result_to_payload`（在 `:152`（`payload["pattern_set_version"] = result.pattern_set_version`）与 `:153`（`return payload`）之间插入；`:149-152` 原有四个 `if` 块逐字保留）

```python
    if result.profile is not None:
        payload["profile"] = {
            "declared": result.profile.declared,
            "measured": result.profile.measured,
            "ok": bool(result.profile.ok),
        }
```

#### 代码块 G —— `agenticx/skills/guard.py` `should_allow`（把 `:176-180` 的函数头替换为；其余 `:181-193` 逐字保留）

```python
def should_allow(result: ScanResult, source: str | None = None) -> tuple[bool, str]:
    """Determine whether a skill should be installed given its scan result.

    A declared-vs-measured tier mismatch is a hard, unconditional block:
    it precedes the trust-level policy (builtin is rejected too) and no
    acknowledge_high_risk flow can bypass it.
    """
    from agenticx.skills.profile_gate import note_profile_rejection

    profile = getattr(result, "profile", None)
    if profile is not None and not profile.ok:
        note_profile_rejection(
            profile,
            skill_name="",
            action="INSTALL_REJECTED",
            boundary="install_skill",
        )
        return False, (
            f"blocked: tier mismatch (declared {profile.declared}, "
            f"measured {profile.measured})"
        )
    effective_source = source or result.source or "agent-created"
```

（注意：`should_allow` 没有 `skill_name` 入参，安装拒绝审计的 `tool_name` 为空串——声明/实测与 boundary 在 `details` 里；带技能名的审计在 bundle 与 loader 两处。见「需主会话定案」D-c。）

#### 代码块 H —— `agenticx/skills/guard.py` 两个格式化函数

（h-1）`format_guard_rejection_message`：在 `:223-226` 的 `lines = [...]` 构造块之后、`seen: set[str] = set()`（`:227`）之前插入：

```python
    profile = getattr(result, "profile", None)
    if profile is not None and not profile.ok:
        lines.append(
            f"档位声明与实测不一致（声明 {profile.declared}，实测 {profile.measured}），已拒绝。"
        )
```

（h-2）`format_guard_block_for_user`：在 `:248-251` 的 `lines = [...]` 构造块之后、`seen: set[str] = set()`（`:252`）之前插入：

```python
    profile = getattr(result, "profile", None)
    if profile is not None and not profile.ok:
        lines.append(
            f"这条技能的档位声明与实测不一致（声明 {profile.declared}，实测 {profile.measured}）。"
        )
```

#### 代码块 I —— `agenticx/runtime/studio_safety.py`

（i-1）在 `:42`（`_EVENTS_MAX_BYTES = 20 * 1024 * 1024`）之后追加一行：

```python
_GATE_EVENTS_NAME = "extension_gate.jsonl"
_GATE_EVENTS_MAX_BYTES = 20 * 1024 * 1024
```

（i-2）在 `:92`（`_events_path` 函数体结束）之后追加：

```python
def _gate_events_path() -> Path:
    return agx_home() / "safety" / _GATE_EVENTS_NAME
```

（i-3）在 `:144`（`_bridge_enterprise` 函数体结束）之后、`:147`（`_drain_new_events`）之前追加：

```python
def _append_gate_events(records: List[Dict[str, Any]]) -> None:
    """Append extension-gate decisions to their own sink. Never raises.

    Extension-profile rejections are rare, high-value security decisions;
    they get a dedicated append-only file so they are never evicted by
    pipeline noise (the pipeline sink shares its budget with per-20-call
    pass-through markers and drops new lines once full).
    """
    if not records:
        return
    try:
        path = _gate_events_path()
        with _lock:
            if path.is_file() and path.stat().st_size >= _GATE_EVENTS_MAX_BYTES:
                logger.warning(
                    "extension gate events file is full (%s bytes); dropping events until rotated",
                    path.stat().st_size,
                )
                return
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                for record in records:
                    handle.write(
                        json.dumps(record, ensure_ascii=False, separators=(",", ":"))
                        + "\n"
                    )
                handle.flush()
    except Exception:
        logger.debug("extension gate event append failed", exc_info=True)


def emit_extension_gate_event(record: Dict[str, Any]) -> None:
    """Persist one extension execution-profile gate decision (05).

    Two persistent outlets only: the dedicated local sink above and the
    enterprise outbox via the same bridge as pipeline events. The
    in-memory ring buffer is deliberately not involved (it is the
    tool-dispatch pipeline log; the profile gate has its own stage name).
    Never raises.
    """
    payload = dict(record)
    payload.setdefault("ts", _wall_ts())
    _append_gate_events([payload])
    _bridge_enterprise([payload])
```

#### 代码块 J —— `agenticx/runtime/harden_flags.py`（`:161`（`harness_ledger_events_enabled` 的 return 行）之后、`:164`（`cancelled_prefix_finalize_enabled`）之前插入）

```python
def skill_profile_gate_enabled() -> bool:
    """``AGX_SKILL_PROFILE_GATE`` / ``runtime.skill_profile_gate``. Default True.

    When on, skills may declare their static tier (``tier:`` in SKILL.md
    frontmatter); every install path rejects declared-vs-measured
    mismatches before writing, the loader refuses to register mismatched
    skills, and each rejection is audited through the studio safety
    sinks. When off, no profile check runs anywhere and install/load
    behavior is byte-for-byte the pre-05 state (legacy skills without a
    declaration are never affected either way).
    """
    return _resolve_bool("AGX_SKILL_PROFILE_GATE", "runtime.skill_profile_gate", True)
```

#### 测试：`tests/test_skill_profile_gate.py`（Create；Task 1 落「原语 / 安装拒绝 / 审计 / 开关」节，Task 2 追加「registry / bundle」节）

```python
#!/usr/bin/env python3
"""Execution-profile gate tests (runtime invariants 05).

Covers: declared-tier parsing, deterministic measurement, the install
rejection on the should_allow family, the registry disk-landing raise,
the AGX Bundle rejection, persistent audit records that survive restarts,
and the flag-off fallback to the pre-05 behavior. Fully closed fixtures:
skills and bundles are built in tmp paths, nothing is downloaded, and
every audit assertion reads the on-disk sinks (never in-memory state).

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import pytest

import agenticx.extensions.installer as installer
from agenticx.extensions.installer import install_bundle, scan_bundle_source
from agenticx.extensions.registry_hub import RegistryHub
from agenticx.skills.frontmatter import get_frontmatter_scalar
from agenticx.skills.guard import (
    format_guard_rejection_message,
    scan_result_to_payload,
    scan_skill,
    should_allow,
)
from agenticx.skills.profile_gate import (
    SKILL_TIERS,
    SkillProfileMismatchError,
    measure_tier,
    read_declared_tier,
)
from agenticx.utils.agx_home import agx_home

HEAVY_FILE_COUNT = 11  # > HEAVY_CODE_FILES (10, guard_classify.py:18)

SKILL_MD_TMPL = """---
name: {name}
description: demo skill for profile gate tests
{tier_line}
---

# {name}

Plain instructions only.
"""


@pytest.fixture(autouse=True)
def _no_agx_home(monkeypatch: pytest.MonkeyPatch) -> None:
    # Keep agx_home() pointed at the conftest HOME sandbox even when the
    # local shell happens to export AGX_HOME (plan assumption #10).
    monkeypatch.delenv("AGX_HOME", raising=False)


def _write_skill(
    root: Path,
    name: str,
    *,
    declared: Optional[str] = None,
    heavy: bool = False,
) -> Path:
    tier_line = f"tier: {declared}" if declared else ""
    skill_dir = root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        SKILL_MD_TMPL.format(name=name, tier_line=tier_line), encoding="utf-8"
    )
    if heavy:
        for idx in range(HEAVY_FILE_COUNT):
            (skill_dir / f"script_{idx}.py").write_text("x = 1\n", encoding="utf-8")
    return skill_dir


def _read_gate_events() -> list[dict[str, Any]]:
    path = agx_home() / "safety" / "extension_gate.jsonl"
    if not path.is_file():
        return []
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


# ----------------------------------------------------------------------
# primitives
# ----------------------------------------------------------------------
def test_frontmatter_scalar_helper_reads_tier() -> None:
    content = "---\nname: a\ndescription: d\ntier: T-REF\n---\nbody\n"
    assert get_frontmatter_scalar(content, "tier") == "T-REF"
    assert get_frontmatter_scalar(content, "name") == "a"
    assert get_frontmatter_scalar(content, "missing") is None


def test_declared_tier_accepts_only_the_four_tiers() -> None:
    assert SKILL_TIERS == ("T-MD", "T-LITE", "T-REF", "T-HEAVY")
    assert read_declared_tier("---\nname: a\ndescription: d\ntier: T-REF\n---\n") == "T-REF"
    assert read_declared_tier('---\nname: a\ndescription: d\ntier: "T-MD"\n---\n') == "T-MD"
    # case-insensitive: a lowercase typo is still the same declaration
    assert read_declared_tier("---\nname: a\ndescription: d\ntier: t-md\n---\n") == "T-MD"
    # unknown vocabulary: treated as undeclared (skip), never a rejection
    assert read_declared_tier("---\nname: a\ndescription: d\ntier: premium\n---\n") is None
    assert read_declared_tier("---\nname: a\ndescription: d\ntier: T_MDF\n---\n") is None
    assert read_declared_tier("---\nname: a\ndescription: d\n---\n") is None


def test_measure_tier_is_deterministic(tmp_path: Path) -> None:
    pure = _write_skill(tmp_path, "pure")
    assert measure_tier(pure) == "T-MD"
    heavy = _write_skill(tmp_path, "heavy", heavy=True)
    assert measure_tier(heavy) == "T-HEAVY"
    # The provenance sidecar the installers write is bookkeeping, not
    # skill content: it must not downgrade the measurement (T-MD -> T-LITE
    # is what compute_code_stats would do without the hidden-file staging).
    (pure / ".agx-skill-provenance.json").write_text(
        '{"source": "community"}', encoding="utf-8"
    )
    assert measure_tier(pure) == "T-MD"


# ----------------------------------------------------------------------
# install rejection: scan_skill attach + should_allow family
# ----------------------------------------------------------------------
def test_scan_skill_attaches_mismatch_profile(tmp_path: Path) -> None:
    bad = _write_skill(tmp_path, "scan-skill", declared="T-MD", heavy=True)
    result = scan_skill(bad, source="community")
    assert result.profile is not None
    assert result.profile.declared == "T-MD"
    assert result.profile.measured == "T-HEAVY"
    assert result.profile.ok is False
    assert result.profile.reason == (
        "tier mismatch: declared T-MD, measured T-HEAVY"
    )


def test_scan_result_payload_exposes_profile(tmp_path: Path) -> None:
    bad = _write_skill(tmp_path, "payload-skill", declared="T-MD", heavy=True)
    payload = scan_result_to_payload(
        scan_skill(bad, source="community"), "payload-skill"
    )
    assert payload["profile"] == {
        "declared": "T-MD",
        "measured": "T-HEAVY",
        "ok": False,
    }


def test_should_allow_blocks_tier_mismatch_unconditionally(tmp_path: Path) -> None:
    # "builtin" is the most permissive trust level: the mismatch block
    # must still fire before the trust policy, with no ack bypass.
    bad = _write_skill(tmp_path, "liar-skill", declared="T-MD", heavy=True)
    ok, reason = should_allow(scan_skill(bad, source="builtin"), "builtin")
    assert ok is False
    assert reason == "blocked: tier mismatch (declared T-MD, measured T-HEAVY)"


def test_should_allow_passes_matching_and_undeclared(tmp_path: Path) -> None:
    honest = _write_skill(tmp_path, "honest-skill", declared="T-HEAVY", heavy=True)
    ok, _ = should_allow(scan_skill(honest, source="community"), "community")
    assert ok is True
    legacy = _write_skill(tmp_path, "legacy-skill", heavy=True)
    result = scan_skill(legacy, source="community")
    assert result.profile is None
    ok, _ = should_allow(result, "community")
    assert ok is True


def test_rejection_message_mentions_tier_mismatch(tmp_path: Path) -> None:
    bad = _write_skill(tmp_path, "msg-skill", declared="T-MD", heavy=True)
    msg = format_guard_rejection_message(scan_skill(bad, source="agent-created"), action="create")
    assert "档位声明与实测不一致（声明 T-MD，实测 T-HEAVY），已拒绝。" in msg


# ----------------------------------------------------------------------
# audit: persisted on disk, survives a restart (in-memory reset)
# ----------------------------------------------------------------------
def test_install_rejection_is_persisted_and_survives_reset(tmp_path: Path) -> None:
    import agenticx.runtime.studio_safety as studio_safety

    bad = _write_skill(tmp_path, "audit-skill", declared="T-MD", heavy=True)
    ok, _ = should_allow(scan_skill(bad, source="community"), "community")
    assert ok is False
    records = _read_gate_events()
    assert any(r["action"] == "INSTALL_REJECTED" for r in records)
    # "restart": drop every in-memory structure, the file must be unchanged
    studio_safety._reset()
    assert _read_gate_events() == records
    # the record went to the dedicated gate sink, not the pipeline sink
    pipeline_path = agx_home() / "safety" / "events.jsonl"
    if pipeline_path.is_file():
        assert "INSTALL_REJECTED" not in pipeline_path.read_text(encoding="utf-8")


def test_gate_record_shape(tmp_path: Path) -> None:
    bad = _write_skill(tmp_path, "shape-skill", declared="T-MD", heavy=True)
    ok, _ = should_allow(scan_skill(bad, source="community"), "community")
    assert ok is False
    rec = [r for r in _read_gate_events() if r["action"] == "INSTALL_REJECTED"][-1]
    assert rec["stage"] == "extension_profile_gate"
    assert rec["rule_ids"] == ["tier_mismatch"]
    assert rec["severity"] == "WARN"
    assert rec["mode"] == "enforce"
    assert "declared=T-MD" in rec["details"]
    assert "measured=T-HEAVY" in rec["details"]
    assert "boundary=install_skill" in rec["details"]
    assert rec["ts"]


def test_enterprise_outbox_mirror_for_gate_rejections(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.cli.config_manager import ConfigManager

    values = {"enterprise.enabled": True, "enterprise.token": "agx-pat-test"}

    def get_value(cls: object, key: str) -> object:
        del cls
        return values.get(key)

    monkeypatch.setattr(ConfigManager, "get_value", classmethod(get_value))

    bad = _write_skill(tmp_path, "mirror-skill", declared="T-MD", heavy=True)
    ok, _ = should_allow(scan_skill(bad, source="community"), "community")
    assert ok is False
    outbox = agx_home() / "action_audit" / "outbox.jsonl"
    assert outbox.is_file()
    line = json.loads(outbox.read_text(encoding="utf-8").splitlines()[0])
    assert line["kind"] == "safety_event"
    assert line["subject"] == "extension_profile_gate:INSTALL_REJECTED"
    assert line["decision_source"] == "studio_safety/enforce"
    assert "tier_mismatch" in line["summary"]


# ----------------------------------------------------------------------
# flag off: byte-for-byte pre-05 behavior
# ----------------------------------------------------------------------
def test_flag_off_disables_the_gate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SKILL_PROFILE_GATE", "0")
    bad = _write_skill(tmp_path, "legacy-heavy", declared="T-MD", heavy=True)
    result = scan_skill(bad, source="community")
    assert result.profile is None
    ok, _ = should_allow(result, "community")
    assert ok is True  # benign content, community-safe verdict, no gate
    hub = RegistryHub()
    src = _write_skill(tmp_path, "registry-ok", declared="T-MD", heavy=True)
    md = hub.write_registry_skill_dir("registry-ok", src)  # no raise, writes
    assert Path(md).is_file()
    assert _read_gate_events() == []
```

#### Task 1 验证

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_skill_profile_gate.py -q --no-cov
# 预期：原语/安装拒绝/审计/开关节全部通过（先写测试时红：profile_gate 等尚不存在）
/opt/miniconda3/bin/python3 -m pytest tests/test_skill_guard_cls_patterns.py tests/test_skill_import_repo.py tests/test_pending_queue.py tests/test_skillhub_install_guard.py tests/runtime/test_studio_safety.py tests/test_action_audit.py -q --no-cov
# 预期：47 + 14 + 30 里的既有用例全部保持通过（基线已实测：47/14/30）
RATCHET_BASE_REF=HEAD /opt/miniconda3/bin/python3 scripts/ci/ratchet.py
# 预期：5 条规则全部通过（Task 1 代码不含任何禁用字面量）
```

依赖的现有 API（Task 1 补充，已被上面表覆盖的不重复）：`format_guard_rejection_message`（`guard.py:212-240`，断言文案插入点在其 `lines` 列表后）；`studio_safety._reset()`（`:69-76`）；`_bridge_enterprise` 的 record→outbox 字段映射（`:128-142`，`subject=f"{stage}:{action}"`、`summary="rules=... {details}"`——`rule_ids` join 后带 `tier_mismatch`，details 带实测/声明）。

### Task 2：注册表与 bundle 落盘边界（`registry_hub.py` / `installer.py` + 测试追加）

依赖的现有 API：

| API | 出处 | 用法 |
| --- | --- | --- |
| `write_registry_skill(skill_name, skill_content, *, source)` | `agenticx/extensions/registry_hub.py:780-801` | md-only 硬门插入点（`ensure_skill_source` 之后、`write_text` 之前） |
| `write_registry_skill_dir(skill_name, src_dir, *, source)` | `agenticx/extensions/registry_hub.py:803-842` | 包族硬门插入点（rmtree 之前） |
| `_validate_skill_name` | `agenticx/skills/registry.py`（`registry_hub.py:789,814` 函数内 import） | 名称合法化 |
| `scan_bundle_source(source)` / `install_bundle(...)` | `agenticx/extensions/installer.py:179-208, 223-384` | 收集与拒绝插入点 |
| `InstallResult(success, error, error_code, scan_summary, ...)` | `agenticx/extensions/installer.py:94-107` | bundle 拒绝返回 |
| `parse_bundle_manifest` / `BundleSkillRef.resolved_path` | `agenticx/extensions/bundle.py:327-419, 70-78` | 测试夹具构造 bundle |
| installer 六个模块级路径常量 | `agenticx/extensions/installer.py:35-40` | 测试 monkeypatch（F-8） |

#### 代码块 K —— `agenticx/extensions/registry_hub.py`

（k-1）`write_registry_skill`（`:780-801`）：**把 `:796`（`skill_dir.mkdir(...)`）与 `:797`（`md_path = skill_dir / "SKILL.md"`）两行移到 gate 之后**，并按下面顺序重排 `:795` 起的代码块（主会话实施后修正：gate 必须先于 `mkdir`，拒绝时连空目录都不留——实施后评审处置 #1）：

```python
        skill_dir.relative_to(install_root)
        stamped = ensure_skill_source(skill_content, source)
        from agenticx.skills.profile_gate import (
            SkillProfileMismatchError,
            check_skill_profile_text,
            note_profile_rejection,
        )

        gate = check_skill_profile_text(stamped)
        if gate is not None and not gate.ok:
            note_profile_rejection(
                gate,
                skill_name=validated,
                action="INSTALL_REJECTED",
                boundary="install_registry",
            )
            raise SkillProfileMismatchError(
                f"tier mismatch: declared {gate.declared}, measured {gate.measured} "
                f"for skill '{validated}'"
            )
        skill_dir.mkdir(parents=True, exist_ok=True)
        md_path = skill_dir / "SKILL.md"
        md_path.write_text(stamped, encoding="utf-8")
        write_skill_provenance(skill_dir, source, extra={"name": validated})
        return md_path
```

（k-2）`write_registry_skill_dir`（`:803-842`）：在 `:823`（`skill_dir.relative_to(install_root)`）与 `:824`（`if skill_dir.exists():`）之间插入（**必须在 rmtree 之前**——拒绝不破坏已装内容）：

```python
        from agenticx.skills.profile_gate import (
            SkillProfileMismatchError,
            check_skill_profile,
            note_profile_rejection,
        )

        gate = check_skill_profile(src)
        if gate is not None and not gate.ok:
            note_profile_rejection(
                gate,
                skill_name=validated,
                action="INSTALL_REJECTED",
                boundary="install_registry",
            )
            raise SkillProfileMismatchError(
                f"tier mismatch: declared {gate.declared}, measured {gate.measured} "
                f"for skill '{validated}'"
            )
```

（`write_registry_skill_package :844-860` 转发到上面两函数，无需改动。）

#### 代码块 L —— `agenticx/extensions/installer.py`

（l-1）把 `scan_bundle_source` 的循环与返回段（`:193-208`）替换为：

```python
    per_skill: List[Dict[str, Any]] = []
    verdicts: List[ScanVerdict] = []
    profile_rejects: List[Dict[str, Any]] = []
    for skill_ref in manifest.skills:
        skill_md = skill_ref.resolved_path(manifest.source_dir)
        skill_dir = skill_md.parent
        sr = scan_skill(skill_dir, source="community")
        per_skill.append(scan_result_to_payload(sr, skill_dir.name))
        verdicts.append(sr.verdict)
        profile = getattr(sr, "profile", None)
        if profile is not None and not profile.ok:
            profile_rejects.append(
                {
                    "skill": skill_dir.name,
                    "declared": profile.declared,
                    "measured": profile.measured,
                }
            )

    overall = merge_verdicts(verdicts)
    return {
        "ok": True,
        "bundle_name": manifest.name,
        "overall": overall,
        "skills": per_skill,
        "profile_rejects": profile_rejects,
    }
```

（l-2）`install_bundle`：在 `:268-274`（non_high_risk 检查块）之后、`:276`（`with _lock:`）之前插入：

```python
    profile_rejects = list(scan_raw.get("profile_rejects") or [])
    if profile_rejects:
        # Hard, unconditional bundle rejection: no skill, registry entry,
        # or MCP merge happens for a bundle with a lying skill. MCP server
        # configs carry no tier semantics (not skill content, not scanned
        # by the guard) — they are out of profile scope by design.
        try:
            from agenticx.skills.guard_types import SkillProfileCheck
            from agenticx.skills.profile_gate import note_profile_rejection

            for reject in profile_rejects:
                note_profile_rejection(
                    SkillProfileCheck(
                        declared=str(reject.get("declared") or ""),
                        measured=str(reject.get("measured") or ""),
                        ok=False,
                        reason="",
                    ),
                    skill_name=str(reject.get("skill") or ""),
                    action="BUNDLE_REJECTED",
                    boundary="install_bundle",
                )
        except Exception:
            logger.warning("bundle profile audit failed", exc_info=True)
        error = "tier mismatch: " + ", ".join(
            f"{r.get('skill')} (declared {r.get('declared')}, measured {r.get('measured')})"
            for r in profile_rejects
        )
        return InstallResult(
            success=False,
            error=error,
            error_code="tier_mismatch",
            scan_summary=summary,
        )
```

#### 测试：`tests/test_skill_profile_gate.py` 追加「registry / bundle」节

```python
# ----------------------------------------------------------------------
# registry disk-landing family (covers clawhub tool, studio
# /api/registry/install, SkillHub, AGX native registry)
# ----------------------------------------------------------------------
def test_write_registry_skill_dir_raises_on_mismatch(tmp_path: Path) -> None:
    hub = RegistryHub()
    src = _write_skill(tmp_path, "reg-liar", declared="T-MD", heavy=True)
    # a previous install must survive the rejection untouched
    target = Path.home() / ".agenticx" / "skills" / "registry" / "reg-liar"
    target.mkdir(parents=True, exist_ok=True)
    (target / "SKILL.md").write_text("old content", encoding="utf-8")

    with pytest.raises(SkillProfileMismatchError, match="tier mismatch: declared T-MD, measured T-HEAVY"):
        hub.write_registry_skill_dir("reg-liar", src, source="community")

    assert (target / "SKILL.md").read_text(encoding="utf-8") == "old content"
    records = _read_gate_events()
    assert any(
        r["action"] == "INSTALL_REJECTED" and r["tool_name"] == "reg-liar"
        for r in records
    )


def test_write_registry_md_only_raises_on_mismatch(tmp_path: Path) -> None:
    hub = RegistryHub()
    content = (
        "---\nname: md-liar\ndescription: d\ntier: T-MD\n---\n\n"
        "# md-liar\n\n```bash\nwget http://example.com/pkg\ncd src\n```\n"
    )
    with pytest.raises(SkillProfileMismatchError, match="tier mismatch: declared T-MD, measured T-REF"):
        hub.write_registry_skill("md-liar", content, source="community")
    assert not (
        Path.home() / ".agenticx" / "skills" / "registry" / "md-liar"
    ).exists()


def test_registry_write_accepts_consistent_skill(tmp_path: Path) -> None:
    hub = RegistryHub()
    src = _write_skill(tmp_path, "reg-honest", declared="T-HEAVY", heavy=True)
    md = hub.write_registry_skill_dir("reg-honest", src, source="community")
    assert Path(md).is_file()


# ----------------------------------------------------------------------
# AGX Bundle family
# ----------------------------------------------------------------------
def _make_bundle(root: Path, *, declared: Optional[str], heavy: bool) -> Path:
    bdir = root / "demo-bundle"
    skill = bdir / "skills" / "demo-skill"
    skill.mkdir(parents=True)
    tier_line = f"tier: {declared}" if declared else ""
    (skill / "SKILL.md").write_text(
        f"---\nname: demo-skill\ndescription: demo bundle skill\n{tier_line}\n---\n\n"
        "# demo-skill\n\nPlain instructions only.\n",
        encoding="utf-8",
    )
    if heavy:
        for idx in range(HEAVY_FILE_COUNT):
            (skill / f"script_{idx}.py").write_text("x = 1\n", encoding="utf-8")
    (bdir / "agx-bundle.yaml").write_text(
        "agx_bundle: \"1.0\"\n"
        "name: demo-bundle\n"
        "version: \"1.0.0\"\n"
        "description: demo\n"
        "components:\n"
        "  skills:\n"
        "    - path: skills/demo-skill/SKILL.md\n",
        encoding="utf-8",
    )
    return bdir


def _patch_installer_home(monkeypatch: pytest.MonkeyPatch, root: Path) -> None:
    # installer.py resolves its paths at import time (module constants);
    # point every one of them at a fresh sandbox for this test.
    home = root / "agx-home"
    home.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(installer, "_AGENTICX_HOME", home)
    monkeypatch.setattr(installer, "_BUNDLES_JSON", home / "bundles.json")
    monkeypatch.setattr(installer, "_SKILLS_BUNDLES_DIR", home / "skills" / "bundles")
    monkeypatch.setattr(installer, "_AVATARS_PRESETS_DIR", home / "avatars" / "presets")
    monkeypatch.setattr(
        installer, "_MEMORY_TEMPLATES_DIR", home / "workspace" / "memory_templates"
    )
    monkeypatch.setattr(installer, "_MCP_JSON", home / "mcp.json")


def test_bundle_scan_reports_profile_rejects(tmp_path: Path) -> None:
    bdir = _make_bundle(tmp_path, declared="T-MD", heavy=True)
    scan = scan_bundle_source(bdir)
    assert scan["ok"] is True
    assert scan["profile_rejects"] == [
        {"skill": "demo-skill", "declared": "T-MD", "measured": "T-HEAVY"}
    ]
    # the per-skill payload exposes the same fact for API/UI consumers
    assert scan["skills"][0]["profile"] == {
        "declared": "T-MD",
        "measured": "T-HEAVY",
        "ok": False,
    }


def test_install_bundle_rejects_mismatch_and_writes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_installer_home(monkeypatch, tmp_path)
    bdir = _make_bundle(tmp_path, declared="T-MD", heavy=True)

    result = install_bundle(bdir)

    assert result.success is False
    assert result.error_code == "tier_mismatch"
    assert result.error == (
        "tier mismatch: demo-skill (declared T-MD, measured T-HEAVY)"
    )
    assert not (installer._SKILLS_BUNDLES_DIR / "demo-bundle").exists()
    assert not installer._BUNDLES_JSON.exists()
    assert not installer._MCP_JSON.exists()
    records = _read_gate_events()
    assert any(
        r["action"] == "BUNDLE_REJECTED" and r["tool_name"] == "demo-skill"
        for r in records
    )


def test_install_bundle_accepts_consistent_bundle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_installer_home(monkeypatch, tmp_path)
    bdir = _make_bundle(tmp_path, declared="T-MD", heavy=False)

    result = install_bundle(bdir)

    assert result.success is True
    assert result.skills_installed == ["demo-skill"]
    assert (installer._SKILLS_BUNDLES_DIR / "demo-bundle" / "demo-skill" / "SKILL.md").is_file()


# ----------------------------------------------------------------------
# GitHub tarball family: acknowledge_high_risk must not bypass a tier block
# ----------------------------------------------------------------------
def _tier_tarball() -> bytes:
    import io
    import tarfile

    skill_md = (
        "---\nname: liar-heavy\ndescription: demo\ntier: T-MD\n---\n\n"
        "# Liar\n\n"
        "Setup: placeholder text only\n"
    ).encode("utf-8")
    members: list[tuple[str, Optional[bytes]]] = [
        ("skills", None),
        ("skills/liar-heavy", None),
        ("skills/liar-heavy/SKILL.md", skill_md),
    ]
    members += [
        (f"skills/liar-heavy/script_{idx}.py", b"x = 1\n")
        for idx in range(HEAVY_FILE_COUNT)
    ]
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, content in members:
            info = tarfile.TarInfo(name=f"fakerepo-main/{name}")
            if content is None:
                info.type = tarfile.DIRTYPE
                tf.addfile(info)
            else:
                info.size = len(content)
                tf.addfile(info, io.BytesIO(content))
    return buf.getvalue()


def test_github_tarball_tier_mismatch_blocks_even_with_ack(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.skills.import_repo import install_skill_full_from_repo

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(
        "agenticx.skills.import_repo._download_tarball",
        lambda owner, name, branch: _tier_tarball(),
    )

    result = install_skill_full_from_repo(
        repo="owner/fakerepo",
        skill="liar-heavy",
        acknowledge_high_risk=True,
    )

    assert result.installed == []
    assert [r["name"] for r in result.rejected_by_guard] == ["liar-heavy"]
    assert "tier mismatch" in result.rejected_by_guard[0]["reason"]
    target = tmp_path / ".agenticx" / "skills" / "registry" / "liar-heavy"
    assert not target.exists()
    assert any(r["action"] == "INSTALL_REJECTED" for r in _read_gate_events())
```

（夹具注：`_write_skill` / `_read_gate_events` / `HEAVY_FILE_COUNT` 从 Task 1 节复用——同一文件内定义，无跨文件 import。`write_registry_skill_dir` 走调用时 `Path.home()`（`registry_hub.py:821`），conftest HOME 沙箱已隔离，无需 patch。GitHub 节用 `token = "…"` 触发 v1 `hardcoded_secret`（`guard_v1.py:44`）使 verdict 为 `dangerous`，从而真正走到 `acknowledge_high_risk` 分支——这正是实施后评审发现的绕过路径。）

#### 代码块 N —— `agenticx/skills/import_repo.py`（在 `install_skill_full_from_repo` 的 `if not ok:`（`:382`）之后、`if scan.verdict == "dangerous" and not acknowledge_high_risk:`（`:383`）之前插入）

```python
                profile = getattr(scan, "profile", None)
                if profile is not None and not profile.ok:
                    # Declared-vs-measured tier mismatch is a hard block:
                    # acknowledge_high_risk only covers dangerous findings,
                    # never a lying execution profile.
                    result.rejected_by_guard.append(
                        {"name": skill, "reason": reason or "guard rejected"}
                    )
                    return result
```

（为什么必须加：`acknowledge_high_risk=True` 时该函数两条拒绝分支都不进入，会直接 `os.rename` 安装——`should_allow` 的硬阻塞被 caller 的 ack 语义绕过，违背 AC-1「`acknowledge_high_risk` 不能绕过」。本块与 `should_allow` 的档位分支构成同一契约的两侧：共享结论 + 调用方无条件服从。）

#### Task 2 验证

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_skill_profile_gate.py -q --no-cov
# 预期：全部（含 registry / bundle 节）通过
/opt/miniconda3/bin/python3 -m pytest tests/test_registry_hub_clawhub_owner.py tests/test_skillhub_adapter_install.py tests/test_skillhub_agent_tools.py -q --no-cov
# 预期：既有用例全部保持通过（基线 30 已实测 skillhub_adapter_install+clawhub_owner；夹具技能都未声明 tier，门对它们恒为 None）
```

### Task 3：加载边界 + 闭环（`skill_bundle.py` + 新测试文件 + 全量回归）

依赖的现有 API：

| API | 出处 | 用法 |
| --- | --- | --- |
| `SkillBundleLoader(search_paths=[...])` / `scan()` | `agenticx/tools/skill_bundle.py:658-689, 691-889` | 加载门插入（scan 候选循环） |
| `scan()` 的 `_check_gate` 块 | `agenticx/tools/skill_bundle.py:870-876` | 插入模式样板（warning + continue） |
| `variants = self._skill_variants.setdefault(...)` | `agenticx/tools/skill_bundle.py:826` | 插入锚点（门必须在它之前） |
| `get_skill` / `get_skill_content` / `list_skills` / `get_skill_variants` | `agenticx/tools/skill_bundle.py:1154-1233` | 断言「逐方法都取不到」 |
| `tests/test_smoke_openskills_skill_bundle.py:176` 等 | 既有夹具模式 | `SkillBundleLoader(search_paths=[tmp])` |

#### 代码块 M —— `agenticx/tools/skill_bundle.py`（在 `:824`（source-level guard 的 `continue`）与 `:826`（`variants = self._skill_variants.setdefault(meta.name, [])`）之间插入）

```python
                        # Execution-profile gate (runtime invariants 05): a
                        # skill that declares ``tier:`` in frontmatter must
                        # still measure that tier. A mismatched skill is
                        # not registered at all, so every serving method
                        # (list / read / variants / prompt injection) stays
                        # closed, and the denial is audited persistently.
                        # Runs before the variants registration on purpose.
                        try:
                            from agenticx.skills.profile_gate import (
                                check_skill_profile,
                                note_profile_rejection,
                            )

                            _profile = check_skill_profile(cand_dir)
                            if _profile is not None and not _profile.ok:
                                note_profile_rejection(
                                    _profile,
                                    skill_name=meta.name,
                                    action="LOAD_DENIED",
                                    boundary="load",
                                )
                                logger.warning(
                                    "Skill '%s' tier mismatch (declared %s, measured %s), not registered: %s",
                                    meta.name,
                                    _profile.declared,
                                    _profile.measured,
                                    cand_md,
                                )
                                continue
                        except Exception:
                            logger.debug(
                                "skill profile gate failed for %s",
                                cand_md,
                                exc_info=True,
                            )
```

（`continue` 落在 `for cand_dir, cand_md in candidates:` 循环层——与 `:824` 的 source-guard `continue` 同层同语义。）

#### 测试：`tests/test_skill_profile_loader_gate.py`（Create，完整内容）

```python
#!/usr/bin/env python3
"""Load-boundary execution-profile gate tests (runtime invariants 05).

A skill that declares a tier but no longer measures it (post-install
tampering, or a package that lied past the install gate) must not be
registered by the loader: list, read, variants, and prompt injection all
consume the same registry, so all of them stay closed. The denial is
audited to the on-disk gate sink and survives an in-memory reset.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from agenticx.tools.skill_bundle import SkillBundleLoader
from agenticx.utils.agx_home import agx_home

HEAVY_FILE_COUNT = 11  # > HEAVY_CODE_FILES (10, guard_classify.py:18)

SKILL_MD_TMPL = """---
name: {name}
description: demo skill for loader gate tests
{tier_line}
---

# {name}

Plain instructions only.
"""


@pytest.fixture(autouse=True)
def _no_agx_home(monkeypatch: pytest.MonkeyPatch) -> None:
    # Keep agx_home() pointed at the conftest HOME sandbox even when the
    # local shell happens to export AGX_HOME (plan assumption #10).
    monkeypatch.delenv("AGX_HOME", raising=False)


def _write_skill(
    root: Path,
    name: str,
    *,
    declared: Optional[str] = None,
    heavy: bool = False,
) -> Path:
    tier_line = f"tier: {declared}" if declared else ""
    skill_dir = root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        SKILL_MD_TMPL.format(name=name, tier_line=tier_line), encoding="utf-8"
    )
    if heavy:
        for idx in range(HEAVY_FILE_COUNT):
            (skill_dir / f"script_{idx}.py").write_text("x = 1\n", encoding="utf-8")
    return skill_dir


def _read_gate_events() -> list[dict[str, Any]]:
    path = agx_home() / "safety" / "extension_gate.jsonl"
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def test_loader_skips_mismatched_skill(tmp_path: Path) -> None:
    _write_skill(tmp_path, "good-skill")
    _write_skill(tmp_path, "bad-skill", declared="T-MD", heavy=True)

    loader = SkillBundleLoader(search_paths=[tmp_path])

    names = {s.name for s in loader.scan()}
    assert names == {"good-skill"}
    assert loader.get_skill_content("bad-skill") is None
    assert loader.get_skill("bad-skill") is None
    assert loader.get_skill_variants("bad-skill") == []


def test_loader_keeps_matching_and_undeclared(tmp_path: Path) -> None:
    _write_skill(tmp_path, "honest", declared="T-HEAVY", heavy=True)
    _write_skill(tmp_path, "legacy")

    loader = SkillBundleLoader(search_paths=[tmp_path])

    names = {s.name for s in loader.scan()}
    assert names == {"honest", "legacy"}
    content = loader.get_skill_content("honest")
    assert content is not None
    assert "Plain instructions only." in content


def test_loader_denial_is_persisted_and_survives_reset(tmp_path: Path) -> None:
    import agenticx.runtime.studio_safety as studio_safety

    _write_skill(tmp_path, "audit-skill", declared="T-MD", heavy=True)

    loader = SkillBundleLoader(search_paths=[tmp_path])
    loader.scan()

    records = _read_gate_events()
    denials = [r for r in records if r["action"] == "LOAD_DENIED"]
    assert denials, "expected a LOAD_DENIED record in the gate sink"
    assert denials[0]["tool_name"] == "audit-skill"
    assert denials[0]["stage"] == "extension_profile_gate"
    assert "boundary=load" in denials[0]["details"]
    assert "declared=T-MD" in denials[0]["details"]
    assert "measured=T-HEAVY" in denials[0]["details"]
    # "restart": in-memory state is irrelevant for the audit trail
    studio_safety._reset()
    assert _read_gate_events() == records


def test_flag_off_loader_loads_everything(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("AGX_SKILL_PROFILE_GATE", "0")
    _write_skill(tmp_path, "bad-skill", declared="T-MD", heavy=True)

    loader = SkillBundleLoader(search_paths=[tmp_path])

    names = {s.name for s in loader.scan()}
    assert names == {"bad-skill"}
    assert loader.get_skill_content("bad-skill") is not None
    assert _read_gate_events() == []
```

#### Task 3 验证

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_skill_profile_loader_gate.py -q --no-cov
# 预期：4 个用例全部通过（先写测试时红）
/opt/miniconda3/bin/python3 -m pytest tests/test_smoke_openskills_skill_bundle.py tests/test_smoke_nexu_skill_metadata.py tests/test_smoke_openclaw_skill_gate.py -q --no-cov
# 预期：57 个既有用例保持通过（基线已实测）
# v2 引擎冒烟（F-1：attach 在包装层，v2 下同样生效）
AGX_SKILL_GUARD_VERSION=2 /opt/miniconda3/bin/python3 -m pytest tests/test_skill_profile_gate.py -q --no-cov
# 预期：全部通过（v2 路径下 profile attach 不依赖 result.tier）
```

## 实施后评审处置（2026-11-28）

实施由 sub agent 完成三个任务；主会话独立复跑验证（新测试 v1/v2 各 22 passed → 补 #1 修复后 35 passed；门禁 243 passed；ratchet 5 条 passed；冷启动 `/api/health` 200），并另派独立评审员。逐条处置：

| # | 来源 | 问题 | 处置 |
| --- | --- | --- | --- |
| 1 | 独立评审（高） | `agenticx/skills/import_repo.py` 的 GitHub tarball 路径：`acknowledge_high_risk=True` 且 verdict 为 `dangerous` 时，两条拒绝分支都不进入 → 直接 `os.rename` 安装，档位硬阻塞被 caller 绕过，违背 AC-1「`acknowledge_high_risk` 不能绕过」 | **采纳并修**：在 `if not ok:` 内先判 `profile.ok`，不一致即无条件拒绝（代码块 N）。新增 `test_github_tarball_tier_mismatch_blocks_even_with_ack`（夹具用 `hardcoded_secret` 命中使 verdict 真为 `dangerous`，否则测不到该分支）；已实测「有修复通过 / 撤掉修复失败」 |
| 2 | 独立评审（中） | `examples/agenticx-for-finance/FinnewsHunter` 子模块指针变更不在本 plan 落点内 | **不纳入提交**：该 submodule 在本系列开始前即已 dirty，全程不 `git add`（与 01–04 同口径） |
| 3 | 独立评审（中） | bundle `shutil.copytree` 与 GitHub `os.rename` 会跟随符号链接、拷贝隐藏文件，而 `measure_tier` 用 `rglob`（3.13 不递归符号链接）并排除隐藏文件 → 这两条路径「落地内容」与「测量内容」不同构，声明 `T-MD` 的包可夹带未测量的隐藏脚本 | **接受为已知残余（不改代码，修正 D-2 措辞）**：①注册表路径本就跳过 dot-file（`registry_hub.py:867`），同构成立；②bundle/GitHub 的拷贝语义是既有行为，改它会改变所有 bundle 的安装结果（隐藏资产可能是有意携带的运行时文件，如 `.env` 模板），风险大于收益且超出本 plan 边界；③符号链接是 guard 自身扫描的既有盲区，不是 05 引入；④隐藏 `.py` 会被 `compute_code_stats` 计入（F-3），verdict 若为 `dangerous` 仍需显式 ack。留作后续独立议题 |
| 4 | 独立评审（低） | `_tool_clawhub_install` 调 `write_registry_skill_package` 抛 `SkillProfileMismatchError` 时无本地捕获，返回形态依赖外层兜底，与 `/api/registry/install` 的结构化 `error_code` 不一致 | **接受（假设 #3 已列）**：拒绝本身成立且已落审计；工具层结构化改造需同时改 `agent_tools.py` 与工具结果 schema，超出 05 边界。记录为本系列后续项 |
| 5 | 独立评审（低） | `read_declared_tier` 的 `strip().strip("\"'").upper()` 不处理行内注释（`tier: T-MD # md` → 视为非法 → 跳过 + warning） | **符合设计**（D-b 非法值 fail-open + warning），不改 |
| 6 | 独立评审（低） | `measure_tier` 测量异常 → `None` → 档位门 fail-open | **符合设计**（D-3 明确取舍：模式扫描仍然跑过，统计失败不能把安装彻底打死），不改 |
| 7 | 独立评审（确认成立项） | 向后兼容（`ScanResult` 仅加尾字段、7 个函数签名/语义不变、未声明技能 `profile=None`）、安装/加载零落盘（registry 在 mkdir/rmtree 前、bundle 在 `with _lock:` 前、loader 在 variants 登记前）、审计独立 sink + `_reset()` 后仍可查 + pipeline 不含 gate 记录、开关关闭逐字回旧、测试密闭（HOME 沙箱 + `_no_agx_home` + 全 tmp_path）、非法值跳过、ratchet 不误伤、`skills` 包模块级无 `runtime` import | 全部确认无问题 |

评审结论：修复 #1 后可合入。既有环境失败（`test_meta_tools_list_skills_and_mcps`、`test_studio_server.py` 4 例、`test_skill_manage_rollback.py::test_rollback_to_previous_version`）与本改动无关。

## 交付约定

（照 04。）实施者只改本 plan「Precise landing points」列出的文件，不提交、不推送、不改测试断言。实现与 plan 一致但测试仍失败时停下报告，不许改断言。主会话独立复跑 `## Verification` 的全部命令，审 diff，用脚本把新文件与被替换的代码块同 plan 逐字比对，并另派独立评审。验收后：plan 从 `.cursor/plans/pending/` 移到 `.cursor/plans/`，`Status` 改为 `implemented`，只 `git add` plan 内列出的文件，提交一个 commit。规划阶段已执行头部清单中的只读探针；`## Verification` 的其余命令待实施时逐条执行并记录输出。

## Suggested impl models

- 实施：GLM-5.4（与 01/02/03/04 一致）。
- 不建议拆并行子 agent：Task 1 的 `ScanResult` 字段与 guard.py 改动被 Task 2/3 的所有门点消费（同一 dataclass 与同一错误语义），串行最稳；三个任务共享 `profile_gate.py` 的契约，任何并行都会在词汇表（四档拼写、错误文案）上引入漂移。

## Verification

判据对应表：

| 判据 | 自动化验证（测试文件::用例名） | 断言落点 |
| --- | --- | --- |
| AC-1 单技能包拒绝 | `tests/test_skill_profile_gate.py::test_should_allow_blocks_tier_mismatch_unconditionally`（`should_allow` 族：skill_manage 写入 / pending 批准 / import_repo×2）；`::test_write_registry_skill_dir_raises_on_mismatch`、`::test_write_registry_md_only_raises_on_mismatch`（registry 落盘族：clawhub 工具 / studio `/api/registry/install` / SkillHub / AGX native registry） | `ok is False` + 逐字 reason `"blocked: tier mismatch (declared T-MD, measured T-HEAVY)"`（builtin 也拒）；`pytest.raises(SkillProfileMismatchError)`；旧安装内容原样保留 |
| AC-2 AGX Bundle 拒绝 | `tests/test_skill_profile_gate.py::test_install_bundle_rejects_mismatch_and_writes_nothing`；`::test_bundle_scan_reports_profile_rejects`；`::test_install_bundle_accepts_consistent_bundle`（假阳性防回归） | `success is False`、`error_code == "tier_mismatch"`、逐字 error；技能目录 / bundles.json / mcp.json 全不存在；`profile_rejects == [{skill, declared, measured}]` |
| AC-3 审计重启可查 | `tests/test_skill_profile_gate.py::test_install_rejection_is_persisted_and_survives_reset`、`::test_gate_record_shape`、`::test_enterprise_outbox_mirror_for_gate_rejections`；`tests/test_skill_profile_loader_gate.py::test_loader_denial_is_persisted_and_survives_reset` | `studio_safety._reset()`（清内存）后 `safety/extension_gate.jsonl` 内容不变；record 的 stage/action/rule_ids/severity/details 逐字；pipeline 文件不含该记录；企业 outbox 行 `kind=="safety_event"`、`subject=="extension_profile_gate:INSTALL_REJECTED"` |
| AC-4 一致照常、存量零影响 | `tests/test_skill_profile_gate.py::test_should_allow_passes_matching_and_undeclared`、`::test_measure_tier_is_deterministic`、`::test_registry_write_accepts_consistent_skill`；`tests/test_skill_profile_loader_gate.py::test_loader_keeps_matching_and_undeclared` | 声明 T-HEAVY+11 py 放行；未声明 → `result.profile is None` 且照常安装/加载；provenance 侧车不打假 T-MD |
| AC-5 开关与零回归 | `tests/test_skill_profile_gate.py::test_flag_off_disables_the_gate`；`tests/test_skill_profile_loader_gate.py::test_flag_off_loader_loads_everything`；下方全部回归命令 | 开关关：profile None、放行、零审计；47/30/14/57 既有基线 + 门禁 243 + ratchet 5 条全部保持 |

命令：

```bash
# 新增测试（两个文件）
/opt/miniconda3/bin/python3 -m pytest tests/test_skill_profile_gate.py tests/test_skill_profile_loader_gate.py -q --no-cov

# 既有基线（规划阶段已执行，数字见头部探针清单）
/opt/miniconda3/bin/python3 -m pytest tests/test_skill_guard_cls_patterns.py tests/test_skill_import_repo.py tests/test_pending_queue.py tests/test_skillhub_install_guard.py -q --no-cov        # 47 passed
/opt/miniconda3/bin/python3 -m pytest tests/test_skillhub_adapter_install.py tests/test_registry_hub_clawhub_owner.py tests/test_action_audit.py -q --no-cov                                     # 30 passed
/opt/miniconda3/bin/python3 -m pytest tests/runtime/test_studio_safety.py -q --no-cov                                                                                                           # 14 passed
/opt/miniconda3/bin/python3 -m pytest tests/test_smoke_openskills_skill_bundle.py tests/test_smoke_nexu_skill_metadata.py tests/test_smoke_openclaw_skill_gate.py -q --no-cov                 # 57 passed
/opt/miniconda3/bin/python3 -m pytest tests/test_skill_manage_rollback.py tests/test_skill_manage_preview_apply.py tests/test_skillhub_agent_tools.py tests/test_skill_freeze.py -q --no-cov     # 11 passed, 1 failed（F-9 既有，口径=与实施前一致）

# v2 引擎冒烟（F-1）
AGX_SKILL_GUARD_VERSION=2 /opt/miniconda3/bin/python3 -m pytest tests/test_skill_profile_gate.py tests/test_skill_profile_loader_gate.py -q --no-cov

# 门禁（02）与 ratchet
PYTHONPATH=/tmp/agx-ci-deps:"$PWD" /opt/miniconda3/bin/python3 scripts/ci/python-regressions.py   # 现基线 243 passed
RATCHET_BASE_REF=HEAD /opt/miniconda3/bin/python3 scripts/ci/ratchet.py                          # 5 条规则全部通过

# 冷启动冒烟（guard.py / skill_bundle.py / studio_safety.py 都在 server import 链上）
.venv/bin/agx serve --host 127.0.0.1 --port 8769
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8769/api/health   # 期望 200
```

**ratchet 自查**：新代码（含测试）不含 `run_dir / "events.jsonl"`、`runs/*/events.jsonl`、`save_agent_state(`、`project_resume_anchor(`、`.mailbox.json`、`.context.json`、`RunEvent(` 七个字面量；不新增规则；现有 5 条基线一条不调大。

## 风险与回滚

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 拒绝面过宽（生态技能误伤） | 任何声明了 `tier:` 的第三方技能，只要与实测不符（包括四档阈值边缘抖动，如 200/201 行）都会被拒 | 未声明=完全跳过（存量零影响，grep 实测零占用）；非法值跳过不拒；测量钉死 `standard` 模式（操作员改扫描模式不影响）；`test_install_bundle_accepts_consistent_bundle` 等正向用例钉住假阳性 |
| `should_allow` 的间接调用方 | memory_dream / skill_quality_gate / hook 扫描 / patch 预览都走文本扫描（profile 恒 None），不受影响；但未来新增目录扫描调用方会自动获得档位门 | 这正是设计意图（接在共享结论处）；docstring 写明硬阻塞语义 |
| 异常冒泡形态 | `SkillProfileMismatchError` 在 clawhub 工具与 studio 端点路径上靠外层捕获转错误；若某调用方无捕获会以 500/工具错误形态出现 | 拒绝本身已成立（落盘前抛出）；冷启动冒烟 + 既有 skillhub/registry 测试回归覆盖；见假设清单 #5 |
| 审计文件预算 | 独立 sink 同样 20MB 满即丢（与 pipeline/outbox 同款语义，仓库无自动轮换） | 档位事件低频，独立预算不与 pipeline 采样共享；满盘 warning 与既有两处一致；主会话如要求自动轮换另立小改动（Out of scope） |
| loader 扫描成本 | 只对声明了档位的技能测量（staging 拷贝 + `compute_code_stats`）；存量技能零开销 | 探针实测 11 文件目录测量为毫秒级；声明档位是新 opt-in，作者自担 |
| `installer.py` 模块级路径常量 | bundle 测试必须显式 patch 六个常量（F-8），漏 patch 会写进前一个测试的沙箱 | `_patch_installer_home` 夹具集中处理；conftest 的真实 HOME 守卫兜底（污染真实 home 会让套件失败） |
| 开关默认开 | 声明了档位且不一致的技能开始被拒/被排除——对本仓库技能零影响（零声明），对生态是行为变化 | `AGX_SKILL_PROFILE_GATE=0` 即时回滚；拒绝文案与扫描载荷同时可见（profile 块） |

**回滚**：运行时回滚 = 设 `AGX_SKILL_PROFILE_GATE=0`（不 attach、不拒、不排除、不审计，安装与加载路径回到 05 前逐字行为）；已写入的 `safety/extension_gate.jsonl` 留在盘上无害（纯追加日志）。代码回滚 = revert 这一个 commit；无数据迁移、无 schema 变更（`ScanResult.profile` 是可选字段，旧序列化不含它也能读）。

## 已定案事项

### 规划时在授权范围内定的（主会话审查时可否决）

- **A-1** 声明档字段：SKILL.md frontmatter 顶层标量 `tier:`，词表四档（读时 `strip/strip quotes/upper` 归一）；bundle manifest 不加字段；near-plugin 兼容余量 = `read_declared_tier` 单点扩展。
- **A-2** 未声明 → 跳过；非法值 → 跳过 + warning（不拒绝；理由见核实结论 2 / D-1）。
- **A-3** 实测档 = `classify_tier(compute_code_stats(staged 可见文件), scan_mode="standard")`；staging 排除隐藏文件（provenance 侧车一致性，探针实锤）；不改 `compute_code_stats` 本身。
- **A-4** 挂点：`scan_skill` 包装层 attach + `should_allow` 硬阻塞（先于信任级、不可 ack）+ `write_registry_skill(_dir)` raise + `install_bundle` 整包拒绝（error_code=`tier_mismatch`，零落盘）+ loader `scan()` 不登记（variants 之前）。
- **A-5** 执行面统一口径：安装拒绝 + 加载不登记 + 运行期不拦；「逐方法鉴权」= list/read/variants/inject 共享 `_skills` 事实源（D-5 的 reconciliation）。
- **A-6** 文案：`"blocked: tier mismatch (declared {d}, measured {m})"`（英文短句，接 `should_allow` 既有风格）+ 两个中文格式化函数的档位行（F-7；逐字钉在测试里）。
- **A-7** 审计：独立文件 `safety/extension_gate.jsonl`（20MB 同款上限与丢弃语义）+ `_bridge_enterprise` 企业镜像；内存环不参与。
- **A-8** 开关 `AGX_SKILL_PROFILE_GATE` / `runtime.skill_profile_gate`，默认 True；关=逐字旧行为。
- **A-9** bundle 的 MCP server 配置不定档（F-6，理由写入代码注释）。
- **A-10** ratchet 不新增规则；现有 5 条零触碰。
- **A-11** 新增 2 个测试文件；不改任何既有测试文件。
- **A-12** `skills` 包对 `runtime` 的 import 全部函数级（`profile_gate` 内），模块级依赖图不变。

### 主会话定案（2026-11-28 审查时拍板）

- **D-a 审计出口：独立 `safety/extension_gate.jsonl`。** pipeline 文件的 20MB 共享预算与「满盘丢新事件」语义会直接威胁闭环判据「重启后仍能查到」；独立文件让判据不依赖 pipeline 容量状态。
- **D-b 非法声明值：跳过 + warning。** 未声明=无契约是本设计的明确语义；拒绝非法值零安全增益（省略即可绕过）、纯增第三方误伤。warning 保证笔误可见。
- **D-c `should_allow` 族审计接受 `tool_name` 为空串**（声明/实测档在 `details` 里）——不为一个名字字段改 4 个文件与签名。
- **D-d 加载门放 `scan()` 一次**，不做逐 read 测量；read 之后目录再被改的窗口属 `refresh()` / config watcher 的既有职责，05 不扩边界。
- **D-e F-9 按既有失败口径处理**（与 `test_meta_tools_list_skills_and_mcps` 同类），验收「与实施前一致」，05 不修。
- **D-f near-plugin plan 合入后**：在 `read_declared_tier` 单点对齐 manifest 侧 schema；本 plan 已留此接缝，无其它动作。

## 未经执行验证的假设清单

以下各点规划阶段无法静态核实，实施者在写实现前先跑对应探针或静态复核：

1. **`install_bundle` 拒绝路径的零落盘**：`scan_bundle_source` 在 `with _lock:`（`:276`）之前完成、`install_bundle` 的插入点在 verdict 检查之后锁之前——已读 `:223-276` 逐行；monkeypatch 六常量后 `_save_mcp_json`（`:159-171`）与 `_save_bundles_registry`（`:126-138`）使用 patched 值（模块属性在调用点解析——`_BUNDLES_JSON` 等是模块级 `Path` 常量被函数直接引用，monkeypatch.setattr 替换后函数读新值 ✓ CPython 语义成立；未实测）。
2. **`write_registry_skill_dir` 的既有安装保护**：门插在 `:823` 与 `:824` 之间（rmtree 前）——已读；若实际行号偏移，以「`skill_dir.relative_to(install_root)` 之后、`if skill_dir.exists():` 之前」锚点定位。测试断言旧内容保留依赖此序。
3. **clawhub 工具与 studio 端点对 `SkillProfileMismatchError` 的包装**：studio 端点有显式 try/except（`server.py:10501-10508` 模式，`install_skillhub_skill` 调用处已读）；`agent_tools` 的工具分发层是否宽捕获未逐字读——若无包装，异常以工具错误形态冒泡，拒绝仍成立（可接受），冷启动冒烟确认不崩进程即可。
4. **`_bridge_enterprise` 的 summary 拼接**：`"rules={} {}".format(",".join(rule_ids), details)`（`:138-141`）——`rule_ids=["tier_mismatch"]` 使 summary 含 `tier_mismatch`（测试断言依据）；已读映射逻辑，未在 enterprise monkeypatch 下实跑（Task 1 测试将验证）。
5. **v2 引擎下 `scan_skill` 的 attach 行为**：attach 在包装层、v1/v2 结果同构（都是 `ScanResult`）——已读；`AGX_SKILL_GUARD_VERSION=2` 冒烟在 Task 3 验证命令里（F-1）。
6. **loader 插入点的锚点**：`:824` 与 `:826` 之间无其它语句——已读 `:817-831`；若偏移以「source-level guard `continue` 之后、`variants = self._skill_variants.setdefault` 之前」定位。`continue` 的循环层语义（candidates 层）已核对。
7. **`SkillBundleLoader(search_paths=[tmp])` 的 scan 无副作用**（无 config_watcher/discovery_bus 时零额外行为，`:658-689` 已读；`_merge_remote_skills`（`:888`）在无 registry_url 时无害——`self.registry_url=None` 的行为未逐字读；既有 57 个 loader 用例同款构造通过，风险低）。
8. **`pytest.raises(..., match="tier mismatch: declared T-MD, measured T-HEAVY")` 的 regex 语义**：match 是 re.search——错误文案无特殊字符（冒号、逗号、空格），literal 子串匹配成立 ✓。
9. **企业镜像测试对 `ConfigManager` 的 classmethod monkeypatch**：沿用 `tests/test_action_audit.py:18-26` 的既有模式（实测通过），05 测试同款写法——audit_enabled 的读取路径（`action_audit.py:58-69`）已读。
10. **`agx_home()` 在 conftest HOME 沙箱下的解析**：无 `AGX_HOME` 环境变量、沙箱无 `data_root.json`/`config.yaml` 时回落 `Path.home()/".agenticx"`（`agx_home.py:60-125` 已读）——若本机 shell 恰好 export 了 `AGX_HOME`，测试读错目录；实施时如遇先 `monkeypatch.delenv("AGX_HOME", raising=False)`（安全起见可在两个测试文件加）。

## Commit trailers

提议的提交标题（英文，`type(scope): subject`）：

```
feat(skills): enforce declared skill tiers at the install and load boundaries
```

正文结构：`## What & Why`（技能静态分档从扫描结论变成可校验的执行边界：SKILL.md `tier:` 声明与实测档不一致的技能包、注册表包、AGX Bundle 在落盘前被拒；loader 不登记内容与声明不符的技能，list/read/注入逐方法关死；每次拒绝与越权经独立追加文件 `safety/extension_gate.jsonl` 与企业 outbox 落盘、重启可查；存量未声明技能零影响；为什么不改扫描规则——只消费 `classify_tier` 的结论）+ `## Requirements`（FR-1 声明档字段与测量原语；FR-2 `should_allow` 族与 registry/bundle 落盘族的硬拒绝；FR-3 加载门；FR-4 持久审计；FR-5 开关与零回归；AC-1 … AC-5 同 `## Goal`）。

trailers：

```
Plan-Id: 2026-11-27-runtime-invariants-05-extension-execution-profile
Plan-File: .cursor/plans/2026-11-27-runtime-invariants-05-extension-execution-profile.plan.md
Plan-Model: GLM-5.4
Impl-Model: GLM-5.4
Made-with: Damon Li
```
