# AGX Data Suite P3-Spine-1 — Scaffold + Seed + Probe

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-spine-index.plan.md`

**Goal:** Create the golden-path example package with desensitized seed data and prove FakeChannel probe works as stage 1.

## File map

| Path | Responsibility |
|------|----------------|
| `examples/data_suite/golden_path/README.md` | Stub (full one-command lands in S1-5) |
| `examples/data_suite/golden_path/seed/members.json` | ~20 synthetic member rows (region/tier/phone/email) |
| `examples/data_suite/golden_path/seed/channels.yaml` | FakeChannel src/dst registration config (no secrets) |
| `examples/data_suite/golden_path/__init__.py` | Package marker |
| `examples/data_suite/golden_path/probe.py` | `probe_src(registry) -> ChannelProbeResult` helper |
| `tests/data_suite/test_golden_path_probe.py` | Loads seed into FakeChannel; probe returns tables/ok |

## Interfaces

```python
def load_member_seed(path: Path) -> list[dict]: ...
def build_golden_registry(*, seed_rows: list[dict]) -> ChannelRegistry:
    """Register FakeChannel 'src' with seed tables and empty 'dst' with write grant."""
def probe_src(registry: ChannelRegistry) -> ChannelProbeResult: ...
```

### Task 1

- [ ] Failing test: probe on empty registry fails; with seed, probe lists `members` and row count > 0.
- [ ] Implement seed JSON + channels.yaml + probe helper.
- [ ] Commit: `feat(data-suite): golden-path scaffold + FakeChannel seed probe`
