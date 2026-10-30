# Data Suite golden path (P3 spine + H10)

Desensitized end-to-end demo chaining **A1–A8** + **H6 ops** into one story:

`Channel probe → DataFlow schedule tick / history / rerun → OneID → dictionary/quality → tags/audience → config board → masking → A8 patrol webhook`

No customer names. Synthetic members only (`@example.invalid`).

Default channel is **FakeChannel**. Hermetic **File** and **Hive** variants use in-memory transports (no live SFTP/OSS/Hive cluster required).

## One command (primary)

From the AgenticX repo root:

```bash
python examples/data_suite/golden_path/run_golden_path.py
```

Expected: exit `0` and lines for `PROBE` / `OPS` / `JOB` / `GOV` / `TAGS` / `BOARD` / `PATROL` / `SUMMARY`.

## Channel variants (also exit 0)

```bash
# FileChannel + InMemoryFileTransport (H1)
python examples/data_suite/golden_path/run_golden_path.py --channel file

# HiveChannel + InMemoryHiveTransport / Fake Thrift stub (H2)
python examples/data_suite/golden_path/run_golden_path.py --channel hive

# Equivalent via env
AGX_GOLDEN_CHANNEL=file python examples/data_suite/golden_path/run_golden_path.py
AGX_GOLDEN_CHANNEL=hive python examples/data_suite/golden_path/run_golden_path.py
```

## Tests

```bash
pytest tests/data_suite/test_golden_path_*.py -q --override-ini='addopts='
# or the full spine gate:
pytest tests/data_suite/test_golden_path_e2e.py tests/data_suite/test_golden_path_channel_variants.py tests/data_suite/test_golden_path_ops.py -q --override-ini='addopts='
```

## Admin / ops shots

- H6 数据作业运维台：`docs/agx-data-suite/shots/h6-data-jobs.png`
- H10 CLI 变体帧：`docs/agx-data-suite/shots/h10-golden-fake.png` / `h10-golden-file.png` / `h10-golden-hive.png`

Admin console already renders `PageWatermark`. For screenshots:

```bash
export NEXT_PUBLIC_PAGE_WATERMARK=demo@agenticx.local
```

## Layout

| Path | Role |
|------|------|
| `seed/` | YAML/JSON configs (channels, job, idmap, dict, quality, tags, audience, board, masking, patrol) |
| `probe.py` … `patrol_stage.py` / `ops_stage.py` | Stage helpers |
| `run_golden_path.py` | Orchestrator (`--channel fake\|file\|hive`) |

## File channel (H1)

`--channel file` registers `FileChannel` with `InMemoryFileTransport` seeded from `members.json`.
Path/partition policy stays injectable — no customer `date=YYYYMMDD` layout is hardcoded in the channel kernel.

## Hive / Spark Thrift channel (H2)

`--channel hive` registers `HiveChannel` with `InMemoryHiveTransport` (Fake Thrift stub).
Live pyhive/thrift wiring remains deferred; golden-path does not require a live Hive cluster.

## Non-goals

售前能力地图 / GTM 一页归 Track 4 `delivery_pack`，不在本 golden-path / 主仓 P0。
