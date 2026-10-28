# AGX Data Suite P3-Harden-7 — A8 managed schedule + webhook

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-harden-index.plan.md`  
> **Branch:** `feat/agx-data-suite-p3-spine`  
> **Depends on:** S2-6 optional; A8 templates already on branch  
> **Roadmap:** Track 2 item 4 — quality/dict-drift → managed schedule + 真 webhook 配置

**Goal:** Patrol runners can be driven by a schedule config (cron string + tick_id) and emit to an HTTP webhook URL (not only FakeWebhookSink). Examples + tests prove the binding without requiring a live Managed cloud.

**Out of scope:** Full MA admin ma-schedules UI redesign; NL2SQL LLM loop; metering billing; A9.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/managed/templates/data_suite/webhook.py` | Add `HttpWebhookSink` (urllib) |
| `agenticx/managed/templates/data_suite/schedule_tick.py` | `PatrolScheduleConfig` + `run_patrol_tick` |
| `agenticx/managed/templates/data_suite/__init__.py` | Exports |
| `examples/managed/data_suite/patrol-schedule.yaml` | cron + webhook_url + refs to patrol yamls |
| `tests/managed/templates/test_patrol_schedule.py` | memory HTTP via http.server or mock urlopen |
| `examples/data_suite/golden_path/patrol_stage.py` | Prefer schedule helper; keep Fake sink default |

## Interfaces

```python
@dataclass
class PatrolScheduleConfig:
    tick_id: str
    cron: str                      # stored metadata; S2 does not need a live cron daemon
    webhook_url: Optional[str]
    quality_patrol_yaml: Path
    dict_drift_yaml: Path
    fixtures_dir: Path

    @classmethod
    def load(cls, path) -> "PatrolScheduleConfig": ...

class HttpWebhookSink:
    def __init__(self, url: str, *, timeout: float = 5.0): ...
    def post(self, event: WebhookEvent) -> None:  # POST JSON {kind, payload}

def run_patrol_tick(
    cfg: PatrolScheduleConfig,
    rows: list[dict],
    *,
    quarantine: list | None = None,
    sink: Sink | None = None,
) -> dict:
    # build notifier (Http if webhook_url else Fake); run quality+drift via run_scheduled
```

## Tasks

### Task 1 — HttpWebhookSink + schedule config
- [x] Tests with stub urlopen / local HTTPServer
- [x] Implement sink + PatrolScheduleConfig.load + run_patrol_tick
- [x] Commit: `feat(managed): HTTP webhook sink and patrol schedule tick`

### Task 2 — Example + golden_path + e2e
- [x] Add `patrol-schedule.yaml`; extend `test_data_suite_e2e` or new test
- [x] Refactor patrol_stage to call `run_patrol_tick` (Fake when no URL)
- [x] Commit: `feat(managed): wire data_suite patrol schedule example`

### Task 3 — Gate
- [x] `pytest tests/managed/templates/ tests/data_suite/test_golden_path*.py -v --override-ini='addopts='`
- [x] Mark S2 Track 2 complete on harden index + after-a8 roadmap
- [x] Docs commit

## Done when
1. HttpWebhookSink POSTs JSON events
2. patrol-schedule.yaml loads and run_patrol_tick returns tick_id + webhook evidence
3. Golden path patrol still green with Fake sink
4. No push unless network OK (leave push to Damon)
