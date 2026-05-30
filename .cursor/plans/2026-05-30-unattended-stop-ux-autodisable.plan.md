# 无人值守判停文案口语化 + 判停后自动关闭

## 背景 / 问题

用户反馈某个从未手动发言的会话出现以下现象（截图证据）：

- 反复出现 `⛔ 无人值守已停止：达到 max_wall_clock_hours=6.0`
- 文案里直接暴露程序变量名 `max_wall_clock_hours`，非技术用户无法理解
- 判停后无人值守开关并未真正关闭，导致重开/重启会话被反复重新打开并立刻再次判停（累计多条相同提示）

### 根因

1. `agenticx/studio/supervisor.py` 的 `_fail_session` 直接把内部变量名拼进用户可见消息。
2. 墙钟起算时间 `__supervisor_started_at__` 在「禁用无人值守」时未被清除：旧会话被判停（禁用）后，桌面端 `agx-session-unattended-v1` 仍记着「开」，重开会话会再 PUT `enabled:true`，而起算时间仍是旧值（早已超 6 小时）→ 监工下一轮立即再次判停。
3. 桌面端 `ChatPane.tsx` 重进会话时无条件把本地记录的无人值守状态重新推给后端，且后端判停后不会反向清掉本地开关。

## 需求

- FR-1：无人值守判停的用户可见文案不得出现 `max_wall_clock_hours` / `max_continuations_per_session` 等变量名，改为口语化中文；机器可读标识保留在 `metadata`。
- FR-2：无人值守一旦判停，后端 + 桌面端开关都必须真正置为「关」，不得重开会话又被自动打开后再次判停。
- FR-3：墙钟时长上限应从「无人值守被启用的时刻」起算；禁用时清除起算时间，使下次手动重新启用是一个全新的计时窗口。
- AC-1：旧会话开启无人值守不再「一进来就秒判停」；判停后顶栏显示「本会话无人值守：关」，且不再持续追加相同 ⛔ 提示。
- AC-2：判停消息读起来是自然语言，例如「⛔ 无人值守已停止：已连续运行约 6 小时，达到自动运行时长上限」。

## 改动点

### 后端 `agenticx/studio/supervisor.py`
- `set_session_unattended_enabled`：`enabled=False` 时 `pop` 掉 `SCRATCH_SUPERVISOR_STARTED_KEY`（FR-3）。
- `_tick`：墙钟/续跑次数判停的 `reason` 改为口语化文案，并向 `_fail_session` 传机器码 `code`（FR-1）。
- `_fail_session`：新增可选 `code`，写入 `metadata.limit_code`，`content` 用口语化 `reason`（FR-1）。

### 桌面端 `desktop/src/components/ChatPane.tsx`
- 新增 `detectTrailingUnattendedStop(messages)`：若会话尾部（最后一条 user 之后）存在「无人值守已停止」标记，返回该消息 id。
- 新增 `unattendedAutoStopAckRef` 防止与用户手动重新开启相互打架。
- 重进会话 sync effect：检测到尾部判停标记且未 ack 时，不再 PUT `enabled:true`。
- 新增 reactive effect：发现新的尾部判停标记 → 清掉 `agx-session-unattended-v1` 对应项、`setSessionUnattended(false)`、并 PUT `enabled:false` 反向同步后端（FR-2）。
- `toggleSessionUnattended`：手动开启时 ack 当前尾部判停标记，避免被 reactive effect 立刻关掉。

## 验证
- `desktop` typecheck + build 绿。
- 手动：旧会话开无人值守，确认不再秒判停；判停后顶栏开关变「关」，重开会话不再自动续跑/不再追加重复 ⛔。
