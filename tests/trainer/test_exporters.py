# tests/trainer/test_exporters.py
import json
from pathlib import Path
from agenticx.trainer.exporters import export_llama_factory, write_card

def test_export_writes_jsonl_and_registry(tmp_path):
    samples = [{"conversations": [{"from": "human", "value": "q"},
                                  {"from": "gpt", "value": "a"}],
                "meta": {"task_id": "t1"}}]
    export_llama_factory(samples, tmp_path, "tb40-sft-v1")
    data_file = tmp_path / "tb40-sft-v1.jsonl"
    assert json.loads(data_file.read_text().strip())["conversations"][0]["from"] == "human"
    info = json.load(open(tmp_path / "dataset_info.json"))
    assert info["tb40-sft-v1"]["formatting"] == "sharegpt"

def test_export_is_idempotent_registry(tmp_path):
    export_llama_factory([], tmp_path, "ds-a")
    export_llama_factory([], tmp_path, "ds-b")
    info = json.load(open(tmp_path / "dataset_info.json"))
    assert set(info) == {"ds-a", "ds-b"}

def test_card_records_provenance(tmp_path):
    card = write_card(tmp_path, name="tb40-sft-v1", kind="sft",
                      n_samples=10, tasks=["t1", "t2"],
                      heldout=["t9"], scrub_hits=3)
    text = (tmp_path / "tb40-sft-v1.card.md").read_text()
    assert "样本数: 10" in text and "t9" in text and "3" in text
