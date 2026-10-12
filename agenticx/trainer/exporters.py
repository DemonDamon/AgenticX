# agenticx/trainer/exporters.py
"""LLaMA-Factory sharegpt 导出 + 数据集 card（溯源记录）。"""
from __future__ import annotations

import json
from pathlib import Path

def export_llama_factory(samples: list[dict], out_dir: Path, name: str) -> Path:
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    data_file = out_dir / f"{name}.jsonl"
    with open(data_file, "w") as f:
        for s in samples:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")
    info_path = out_dir / "dataset_info.json"
    info = {}
    if info_path.exists():
        info = json.load(open(info_path))
    info[name] = {"file_name": data_file.name, "formatting": "sharegpt",
                  "columns": {"messages": "conversations"}}
    json.dump(info, open(info_path, "w"), ensure_ascii=False, indent=2)
    return data_file

def write_card(out_dir: Path, *, name: str, kind: str, n_samples: int,
               tasks: list[str], heldout: list[str], scrub_hits: int,
               seed: str = "v1") -> Path:
    card = Path(out_dir) / f"{name}.card.md"
    card.write_text(f"""# Dataset Card: {name}

- 类型: {kind}
- 样本数: {n_samples}
- 任务覆盖: {len(tasks)} 个（train 侧）
- held-out 隔离: {len(heldout)} 个任务被物理排除（seed={seed}）: {', '.join(heldout) or '无'}
- 脱敏命中: {scrub_hits} 处替换
- 来源: AgenticX RSI 数据飞轮（harbor-tb40 轨迹，verifier 标注）
- 生成时间: {__import__('datetime').datetime.now().isoformat(timespec='seconds')}
""", encoding="utf-8")
    return card


MANIFEST_SCHEMA_VERSION = "agx-lora-manifest/1"


def write_lora_manifest(out_dir: Path, *, alias: str, base_model: str,
                        adapter_uri: str, dataset_refs: list[str],
                        heldout: list[str], skill_tags: list[str] | None = None,
                        trajectory_count: int = 0,
                        attribution_ledger: str = "",
                        lora_config: dict | None = None) -> Path:
    """LoRA manifest 信封（SP30 T6）：P1 训练产物的空契约。

    heldout 清单强制必填（空 = 拒绝写）——训练守卫在数据侧已做，manifest 是
    第二道红线；adapter_uri 允许占位路径，status 恒为 planned（无真实权重）。
    """
    if not heldout:
        raise ValueError("manifest 必须记录 heldout 清单（空清单=拒绝，"
                         "不允许无隔离产物流通）")
    if not dataset_refs:
        raise ValueError("manifest 必须记录 dataset_refs（训练数据溯源）")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "alias": alias,
        "status": "planned",                     # 空信封：真实权重属 P1
        "compose": "base+adapter",
        "base_model": base_model,
        "adapter_uri": adapter_uri,
        "skill_tags": list(skill_tags or []),
        "lora_config": dict(lora_config or {}),  # rank/alpha 由 P1 训练时补
        "heldout": list(heldout),                # 顶层红线字段：隔离清单一眼可见
        "lineage": {
            "dataset_refs": list(dataset_refs),
            "trajectory_count": trajectory_count,
            "heldout": list(heldout),
            "attribution_ledger": attribution_ledger,
        },
        "created_at": __import__("datetime").datetime.now().isoformat(
            timespec="seconds"),
    }
    path = out_dir / f"{alias}.lora-manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                    encoding="utf-8")
    return path
