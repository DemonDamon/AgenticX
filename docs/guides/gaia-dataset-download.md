# GAIA 数据集下载指南

本文档说明如何准备 GAIA 评测所需数据，并与 `scripts/run_gaia_benchmark.py` 对接。

## 1. 先决定下载范围

- **仅调试流程（推荐起步）**：只拿 metadata（轻量）
- **完整评测**：metadata + 附件（图片/PDF/音视频等）

建议先从小样本开始，确认流程跑通后再拉全量。

## 2. 数据字段要求

脚本最小要求（每条任务）：

- `task_id`
- `Question`

可选字段（建议保留）：

- `Level`
- `Final answer`（本地对比/调试时有用）
- `file_name`
- `file_path`
- `Annotator Metadata`

## 3. 推荐下载来源

- GAIA dataset: [https://huggingface.co/datasets/gaia-benchmark/GAIA](https://huggingface.co/datasets/gaia-benchmark/GAIA)

> 说明：GAIA 数据组织可能随版本变化（jsonl/parquet），建议先确认当前版本结构，再选取你要的 split（如 dev/test）。

## 4. 本地目录建议

建议在仓库外或 `data/gaia/` 下组织，例如：

```text
data/gaia/
  metadata.jsonl
  attachments/
```

如 `file_path` 为相对路径，运行脚本时可通过 `--dataset-root` 指向该目录。

## 5. 下载后先做快速检查

最少检查三件事：

1. 能否读取到 `task_id`、`Question`
2. `task_id` 是否唯一
3. 有附件的样本，`file_path` 是否可定位

## 6. 评测命令示例

### 6.1 小样本冒烟

```bash
python scripts/run_gaia_benchmark.py \
  --dataset-path /absolute/path/to/metadata.jsonl \
  --output-dir artifacts/gaia/smoke \
  --benchmark-name gaia_smoke \
  --limit 20 \
  --export-submission
```

### 6.2 使用相对附件路径

```bash
python scripts/run_gaia_benchmark.py \
  --dataset-path /absolute/path/to/metadata.jsonl \
  --dataset-root /absolute/path/to/data/gaia \
  --output-dir artifacts/gaia/run1 \
  --benchmark-name gaia_run1 \
  --export-submission
```

## 7. 常见问题

- **No valid GAIA tasks loaded**
  - 输入文件格式不对，或缺少 `task_id` / `Question`
- **duplicate task_id**
  - 原始数据里有重复 ID，需先去重
- **附件读取失败**
  - 检查 `file_path` 与 `--dataset-root` 的拼接结果

## 8. 下一步

数据准备完成后，继续参考：

- `docs/guides/gaia-benchmark.md`
- `docs/guides/gaia-submission-checklist.md`
