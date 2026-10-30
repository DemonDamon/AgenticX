# AGX Data Suite H10 — golden-path 通道场景扩展

> **Parent:** `.cursor/plans/pending/2026-10-30-data-suite-p3-harden.plan.md` §H10  
> **Branch:** `feat/agx-data-suite-h10-golden-path`  
> **Depends on:** H8 merged (`aebf5c8a` / PR #175).  
> **Main-repo gate:** 演示/回归基座 only；禁止售前能力地图 / GTM / `delivery_pack` 进 `agenticx/` 或本 PR。

**Goal:** 扩展 golden-path：
1. 主线接入 H6 作业运维演示（schedule tick → history → rerun），保持**一条** README 主命令 exit 0
2. 增加 **File** 与 **Hive** 通道变体（InMemory / Fake Thrift 桩，无 mandatory live 集群）
3. README 文档化变体命令（CLI `--channel` / env `AGX_GOLDEN_CHANNEL`）亦 exit 0
4. 截图入 `docs/agx-data-suite/shots/`（复用 H6 admin shot + CLI 变体帧）

**Architecture:** `probe.build_golden_registry(kind=…)` 按 `fake|file|hive` 注册 src/dst；`run_golden_path.py` 主线改为 probe → **ops** → gov → tags → board → patrol；`pipeline.dst_rows` 经 `query` 兼容三通道；pytest 覆盖主线 + 两变体。

**Tech Stack:** Python 3.10+、FileChannel / HiveChannel 内存桩、DataJobOpsService、pytest、Pillow（CLI 截图）。

## Global Constraints

- 假成员 `@example.invalid` only；无客户拓扑 / 分区规范硬编码进 kernel。
- **非目标：** 售前能力地图一页（Track 4 GTM / delivery_pack）；不得作为主仓 P0。
- 不启动 H9；不 merge；不动 FinnewsHunter。

## Inventory（H10 前 @ `aebf5c8a`）

| 面 | 状态 |
|----|------|
| `golden_path/run_golden_path.py` | Fake-only：probe→job→gov→tags→board→patrol；**无 OPS** |
| `golden_path/ops_stage.py` + `test_golden_path_ops.py` | H6 已合入；**未**接入主 README 命令 |
| `golden_path/probe.py` | 仅 FakeChannel registry |
| `pipeline.dst_rows` | 读 `ch.tables` — **仅 Fake** |
| README | 一条 Fake 命令；File/Hive 仅文字说明「可用 build_channel」 |
| `FileChannel` / `HiveChannel` + unit tests | H1/H2 已合入；可跑 golden job（冒烟已证） |
| `test_golden_path_e2e.py` | 无 ops、无 file/hive 变体 |
| `docs/agx-data-suite/shots/h6-data-jobs.png` | 已有 ops UI；缺 CLI 变体帧 |
| 售前能力地图 / delivery_pack | **非目标** |

## File map

| Path | Responsibility |
|------|----------------|
| `examples/data_suite/golden_path/probe.py` | `kind=fake\|file\|hive` registry 构建 |
| `examples/data_suite/golden_path/pipeline.py` | `dst_rows` 经 query 兼容三通道 |
| `examples/data_suite/golden_path/run_golden_path.py` | CLI `--channel` / env；主线接 OPS |
| `examples/data_suite/golden_path/README.md` | 主命令 + file/hive 变体命令 |
| `tests/data_suite/test_golden_path_e2e.py` | 主线含 OPS |
| `tests/data_suite/test_golden_path_channel_variants.py` | file + hive 变体绿 |
| `tests/data_suite/test_golden_path_ops.py` | 保持绿 |
| `docs/agx-data-suite/shots/h10-golden-*.png` | CLI 变体截图；ops 复用 h6 |
| `.cursor/plans/pending/2026-10-30-agx-data-suite-h10-golden-path.plan.md` | 本 plan |

## Interfaces

```python
# probe.py
def build_golden_registry(
    *,
    seed_rows: list[dict] | None = None,
    channels_yaml: str | Path | None = None,
    kind: str = "fake",  # "fake" | "file" | "hive"
) -> ChannelRegistry: ...

# pipeline.py
def dst_rows(registry, table: str = "members_out") -> list[dict]:
    """Prefer channel.query SELECT *; fallback FakeChannel.tables."""

# run_golden_path.py CLI
#   python .../run_golden_path.py
#   python .../run_golden_path.py --channel file
#   python .../run_golden_path.py --channel hive
#   AGX_GOLDEN_CHANNEL=file python .../run_golden_path.py
```

**主线阶段顺序：** `PROBE → OPS (tick/history/rerun) → GOV → TAGS → BOARD → PATROL → SUMMARY`

## Tasks

### Task 1 — Plan + registry kinds + ops wire + variants + tests + shots

- [x] 本 plan 落盘
- [x] `probe.py` kind=file/hive（InMemoryFileTransport / InMemoryHiveTransport）
- [x] `pipeline.dst_rows` query-compatible
- [x] `run_golden_path.py`：OPS 入主线；`--channel` / `AGX_GOLDEN_CHANNEL`
- [x] README：主命令 + 变体命令
- [x] `test_golden_path_e2e.py` 断言 OPS；`test_golden_path_channel_variants.py`
- [x] shots：`h10-golden-fake.png` / `h10-golden-file.png` / `h10-golden-hive.png`（+ 注明复用 `h6-data-jobs.png`）
- [x] Commit: `feat(data-suite): H10 golden-path file/hive variants + ops`

### Task 2 — PR（不 merge）

- [ ] Mark plan Done；push；`gh pr create` 含 gates 表 + e2e/commands checkbox
- [ ] **不 merge；不启动 H9**

## Done when

1. README 主命令 exit 0，输出含 `PROBE` / `OPS` / `GOV` / `TAGS` / `BOARD` / `PATROL` / `SUMMARY`
2. `--channel file` 与 `--channel hive`（及等价 env）exit 0
3. `test_golden_path_*.py`（含 e2e / ops / channel_variants）全绿
4. shots 入 `docs/agx-data-suite/shots/`
5. 无 GTM/能力地图、无 delivery_pack、无 FinnewsHunter、无 H9、无 merge

## Gate before H9

Merge this PR（或用户 stack）后再开 H9 NL2SQL LLM 闭环 + metering。
