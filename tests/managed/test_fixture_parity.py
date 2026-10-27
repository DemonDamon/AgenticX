"""Cross-check Python manifest hashes against the values shared with TypeScript.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.managed.errors import ALL_ERROR_CODES
from agenticx.managed.manifest import validate_manifest
from agenticx.managed.protocol import (
    CLIENT_EVENT_TYPES,
    MANIFEST_SCHEMA,
    PAT_SCOPES,
    PROTOCOL_VERSION,
    SERVER_EVENT_TYPES,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "managed_agents" / "manifest_cases.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]

EXPECTED_HASHES = {
    "minimal_ok": "sha256:c954e3badab0922a9eeaece960c62a731466246568670e09c849e37cbe1a515a",
    "full_ok": "sha256:0dd6d6555588e8e742ea31ca460e1e59715dd027814d812b2c694dec9dbe0e8b",
    "multiagent_ok": "sha256:5f6bd22a8b2abfe89e9e2b118e722a3ea757da0112542fc913deb6055b49bf85",
    "multiagent_agent_version_omitted_ok": "sha256:c0d5ea7b6a510a0cfef8645eecaa9e4fa8ae861725f84a85150ccb45a1fa136e",
}


def test_manifest_hashes_match_ts() -> None:
    seen: list[str] = []
    for case in CASES:
        if not case["ok"]:
            continue
        result = validate_manifest(case["input"])
        assert result.manifest_hash == EXPECTED_HASHES[case["name"]]
        seen.append(case["name"])
    assert seen == list(EXPECTED_HASHES)


def test_constants_match_ts_source() -> None:
    text = (
        Path(__file__).resolve().parents[2]
        / "enterprise"
        / "packages"
        / "core-api"
        / "src"
        / "managed-agents.ts"
    ).read_text(encoding="utf-8")
    assert PROTOCOL_VERSION in text
    assert MANIFEST_SCHEMA in text
    for value in (*PAT_SCOPES, *CLIENT_EVENT_TYPES, *SERVER_EVENT_TYPES):
        assert value in text
    for item in ALL_ERROR_CODES:
        assert f"{item.code}: {item.http_status}" in text
