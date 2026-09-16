---
name: sdk-reliability-05-fail-closed-defaults
overview: 把默认姿态从 fail-open 翻到 fail-closed，并让两处"写失败被吞掉"的代码显式暴露失败。当前 agenticx/runtime/harden_flags.py:93-95 的 persist_fail_closed_enabled() 默认 False（持久化失败时带病继续），agenticx/runtime/checkpoint.py:73-88 的 CheckpointStore.save() 把写失败 logger.warning 后吞掉。这两处叠加的后果是：磁盘写不进去时用户完全无感，直到崩溃后才发现无从恢复。本 Subplan 引入统一的 reliability.posture 设置（strict | legacy），把默认切到 strict，让 CheckpointStore 的失败对调用方可见，并给出既有会话的迁移与回滚路径。必须在 Subplan 04 的基准数字证明翻转有正收益之后才动手。
todos:
  - id: t1
    content: 新增 reliability_posture() 解析器（env > config.yaml > default=strict）
    status: pending
  - id: t2
    content: persist_fail_closed_enabled() 默认改为跟随 posture
    status: pending
  - id: t3
    content: CheckpointStore.save 失败可见（返回值 + 计数器 + 一次性告警）
    status: pending
  - id: t4
    content: 用 Subplan 04 基准跑 strict/legacy 对照，落盘数字
    status: pending
  - id: t5
    content: 迁移与回滚文档 + 现有测试全绿 + agx serve 冷启动冒烟
    status: pending
  - id: t6
    content: 登记 Desktop GUI 后续 plan（本阶段不做前端）
    status: pending
isProject: false
---

# Subplan 05：fail-closed 默认姿态切换

**Plan-Id**: `2026-09-12-sdk-reliability-05-fail-closed-defaults`
**Plan-File**: `.cursor/plans/2026-09-12-sdk-reliability-05-fail-closed-defaults.plan.md`
**Master**: `2026-09-12-sdk-reliability-kernel-master`
**依赖**: Subplan 04 **必须先跑出基准数字**（本 plan 的 t4 是决策门槛，不是形式）
**Planned-with**: Claude Opus 5
**Suggested-Impl-Model**: GPT-5.x 级强推理档（理由见下）
**Made-with**: Damon Li

> **为什么这个 Subplan 不给 Grok 4.6**：它翻转的是**已上线产品**（Studio / Near 桌面端）的默认行为，影响面跨 `agent_runtime` 主循环、`checkpoint`、Desktop 用户可感知体验，且失败模式是「用户的会话被中止」——属跨栈高风险收口，需要强推理档做影响面推演。前四个 Subplan 都是新增隔离模块，风险性质完全不同。

---

## 1. 现状与根因

### 1.1 两处 fail-open 叠加

**第一处** — `agenticx/runtime/harden_flags.py:93-95`：

```python
def persist_fail_closed_enabled() -> bool:
    """``AGX_PERSIST_FAIL_CLOSED`` / ``runtime.persist_fail_closed``. Default False."""
    return _resolve_bool("AGX_PERSIST_FAIL_CLOSED", "runtime.persist_fail_closed", False)
```

它控制 `agenticx/runtime/agent_runtime.py:2887` 的 `_persist_or_abort()`：

```2891:2899:agenticx/runtime/agent_runtime.py
        try:
            self._mid_turn_persist()
        except Exception as exc:
            logger.exception("persist before %s failed", reason)
            from agenticx.runtime.harden_flags import persist_fail_closed_enabled

            if persist_fail_closed_enabled():
                return False, f"{type(exc).__name__}: {exc}"
            return True, ""
```

调用点两个：`:4109`（发 LLM 请求前）与 `:6274`（执行工具前）。**默认 False 的实际含义是：磁盘写不进去（满盘/只读/权限），照样发请求、照样执行有副作用的工具。** 副作用发生了，但「我做过这件事」这条记录没落盘 —— 这正是重复副作用的产生条件。

**第二处** — `agenticx/runtime/checkpoint.py:73-88`：

```python
    def save(self, checkpoint: AgentCheckpoint) -> None:
        try:
            ...
        except Exception:
            logger.warning(
                "checkpoint save failed session=%s",
                checkpoint.session_id,
                exc_info=True,
            )
```

类 docstring 自己写明：`"""Write failures are logged and swallowed (same tolerance as the existing mid-turn persist path)"""`。返回 `None`，调用方**无法区分**「存好了」和「没存上」。

### 1.2 叠加后果

两处都是 fail-open ⇒ 崩溃恢复能力在磁盘异常时**静默降级到零**，且：
- 用户无任何可见信号（`logger.warning` 在 Desktop 用户眼里等于不存在）
- 崩溃后才发现无从恢复，此时已无法补救
- 与 `conclusions/runtime_module_conclusion.md` 里那张 `AGX_*` 表并列的其它加固项（`AGX_OVERFLOW_RETRY` 默认 True、`AGX_INTERRUPTED_CLOSERS` 默认 True、`AGX_CANCELLED_PREFIX_FINALIZE` 默认 True）姿态不一致 —— 唯独最关键的持久化保护默认关着

对照上游 openai-agents-python：它在 persist 边界是 **fail-closed** 的（`_pending_session_write` / `_terminal_unrecoverable` 明确标记「已接受终态输出但尚未成功持久化」这个危险窗口，并拒绝在该窗口内继续）。这是我们目前**落后**的一点，不是领先的一点。

### 1.3 但不能盲翻

`persist_fail_closed_enabled()` 翻成 True 后，磁盘异常时用户会看到「本轮被中止」，比「带病继续」更刺眼。是否净收益，取决于：**中止一轮的代价** vs **重复副作用 + 无法恢复的代价**。这个判断必须有数字支撑，不能凭直觉 —— 所以 t4 是硬门槛。

---

## 2. In scope / Out of scope

### In scope

**修改：**
- `agenticx/runtime/harden_flags.py`（新增 `reliability_posture()`；改 `persist_fail_closed_enabled()` 的默认来源）
- `agenticx/runtime/checkpoint.py`（`save()` 改为可观测；**不改** `AgentCheckpoint` 数据结构、不改 `load()` 语义）
- `agenticx/reliability/__init__.py`（追加导出 `reliability_posture` 的 re-export，供 SDK 侧读同一姿态）

**新增：**
- `docs/guides/reliability-posture.md`（迁移与回滚说明）
- `tests/test_reliability_posture.py`
- `.cursor/plans/pending/<日期>-reliability-posture-desktop-gui.plan.md`（占位后续 plan，见第 7 节）

### Out of scope

- **不改** `agenticx/runtime/agent_runtime.py`。`_persist_or_abort()` 的逻辑一行不动 —— 它已经正确地在 flag 为 True 时返回 `(False, detail)`，我们只改 flag 的默认值。**这一点非常重要**：`agent_runtime.py` 是 8000+ 行的主循环，本 plan 不具备改它的正当理由。
- **不改** `agenticx/studio/server.py`（该文件的 import 区极度敏感，见工作区规则中记录的 `GroupChatRegistry` 误删事故）。
- **不改** 其它任何 `harden_flags.py` 里的默认值。只碰 `persist_fail_closed_enabled` 一个。
- **不改** `agenticx/reliability/**` 的 Subplan 01–03 产物（它们从一开始就是 fail-closed 的，不需要开关）。
- **不做 Desktop / 前端改动**（见第 7 节的处理方式）。
- 不做「持久化失败时自动降级到备用存储路径」这类补偿机制（另一个议题，容易引入新的一致性问题）。
- 不新增第三方依赖。

---

## 3. t1 + t2：`reliability.posture`

### 3.1 新增解析器

在 `agenticx/runtime/harden_flags.py` 末尾追加（沿用文件里既有的 `_resolve_bool` / `_config_int` 风格，新增一个 `_config_str`）：

```python
RELIABILITY_POSTURES = ("strict", "legacy")


def _config_str(key: str) -> Optional[str]:
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg = ConfigManager.get_value(key)
        if isinstance(cfg, str) and cfg.strip():
            return cfg.strip().lower()
    except Exception:
        pass
    return None


def reliability_posture() -> str:
    """``AGX_RELIABILITY_POSTURE`` / ``reliability.posture``. Default ``"strict"``.

    ``strict``  — durability failures abort the current turn and surface to the
                  user; this is the posture the reliability benchmark measures.
    ``legacy``  — pre-2026-09 behaviour: durability failures are logged and the
                  run continues. Kept as an explicit escape hatch, not a default.

    An unrecognised value falls back to ``"strict"`` (fail-closed on config
    typos too — a misspelled posture must not silently weaken durability).
    """
    raw = os.environ.get("AGX_RELIABILITY_POSTURE", "").strip().lower()
    if raw not in RELIABILITY_POSTURES:
        raw = _config_str("reliability.posture") or ""
    if raw not in RELIABILITY_POSTURES:
        return "strict"
    return raw
```

**注意最后那条**：配错值（比如写成 `"struct"`）回落到 `strict`，不是回落到 `legacy`。理由写进 docstring：配置笔误不应该悄悄削弱持久化保证。

### 3.2 改 `persist_fail_closed_enabled()`

**before**（`:93-95`）：
```python
def persist_fail_closed_enabled() -> bool:
    """``AGX_PERSIST_FAIL_CLOSED`` / ``runtime.persist_fail_closed``. Default False."""
    return _resolve_bool("AGX_PERSIST_FAIL_CLOSED", "runtime.persist_fail_closed", False)
```

**after**：
```python
def persist_fail_closed_enabled() -> bool:
    """``AGX_PERSIST_FAIL_CLOSED`` / ``runtime.persist_fail_closed``.

    Default follows ``reliability_posture()``: True under ``strict`` (the new
    default), False under ``legacy``. The dedicated env var / config key still
    wins when set, so an operator can pin this single behaviour without moving
    the whole posture.
    """
    return _resolve_bool(
        "AGX_PERSIST_FAIL_CLOSED",
        "runtime.persist_fail_closed",
        reliability_posture() == "strict",
    )
```

优先级链变成：`AGX_PERSIST_FAIL_CLOSED` > `runtime.persist_fail_closed` > `AGX_RELIABILITY_POSTURE` > `reliability.posture` > `strict`。

**为什么保留细粒度 flag 而不是删掉**：既有测试 `tests/test_smoke_persist_fail_closed.py` 四个用例全部显式 `monkeypatch.setenv("AGX_PERSIST_FAIL_CLOSED", ...)`，保留细粒度 flag 让它们**零修改通过**。这也是运维现场最需要的能力（只关一项、不整体退回 legacy）。

### 3.3 SDK 侧读同一姿态

`agenticx/reliability/__init__.py` 追加：

```python
def reliability_posture() -> str:
    """Re-export of the runtime posture resolver (see harden_flags)."""
    from agenticx.runtime.harden_flags import reliability_posture as _impl

    return _impl()
```

**必须用函数内 import**：`agenticx.reliability` 要保持零 Studio 耦合（master AC-M5），而 `harden_flags` 会 lazy-import `agenticx.cli.config_manager`。做成函数内 import 后，只有真正调用时才拉链，`import agenticx.reliability` 本身仍然干净。**AC 里要验这一点。**

---

## 4. t3：`CheckpointStore.save` 失败可见

`agenticx/runtime/checkpoint.py` 的 `save()` 改造，三项要求：

1. **返回 `bool`**（成功/失败），而不是 `None`。签名从 `def save(self, checkpoint) -> None` 改为 `-> bool`。
2. **累计失败计数**：实例上加 `self.save_failures: int`，每次失败 +1。调用方（以及测试）可据此判断持久化是否在静默劣化。
3. **首次失败升级日志级别**：第 1 次失败用 `logger.error`（而非现在的 `logger.warning`），后续沿用 `warning` 避免刷屏。日志文本要包含 `session_id` 与异常类型。

`strict` 姿态下**是否抛异常**：**不抛**。理由：`_write_run_checkpoint()`（`agent_runtime.py:2915`）的 docstring 明确是 `"""Best-effort crash-recovery checkpoint (no-op when store absent)."""`，语义上是 best-effort 补充，不是主持久化路径（主路径是 `_mid_turn_persist`，由 `_persist_or_abort` 守着）。在这里抛异常会让 checkpoint 从「加分项」变成「新的失败源」，风险大于收益。

**改动后 docstring 必须更新**：现在写的 `"""Write failures are logged and swallowed..."""` 已不准确，改成说明返回值与计数器语义。

**调用方是否要改**：`_write_run_checkpoint` 目前忽略返回值。**本 plan 不改它**（那是 `agent_runtime.py`，out of scope）。返回值先给测试和未来的 Desktop 指示灯用。这个「暂时无人消费返回值」的状态要在 plan 里写明，不要让实施者以为漏了接线。

---

## 5. t4：对照基准（决策门槛）

用 Subplan 04 的 `ReliabilityRunner` 跑两遍：

```bash
AGX_RELIABILITY_POSTURE=legacy python -c "<Subplan 04 AC-4 的报告脚本>" > /tmp/posture-legacy.md
AGX_RELIABILITY_POSTURE=strict python -c "<同一脚本>" > /tmp/posture-strict.md
diff /tmp/posture-legacy.md /tmp/posture-strict.md
```

把两份四指标数字**原样**抄进 `docs/guides/reliability-posture.md` 的对照表。

**放行条件（全部满足才继续 t1–t3 的落地）**：

| 条件 | 判据 |
|---|---|
| strict 的 `duplicate_side_effect_rate` ≤ legacy 的 | 不能变差 |
| strict 的 `crash_recovery_success_rate` ≥ legacy 的 | 不能变差 |
| strict 的 `history_consistency_rate` == 1.0 | 硬要求 |
| strict 的 `error_diagnosability_rate` ≥ legacy 的 | 中止一轮必须比带病继续更可诊断 |

**如果 strict 在任一指标上更差**：不要翻默认值。把数字写进 `docs/guides/reliability-posture.md`，把本 Subplan 的 t1–t3 缩减为「只加 `reliability.posture` 开关、默认仍 legacy」，并在文档里写明为什么没翻。诚实记录一个负结果，比硬翻一个没有证据支撑的默认值有价值 —— 这也是 master plan §5「AC-M2 数字出来之前不对外声称领先」的同一条纪律。

---

## 6. 验收标准

### AC-1：既有测试零修改通过（最硬）

```bash
pytest tests/test_smoke_persist_fail_closed.py -q
pytest tests/ -k "harden or checkpoint or persist" -q
```

`tests/test_smoke_persist_fail_closed.py` 的 4 个用例都显式设了 env var，**必须一行不改就绿**。若需要改测试，说明第 3.2 节的优先级链实现错了。

### AC-2：`tests/test_reliability_posture.py`

| 测试名 | 断言 |
|---|---|
| `test_default_posture_is_strict` | 清空相关 env → `reliability_posture() == "strict"` |
| `test_env_selects_legacy` | `AGX_RELIABILITY_POSTURE=legacy` → `"legacy"` |
| `test_env_case_insensitive` | `AGX_RELIABILITY_POSTURE=STRICT` → `"strict"` |
| `test_typo_falls_back_to_strict` | `AGX_RELIABILITY_POSTURE=struct` → `"strict"`（**不是** legacy） |
| `test_persist_default_follows_posture` | posture=strict + 无 `AGX_PERSIST_FAIL_CLOSED` → `persist_fail_closed_enabled() is True`；posture=legacy → `False` |
| `test_explicit_flag_overrides_posture` | posture=strict + `AGX_PERSIST_FAIL_CLOSED=0` → `False`；posture=legacy + `AGX_PERSIST_FAIL_CLOSED=1` → `True` |
| `test_other_flags_unchanged` | `overflow_retry_enabled()` / `interrupted_closers_enabled()` / `cancelled_prefix_finalize_enabled()` / `fresh_round_loop_enabled()` / `max_overflow_retries()` 在两种 posture 下取值**完全一致**（证明没误伤别的开关） |
| `test_checkpoint_save_returns_true_on_success` | 正常路径返回 `True`，`save_failures == 0` |
| `test_checkpoint_save_returns_false_on_failure` | monkeypatch 存储抛异常 → 返回 `False`，`save_failures == 1`，**不抛异常** |
| `test_checkpoint_first_failure_logs_error` | `caplog` 里第 1 次是 `ERROR` 级、第 2 次是 `WARNING` 级；两条都含 `session_id` |
| `test_reliability_import_stays_clean` | `import agenticx.reliability` 后 `sys.modules` 里无 `agenticx.studio.*`（验证 3.3 的函数内 import） |

### AC-3：Studio 冷启动冒烟（强制门槛）

改了 `harden_flags.py` / `checkpoint.py` 就必须验后端起得来：

```bash
agx serve --host 127.0.0.1 --port 18801 &
sleep 12
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18801/api/session
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18801/api/avatars
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18801/api/sessions
kill %1
```

三个都必须 200。`--noproxy '*'` 不能省（本机 shell 常配了 `all_proxy`，走 SOCKS 会拿到空响应）。

### AC-4：真实会话不被打断（人工验证一次）

启动 Desktop（`npm run dev`，Vite 端口 5713），与 Machi 正常对话 3 轮含至少 1 次工具调用，确认：
- 一切正常时**没有任何**新增的报错/提示（strict 姿态在磁盘健康时应完全不可感知）
- 历史会话、分身列表、工作区都正常（对齐工作区规则里那条排障经验：这三处同时空态优先怀疑 `agx serve` 没活）

把观察结果写进 `docs/guides/reliability-posture.md` 的验证记录段。

### AC-5：文档

`docs/guides/reliability-posture.md` 必须含：
1. 两种 posture 的行为差异表
2. t4 的 strict/legacy 四指标对照（**真实跑出来的数字，不许编**）
3. 回滚方法：`export AGX_RELIABILITY_POSTURE=legacy` 或在 `~/.agenticx/config.yaml` 写 `reliability: {posture: legacy}`
4. 只回滚单项：`export AGX_PERSIST_FAIL_CLOSED=0`
5. 第 5 节的方法论限制说明（进程内模拟崩溃，非物理故障演练）
6. AC-4 的人工验证记录

---

## 7. t6：Desktop GUI 后续登记

工作区规则要求「用户可改配置项必须提供 Desktop 设置面板 GUI」。本 Subplan 引入的 `reliability.posture` 是用户可改配置，但第一阶段范围**明确排除前端改动**（master plan §3）。

处理方式：**不在这里做，但必须显式登记**，不能默默留一个只能手改 YAML 的开关。

新建 `.cursor/plans/pending/<实施当日日期>-reliability-posture-desktop-gui.plan.md`，内容至少写清：
- 落点：`desktop/src/components/SettingsPanel.tsx` 的 Automation / Runtime 分区（那里已有 `max_tool_rounds` / `max_taskspaces` 等运行参数字段，`saveRuntimeConfig` / `loadRuntimeConfig` 这对 IPC 已存在，只需在参数包里加一个键）
- 需同步的四处：`desktop/electron/main.ts` 的 IPC handler、`desktop/electron/preload.ts`、`desktop/src/global.d.ts`、`SettingsPanel.tsx` 的表单字段
- 控件形态：两态选择（严格 / 兼容），不是 `SettingsSwitch`——姿态不是布尔开关，未来可能加第三态
- 提醒：改 `desktop/electron/main.ts` 后必须**完整重启** `npm run dev`（`tsc --watch` 会重编 `dist-electron/`，但主进程不热重载，只刷渲染进程看不到新 IPC）

本 Subplan 的验收只要求这个 plan 文件**存在且落点具体**，不要求实现。

---

## 8. no-scope-creep 边界

改动文件白名单：

```
agenticx/runtime/harden_flags.py                          (新增 2 个函数 + 改 1 个函数的默认来源)
agenticx/runtime/checkpoint.py                            (仅 save() 返回值/计数器/日志级别 + docstring)
agenticx/reliability/__init__.py                          (仅追加 reliability_posture re-export)
docs/guides/reliability-posture.md                        (新增)
tests/test_reliability_posture.py                         (新增)
.cursor/plans/pending/<date>-reliability-posture-desktop-gui.plan.md   (新增，仅登记)
```

明确禁止：
- **不改 `agenticx/runtime/agent_runtime.py`**，一行都不改。`_persist_or_abort` 的逻辑已经对了。
- **不改 `agenticx/studio/server.py`**，一行都不改。
- 不翻 `harden_flags.py` 里其它任何默认值（`fresh_round_loop` 默认 False 是有原因的，别顺手动）。
- 不改 `AgentCheckpoint` 数据结构、不改 `CheckpointStore.load()` 的「缺失/损坏读作 None」语义。
- 不给 `CheckpointStore.save` 加「失败时抛异常」（第 4 节已说明理由）。
- 不做前端改动。
- 不在 t4 数字不达标时硬翻默认值。
