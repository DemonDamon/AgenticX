from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import yaml

from agenticx.data_suite.channels.fake import FakeChannel
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.governance.dictionary import FieldDef
from agenticx.data_suite.idmapping.profile import IdMapProfile, load_profile
from agenticx.data_suite.pack.loader import load_pack
from agenticx.data_suite.pack.manifest import LoadedPack, PackError
from agenticx.data_suite.store.file_store import BoardFileStore, DictionaryFileStore
from agenticx.data_suite.tags.catalog import TagCatalog, TagDef


@dataclass
class RegisterReport:
    pack_id: str
    channels: List[str] = field(default_factory=list)
    dictionary_fields: int = 0
    boards: List[str] = field(default_factory=list)
    tags: int = 0
    idmapping_profile: Optional[str] = None
    iam_strategy_id: Optional[str] = None
    quality_rules: int = 0
    audiences: int = 0

    def as_dict(self) -> Dict[str, Any]:
        return {
            "pack_id": self.pack_id,
            "channels": list(self.channels),
            "dictionary_fields": self.dictionary_fields,
            "boards": list(self.boards),
            "tags": self.tags,
            "idmapping_profile": self.idmapping_profile,
            "iam_strategy_id": self.iam_strategy_id,
            "quality_rules": self.quality_rules,
            "audiences": self.audiences,
        }


def _channels_payload(section: Any) -> Dict[str, Any]:
    if not isinstance(section, dict):
        return {}
    if "channels" in section and isinstance(section["channels"], dict):
        return section["channels"]
    # loader may nest file stem
    if "channels" in section and isinstance(section["channels"], dict) is False:
        inner = section.get("channels")
        if isinstance(inner, dict) and "channels" in inner:
            return inner["channels"]
    # merged multi-file: {channels: {channels: {...}}} already handled
    # direct mapping of channel name -> cfg
    if all(isinstance(v, dict) for v in section.values()):
        # likely already name->cfg (src/dst)
        if any(k in section for k in ("src", "dst")):
            return section
    nested = section.get("channels")
    if isinstance(nested, dict):
        return nested
    return {}


def _register_channels(
    pack: LoadedPack,
    registry: ChannelRegistry,
    report: RegisterReport,
) -> None:
    section = pack.sections.get("channels")
    if section is None:
        return
    # Prefer raw file if present for seed_inline fidelity
    ch_file = pack.root / (pack.manifest.channels or "channels") / "channels.yaml"
    raw: Dict[str, Any]
    if ch_file.is_file():
        loaded = yaml.safe_load(ch_file.read_text(encoding="utf-8")) or {}
        raw = loaded.get("channels") or {}
    else:
        raw = _channels_payload(section)
    if not isinstance(raw, dict):
        raise PackError("channels section must be a mapping of channel name -> config")

    for name, cfg in raw.items():
        if not isinstance(cfg, dict):
            continue
        kind = str(cfg.get("kind") or "fake").lower()
        if kind != "fake":
            raise PackError(f"skeleton register only supports kind=fake for now (got {kind})")
        table = str(cfg.get("table") or name)
        rows = list(cfg.get("seed_inline") or [])
        grant_id = cfg.get("grant_id")
        grants = None
        if grant_id:
            grants = WriteGrantStore(grants={str(grant_id): {"channel": name, "table": table}})
        registry.register(FakeChannel(name=str(name), tables={table: [dict(r) for r in rows]}, grants=grants))
        report.channels.append(str(name))


def _register_idmapping(pack: LoadedPack, report: RegisterReport) -> Optional[IdMapProfile]:
    section = pack.sections.get("idmapping")
    if section is None:
        return None
    path = pack.root / (pack.manifest.idmapping or "idmapping") / "profile.yaml"
    if path.is_file():
        profile = load_profile(path)
        report.idmapping_profile = profile.name
        return profile
    # section may already be the profile mapping
    if isinstance(section, dict) and section.get("name"):
        # write temp via load_profile shape: reuse YAML dump
        tmp = pack.root / ".runtime_profile.yaml"
        tmp.write_text(yaml.safe_dump(section, allow_unicode=True), encoding="utf-8")
        try:
            profile = load_profile(tmp)
        finally:
            tmp.unlink(missing_ok=True)
        report.idmapping_profile = profile.name
        return profile
    nested = section.get("profile") if isinstance(section, dict) else None
    if isinstance(nested, dict):
        tmp = pack.root / ".runtime_profile.yaml"
        tmp.write_text(yaml.safe_dump(nested, allow_unicode=True), encoding="utf-8")
        try:
            profile = load_profile(tmp)
        finally:
            tmp.unlink(missing_ok=True)
        report.idmapping_profile = profile.name
        return profile
    return None


def _register_dictionary(
    pack: LoadedPack,
    store: DictionaryFileStore,
    report: RegisterReport,
) -> None:
    section = pack.sections.get("dictionary")
    if section is None:
        return
    fields = []
    if isinstance(section, dict):
        if isinstance(section.get("fields"), list):
            fields = section["fields"]
        elif isinstance(section.get("fields"), dict) is False and "fields" in section:
            fields = section.get("fields") or []
        else:
            # multi-file merge: {fields: {...}} from fields.yaml stem
            nested = section.get("fields")
            if isinstance(nested, dict) and isinstance(nested.get("fields"), list):
                fields = nested["fields"]
    path = pack.root / (pack.manifest.dictionary or "dictionary") / "fields.yaml"
    if path.is_file():
        fields = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("fields") or fields
    for row in fields:
        if not isinstance(row, dict) or not row.get("name"):
            continue
        store.upsert_field(
            FieldDef(
                name=str(row["name"]),
                business_def=str(row.get("business_def") or ""),
                calc_logic=str(row.get("calc_logic") or ""),
                update_freq=str(row.get("update_freq") or ""),
                owner=str(row.get("owner") or ""),
            )
        )
        report.dictionary_fields += 1


def _register_boards(
    pack: LoadedPack,
    store: BoardFileStore,
    report: RegisterReport,
) -> None:
    boards_dir = pack.root / (pack.manifest.boards or "boards")
    files: List[Path] = []
    if boards_dir.is_dir():
        files = sorted(p for p in boards_dir.iterdir() if p.suffix.lower() in {".yaml", ".yml"})
    for path in files:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(data, dict) or not data.get("id"):
            continue
        stored = store.upsert_board(data)
        report.boards.append(str(stored["id"]))


def _register_tags(pack: LoadedPack, catalog: TagCatalog, report: RegisterReport) -> None:
    path = pack.root / (pack.manifest.tags or "tags") / "catalog.yaml"
    if path.is_file():
        catalog.load(path)
        report.tags = len(list(catalog.list_tags())) if hasattr(catalog, "list_tags") else len(getattr(catalog, "_tags", {}))
        return
    section = pack.sections.get("tags")
    if not isinstance(section, dict):
        return
    rows = []
    if isinstance(section.get("tags"), list):
        rows = section["tags"]
    elif isinstance(section.get("catalog"), dict):
        rows = section["catalog"].get("tags") or []
    for row in rows:
        if not isinstance(row, dict) or not row.get("name"):
            continue
        td = TagDef(
            name=str(row["name"]),
            layer=str(row.get("layer") or ""),
            business_def=str(row.get("business_def") or ""),
            calc_logic=str(row.get("calc_logic") or ""),
            update_freq=str(row.get("update_freq") or ""),
            owner=str(row.get("owner") or ""),
            meaning_key=str(row.get("meaning_key") or "default"),
        )
        catalog._tags[(td.name, td.meaning_key)] = td  # noqa: SLF001 — pack apply bootstrap
        report.tags += 1


def _count_quality(pack: LoadedPack, report: RegisterReport) -> None:
    path = pack.root / (pack.manifest.quality or "quality") / "rules.yaml"
    if path.is_file():
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        report.quality_rules = len(data.get("rules") or [])
        return
    section = pack.sections.get("quality")
    if isinstance(section, dict):
        rules = section.get("rules")
        if isinstance(rules, list):
            report.quality_rules = len(rules)
        elif isinstance(section.get("rules"), dict) is False and isinstance(section.get("rules"), list):
            report.quality_rules = len(section["rules"])
        else:
            nested = section.get("rules")
            if isinstance(nested, dict):
                report.quality_rules = len(nested.get("rules") or [])


def _count_audiences(pack: LoadedPack, report: RegisterReport) -> None:
    path = pack.root / (pack.manifest.tags or "tags") / "audience.yaml"
    if path.is_file():
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        report.audiences = len(data.get("audiences") or [])


def _register_iam(pack: LoadedPack, report: RegisterReport) -> None:
    path = pack.root / (pack.manifest.iam or "iam") / "strategy.yaml"
    if not path.is_file():
        return
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    strategy = data.get("strategy") if isinstance(data, dict) else None
    if isinstance(strategy, dict) and strategy.get("id"):
        report.iam_strategy_id = str(strategy["id"])


def register_pack(
    pack: Union[LoadedPack, Path, str],
    *,
    registry: Optional[ChannelRegistry] = None,
    dictionary_store: Optional[DictionaryFileStore] = None,
    board_store: Optional[BoardFileStore] = None,
    tag_catalog: Optional[TagCatalog] = None,
) -> RegisterReport:
    """Apply a loaded (or on-disk) delivery pack into A-layer registries/stores."""
    loaded = pack if isinstance(pack, LoadedPack) else load_pack(pack)
    registry = registry or ChannelRegistry()
    dictionary_store = dictionary_store or DictionaryFileStore()
    board_store = board_store or BoardFileStore(root=dictionary_store.root)
    tag_catalog = tag_catalog or TagCatalog()

    report = RegisterReport(pack_id=loaded.manifest.id)
    _register_channels(loaded, registry, report)
    _register_idmapping(loaded, report)
    _register_dictionary(loaded, dictionary_store, report)
    _register_boards(loaded, board_store, report)
    _register_tags(loaded, tag_catalog, report)
    _count_quality(loaded, report)
    _count_audiences(loaded, report)
    _register_iam(loaded, report)
    return report
