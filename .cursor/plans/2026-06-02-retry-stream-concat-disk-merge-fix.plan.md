# 重试流式「拼接」/ 重入「缺失·误判中断」— 磁盘对账根治

Plan-Id: 2026-06-02-retry-stream-concat-disk-merge-fix

## 现象（同一根因的两张脸）
1. 拼接：重试流式期，新回复「拼上」旧大模型回复（含旧推荐问，第 3 条带 MiniMax 脏 token `]<]minimax[>[`）；切走再回来（已输出完毕）后正常。
2. 缺失·误判中断：会话显示回复消失且标「已中断」，关闭重启后完整回复又出现；历史面板仍挂「已中断」。

## 根因
内存 `pane.messages` 与磁盘 `messages.json` 分叉，且唯一的实时对账器无法自愈：
- 磁盘消息 id 按下标生成 `${sid}-i${index}`；内存实时提交消息 id 为随机 `uid()`。
- `mergeSessionMessagesTail` 纯按 id「只追加」→ 同内容重复 append（拼接）或无法纠正截断后的内存。
- 会话重入仅在 `execution_state === "running"` 时对账；后台跑完重入为 `idle` 时无拉回路径。
- 启动时 `scan_interrupted_sessions` 把磁盘 meta 为 `running` 的会话**无条件**标 `interrupted`，不检查最后一轮是否已有 assistant 回复。
- MiniMax 特殊 token 泄漏进 `<followups>` 推荐问行。

## 需求与实现
- **FR-A 拼接**：`mergeTailFromDisk` 前台 SSE 活跃时 bail；`mergeSessionMessagesTail` 按 `(role + content)` 去重。
- **FR-B 缺失自愈**：`reconcileDisplayedSessionFromDisk` 在会话重入且非 running 时全量对账。
- **FR-C 中断徽标**：`scan_interrupted_sessions` 有完成回复 → 标 `idle`；`_normalize_execution_state_for_listing` 对已有完成回复的 `interrupted` 归一为 `idle`。
- **FR-D MiniMax 脏 token**：`followup_stream.strip_model_control_artifacts` 清洗 followup 行与正文。

## 改动文件
- `desktop/src/utils/session-message-merge.ts` + `.test.ts`
- `desktop/src/components/ChatPane.tsx`
- `agenticx/studio/session_manager.py`
- `agenticx/runtime/followup_stream.py`
- `tests/test_followup_stream.py`
- `tests/test_session_manager_persistence.py`（新增 scan/list 用例）

## 验收
- AC-1：uid 行 + 磁盘同内容下标行 → 合并不重复
- AC-2：内存缺尾部 → 重入对账补全
- AC-3：running+完成回复 → 启动 scan 不标 interrupted；list 不显示已中断
- AC-4：followup 行去掉 `]<]minimax[>[`
- AC-5：desktop vitest + pytest 相关用例绿
