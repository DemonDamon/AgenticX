"""SP30 T6：LoRA manifest 信封——P1 训练产物的空契约。"""
import json

import pytest

from agenticx.trainer.exporters import write_lora_manifest


def test_manifest_requires_heldout_and_records_lineage(tmp_path):
    with pytest.raises(ValueError, match="heldout"):
        write_lora_manifest(tmp_path, alias="a", base_model="b",
                            adapter_uri="u", skill_tags=[],
                            dataset_refs=["tb40-sft-v1"], heldout=[])
    p = write_lora_manifest(tmp_path, alias="a", base_model="b",
                            adapter_uri="u", skill_tags=["finance"],
                            dataset_refs=["tb40-sft-v1"],
                            heldout=["task-eval-1"], trajectory_count=120)
    m = json.loads(p.read_text(encoding="utf-8"))
    assert m["schema_version"] == "agx-lora-manifest/1"
    assert m["compose"] == "base+adapter" and m["heldout"] == ["task-eval-1"]
    assert m["status"] == "planned"          # 空信封：无真实权重
    assert m["lineage"]["dataset_refs"] == ["tb40-sft-v1"]
    assert m["lineage"]["trajectory_count"] == 120
    assert m["lora_config"] == {}            # rank/alpha 等由 P1 训练时补


def test_manifest_rejects_empty_dataset_refs(tmp_path):
    with pytest.raises(ValueError, match="dataset"):
        write_lora_manifest(tmp_path, alias="a", base_model="b",
                            adapter_uri="u", skill_tags=[],
                            dataset_refs=[], heldout=["e1"])
