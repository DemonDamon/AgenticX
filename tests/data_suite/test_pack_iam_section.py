"""IAM section loads without network."""
from __future__ import annotations

from pathlib import Path

from agenticx.data_suite.pack import load_pack, register_pack
from agenticx.data_suite.store.file_store import DictionaryFileStore

PACK = Path(__file__).resolve().parents[2] / "examples" / "data_suite" / "delivery_pack"


def test_iam_stub_recorded(tmp_path: Path) -> None:
    pack = load_pack(PACK)
    assert "iam" in pack.sections or (PACK / "iam" / "strategy.yaml").is_file()
    report = register_pack(pack, dictionary_store=DictionaryFileStore(root=tmp_path))
    assert report.iam_strategy_id == "brand_a_oidc_stub"
