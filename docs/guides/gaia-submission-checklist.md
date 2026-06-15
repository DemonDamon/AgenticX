# GAIA 提交前检查清单

用于提交 GAIA 成绩前的快速核对，避免格式或流程问题导致提交失败。

## A. 数据与运行配置

- [ ] 本次使用的数据 split 已确认（dev / test）
- [ ] 数据文件路径已记录（便于复现）
- [ ] 本次模型与参数已记录（temperature、timeout、并发等）
- [ ] 是否允许工具调用已明确并记录

## B. 运行结果文件完整性

目标目录（示例：`artifacts/gaia/run1`）内应包含：

- [ ] `results.jsonl`（逐题明细）
- [ ] `submission.jsonl`（用于提交）
- [ ] `manifest.json`（运行元信息）

## C. 提交文件 schema 校验

执行：

```bash
python scripts/run_gaia_benchmark.py \
  --validate-only \
  --output-dir artifacts/gaia/run1
```

通过标准：

- [ ] 返回 `Submission valid`
- [ ] 无 `duplicate task_id`
- [ ] 所有行包含 `task_id`、`model_answer`

## D. 内容质量抽检（建议至少 10 条）

- [ ] `model_answer` 非空
- [ ] `FINAL ANSWER:` 归一化提取符合预期
- [ ] 数值题未带不必要单位（除题目明确要求）
- [ ] 列表题输出格式符合题目要求（逗号分隔等）

## E. 可复现性核查

- [ ] `manifest.json` 中记录了 commit、参数、时间戳
- [ ] 本次运行命令已保存在变更记录或实验日志
- [ ] 若用 `--resume`，确认未漏跑目标任务

## F. 提交执行

- [ ] 上传文件为 `submission.jsonl`（不是 `results.jsonl`）
- [ ] 上传后保存提交回执（截图/链接）
- [ ] 记录本次提交标识与对应本地目录

## G. 常见失败与快速修复

- **invalid JSON line**
  - 文件被手工编辑破坏；重新导出 `submission.jsonl`
- **task_id 重复**
  - 检查 `results.jsonl` 合并逻辑；必要时 `--force-rerun`
- **model_answer 类型错误**
  - 保证导出时写入字符串（当前导出器已处理）

---

建议把每次正式提交都留档：`run目录 + 提交时间 + 模型配置 + leaderboard 回执`。
