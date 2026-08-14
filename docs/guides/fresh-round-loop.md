# 上下文复位循环（fresh_round_loop）

用于会把**单个会话窗口**撑爆的超长任务：每一轮启动一个全新的子智能体，不继承父会话对话历史，只传稳定目标、工作目录，以及上一轮的有界交接报告。工作目录是唯一事实来源。

## 适用场景

- 大规模重构、批量审计、需要几十轮工具调用才能收口的目标
- 同一会话已经或即将撞上 `max_tool_rounds` / 上下文窗口上限

不适合：普通多步任务、跨任务编排、定时轮询。那些仍走 `longrun` 与 `project_state`。

## 与 longrun / project_state 的分工

| 能力 | 解决什么 | 不解决什么 |
|------|----------|------------|
| `fresh_round_loop` | 同一目标下的**对话窗口复位** | 跨任务调度、特性状态机 |
| `longrun` | 任务源轮询、工作区隔离、停滞续跑 | 把同一 transcript 无限拉长 |
| `project_state` | 特性级 implement / verify / commit | 单轮对话的上下文膨胀 |

三者互补，本工具不是默认长任务路径。

## 如何开启

默认关闭。开启方式（二选一）：

```bash
export AGX_FRESH_ROUND_LOOP=1
```

或在 `~/.agenticx/config.yaml`：

```yaml
runtime:
  fresh_round_loop: true
```

关闭后工具不会出现在会话可用工具表里；若被强行调用，返回 `{"ok": false, "error": "disabled"}`。

## 交接报告契约

子智能体必须在回复中给出可解析 JSON：

```json
{
  "status": "continue|complete|blocked",
  "summary": "...",
  "evidence": ["..."],
  "next_steps": ["..."],
  "blocker": "..."
}
```

序列化后超过 8000 字符会被拒绝并要求该轮重发一次精简版；仍超长则整段循环以 `blocked` 结束，不会静默截断。

## 成本提示

每一轮都会启动一个子智能体。默认最多 16 轮，硬上限 32 轮。只在目标确实需要窗口复位时使用。
