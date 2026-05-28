---
name: session-switch-latency-profile
overview: 在切换历史会话链路（前端点击 → IPC → 后端 get_messages）三段上加埋点，用户复盘日志后再决定 A/B/C/D 优化方向，避免猜测。
todos:
  - id: frontend-timing
    content: SessionHistoryPanel.switchSession 打印 ipc/map/total 三段
    status: completed
  - id: ipc-timing
    content: Electron main load-session-messages handler 打印 fetch/parse/total
    status: completed
  - id: backend-timing
    content: SessionManager.get_messages 区分 memory/disk 来源，打印 load/normalize/total
    status: completed
isProject: false
---

# Near 切换会话延迟 profile 埋点

## 背景

用户反馈：在历史侧栏点击老 session 后，顶栏 sessionId 已变但消息区仍是上一会话，体感「卡了很久才切过来」。在没有真实耗时分布前不动业务逻辑，先 profile。

## 埋点位置

| 链路段 | 文件 | 日志前缀 |
| --- | --- | --- |
| 前端点击 → setPaneMessages | `desktop/src/components/SessionHistoryPanel.tsx` | `[session-switch]` |
| Electron IPC fetch + JSON parse | `desktop/electron/main.ts` (`load-session-messages`) | `[ipc:load-session-messages]` |
| 后端 get_messages 内 load + normalize | `agenticx/studio/session_manager.py` | `[get-messages]` |

## 验证方式

1. `npm run dev` 启 Near，打开 DevTools Console；后端日志在终端 `agx serve`。
2. 点击若干 session（含老、消息多、带附件的），观察三段时间分布：
   - `total - ipc ≈ map + setState`：前端瓶颈
   - `ipc - backend total ≈ fetch + JSON parse`：IPC / 网络栈瓶颈
   - `backend total = load + normalize`：磁盘 IO vs CPU normalize 占比
3. 根据数据决定走 A（即时清空+skeleton）/ B（store LRU）/ C（后端 LRU + mtime 失效）/ D（hover prefetch）。

## 回收

确认优化方案落地后，把三处 `PROFILE:` 注释段删除。
