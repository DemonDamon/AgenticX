"""Managed Agents protocol (MA-00).

Author: Damon Li


Python is the source of truth for constants, manifest validation, and event models.
"""

from agenticx.managed.errors import MAError
from agenticx.managed.manifest import (
    AgentManifest,
    ManifestResult,
    canonical_json,
    manifest_hash,
    normalize_manifest,
    validate_manifest,
)
from agenticx.managed.protocol import (
    MANIFEST_SCHEMA,
    PROTOCOL_VERSION,
    event_to_wire,
    export_json_schemas,
    parse_client_events,
    parse_server_event,
)

__all__ = [
    "PROTOCOL_VERSION",
    "MANIFEST_SCHEMA",
    "parse_client_events",
    "parse_server_event",
    "event_to_wire",
    "export_json_schemas",
    "validate_manifest",
    "normalize_manifest",
    "manifest_hash",
    "canonical_json",
    "ManifestResult",
    "AgentManifest",
    "MAError",
]
