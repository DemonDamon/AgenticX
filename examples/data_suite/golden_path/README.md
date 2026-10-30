# Data Suite golden path (P3 spine)

Desensitized end-to-end demo chaining **A1–A8** into one story:

`FakeChannel probe → DataFlow job → OneID → dictionary/quality → tags/audience → config board → masking → A8 patrol webhook`

No customer names. Synthetic members only (`@example.invalid`).

## One command

From the AgenticX repo root:

```bash
python examples/data_suite/golden_path/run_golden_path.py
```

Expected: exit `0` and lines for `PROBE` / `JOB` / `GOV` / `TAGS` / `BOARD` / `PATROL` / `SUMMARY`.

## Tests

```bash
pytest tests/data_suite/test_golden_path_*.py -q --override-ini='addopts='
# or the full spine gate:
pytest tests/data_suite/test_golden_path_e2e.py -q --override-ini='addopts='
```

## Admin watermark (demo shots)

Admin console already renders `PageWatermark`. For screenshots:

```bash
export NEXT_PUBLIC_PAGE_WATERMARK=demo@agenticx.local
```

Point the admin data-boards section at this board seed when doing UI shots (`seed/board.yaml`).

## Layout

| Path | Role |
|------|------|
| `seed/` | YAML/JSON configs (channels, job, idmap, dict, quality, tags, audience, board, masking, patrol) |
| `probe.py` … `patrol_stage.py` | Stage helpers |
| `run_golden_path.py` | Orchestrator |

## File channel (H1)

Golden-path still uses **FakeChannel** seeds (`kind: fake`) so offline CI stays hermetic.
`FileChannel` (SFTP / object storage) is available via `build_channel(kind="file")` with an
injectable path/partition policy — no customer `date=YYYYMMDD` layout is hardcoded in the
channel kernel. Example partition templates belong in deployment config or unit tests only.

## Hive / Spark Thrift channel (H2)

Golden-path still uses **FakeChannel** seeds so offline CI stays hermetic.
`HiveChannel` (HiveServer2 / Spark Thrift SQL) is available via
`build_channel(kind="hive")` — or aliases `spark` / `sparksql` — with an
injectable in-memory transport for unit tests. Live pyhive/thrift wiring is
deferred (probe returns ok=False with a clear error when an endpoint is set
but the client lib is missing). No customer topology or schema names belong
in the channel kernel.
