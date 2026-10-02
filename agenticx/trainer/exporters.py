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
