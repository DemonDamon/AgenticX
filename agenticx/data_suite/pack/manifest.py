from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class PackError(ValueError):
    """Invalid or incomplete delivery pack."""


@dataclass(frozen=True)
class PackManifest:
    id: str
    version: str
    display_name: str
    channels: str | None = "channels"
    dictionary: str | None = "dictionary"
    quality: str | None = "quality"
    tags: str | None = "tags"
    boards: str | None = "boards"
    idmapping: str | None = "idmapping"
    iam: str | None = "iam"

    @classmethod
    def from_mapping(cls, data: dict[str, Any]) -> "PackManifest":
        missing = [k for k in ("id", "version", "display_name") if not data.get(k)]
        if missing:
            raise PackError(f"pack.yaml missing required fields: {', '.join(missing)}")
        return cls(
            id=str(data["id"]),
            version=str(data["version"]),
            display_name=str(data["display_name"]),
            channels=data.get("channels", "channels"),
            dictionary=data.get("dictionary", "dictionary"),
            quality=data.get("quality", "quality"),
            tags=data.get("tags", "tags"),
            boards=data.get("boards", "boards"),
            idmapping=data.get("idmapping", "idmapping"),
            iam=data.get("iam", "iam"),
        )


@dataclass
class LoadedPack:
    root: Path
    manifest: PackManifest
    sections: dict[str, Any] = field(default_factory=dict)
