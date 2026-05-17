# Machi 全局 MCP Hub + 启动态恢复（消除「新 session 触发重连」）

- **Plan-Id**: `2026-05-06-machi-global-mcp-hub-and-restore`
- **创建时间**: 2026-05-06
- **作者**: Damon Li
- **状态**: Draft（待用户确认范围后开工）
- **关联现状代码**:
  - `agenticx/cli/studio.py::StudioSession`（持有 `mcp_hub` / `connected_servers` / `mcp_configs`）
  - `agenticx/studio/server.py`（`/api/session`、`/api/sessions` 在创建后调 `auto_connect_servers_async`）
  - `agenticx/studio/session_manager.py::_close_mcp_hub_sync`（删 session 时 `hub.close()` → kill 子进程）
  - `agenticx/cli/studio_mcp.py::auto_connect_servers_async / mcp_connect_async / mcp_disconnect_async`
  - `agenticx/runtime/meta_tools.py::_list_mcps_payload`（依赖 `session.mcp_hub` / `session.connected_servers`）
  - `agenticx/cli/agent_tools.py::dispatch_tool_async`（`mcp_call` / `list_mcps` / `mcp_connect` 走 `session.mcp_hub`）
- **关联已有 plan**:
  - [`2025-03-26-mcp-desktop-settings-paths-autoconnect.plan.md`](./2025-03-26-mcp-desktop-settings-paths-autoconnect.plan.md)（沿用其 `mcp.auto_connect` 持久化点）

---

## 1. 背景与问题

当前 MCP 接线状态被绑定在每个 `StudioSession` 上：

- 每次新建 session（首次 `/api/session` 或新话题 `/api/sessions`）都会
  `MCPHub(clients=[])` + `auto_connect_servers_async(...)`，**重新拉起一组 MCP 子进程**。
- session 删除时 `_close_mcp_hub_sync` 直接 `hub.close()`，**kill 该 session 名下所有 MCP 子进程**。
- 仓库里**没有任何「上次 connected 名单」的运行时状态文件**；
  只有 `~/.agenticx/config.yaml` 的 `mcp.auto_connect` 这一份**用户配置层**的「白名单」，
  当前被滥用为「每次新 session 都按它重连一遍」。

因此用户实际看到的现象：

> 上一会话刚用过 `chrome-devtools`，新建 session 后 `list_mcps` 显示未连接。
> 而 `chrome-devtools` 又不在默认 `auto_connect` 列里，所以新 session 也不会替你重连。

**正确语义应当是：**

> MCP 是 Machi **进程级**资源。Machi 启动时按「上次退出前 connected 过的服务名单」一次性
> 后台恢复连接。**新建 session 不再触发任何 MCP 连接行为**，所有 session 共享同一份全局
> Hub 与 `connected_servers` 集合；用户在任意 session 里 `mcp_connect` / `mcp_disconnect`
> 都直接落到全局 Hub 与持久化文件，重启后再被恢复。

## 2. Out of scope（明确不做）

- **不**在本 plan 内重构 `MCPHub` / `MCPClientV2` 内部 stdio/SDK 协议层；只调用方/生命周期层做调整。
- **不**实现「跨多个 Machi 实例共享 MCP 子进程」（一个 Machi 一份全局 Hub 即可）。
- **不**改 Desktop 设置面板的视觉语义（仅在文案与状态展示上做最小贴合，避免误导）。
- **不**改 `agx serve` 的远程模式行为（远程 `agx serve` 自己也按本 plan 跑全局 Hub；客户端透明）。
- **不**改群聊 / 子智能体（`AgentTeamManager`）取 MCP 工具的链路语义；保持 `dispatch_tool_async` 入口不变。

---

## 3. 目标与不变量

### 3.1 目标

```text
G-1  Machi 进程内仅维护**一份**全局 MCP Hub 与 connected_servers / mcp_configs。
G-2  Machi 启动时按持久化「上次 connected 名单」做一次后台恢复连接；
     名单内服务连成功 → 仍标 connected；连失败 → 标失败原因，仍允许后续手动重连。
G-3  新建 session（/api/session、/api/sessions）**不再**触发任何 MCP 连接动作。
G-4  delete session、切 avatar、关 pane 都**不再** kill 任何 MCP 子进程。
G-5  list_mcps / mcp_connect / mcp_disconnect / mcp_call 全部读写**全局 Hub**；
     已存在的 session 字段保留为对全局 Hub 的 read-through view，便于过渡。
G-6  用户主动 mcp_connect / mcp_disconnect 后，名单立即写回 ~/.agenticx/config.yaml 的
     mcp.auto_connect（已有 append_/remove_mcp_auto_connect_name 钩子，沿用）。
G-7  Machi 进程退出时，统一 close 全局 Hub 与所有子进程。
```

### 3.2 不变量

```text
INV-1  对 Meta-Agent / 子智能体 / 群聊路由层的 list_mcps / mcp_call 调用签名零改动。
INV-2  `mcp.auto_connect` 配置语义仅扩展不破坏：仍接受 list[str] / "all" / "none"；
       新增「自动维持上次 connected 名单」为默认语义（即 list 中的项 = 启动时要恢复的）。
INV-3  Desktop SettingsPanel 现有 MCP Tab 的 API 调用形态（GET /api/mcp/servers、
       POST /api/mcp/connect、POST /api/mcp/disconnect）签名不变，只是返回体里去掉
       session 维度的隔离。
INV-4  对单元测试沿用「per-session MCP」假设的用例，给出明确迁移方案（详见 §6.4）。
```

---

## 4. 拆解（按提交粒度）

### Step 1 · 抽出 GlobalMcpManager 与持久化（无副作用接入）

```text
FR-1.1  新建 agenticx/runtime/global_mcp_manager.py，提供进程级单例：
        - load_or_init() 在 agx serve 启动时调用一次。
        - hub 属性：MCPHub 单例。
        - connected_servers: set[str]，全局共享。
        - mcp_configs: dict[str, MCPServerConfig]，从 load_available_servers() 拉取，
          监听 ~/.agenticx/mcp.json 等路径热更新（沿用 studio_mcp 现有路径解析）。
        - async restore_from_last_session(): 按 mcp.auto_connect 的列表后台恢复连接，
          并发 ≤ 4，单服务 connect 超时沿用 mcp_connect_async 的 connect_timeout。
        - async close_all() / close_one(name) / connect_one(name) / disconnect_one(name)。
        - get_tool_names_by_server() 等只读 helper，供 list_mcps 直接使用。
FR-1.2  新增 agenticx/runtime/global_mcp_state.py（或附在上面文件）维护
        ~/.agenticx/mcp_state.json：仅记录 last_connected: list[str] 与 updated_at；
        重启时优先读它，缺省则回退到 ConfigManager.get_value("mcp.auto_connect")。
FR-1.3  agenticx/cli/studio_mcp.py:append_mcp_auto_connect_name /
        remove_mcp_auto_connect_name 内部增加同步更新 mcp_state.json 的副作用，
        保持「config.auto_connect = 用户白名单 / 上次状态」单一语义。
AC-1.1  pytest -q tests/test_global_mcp_manager.py 通过：
        - init → 只创建 1 个 MCPHub 实例；
        - connect_one("foo") → mcp_state.json 出现 "foo"；
        - disconnect_one("foo") → mcp_state.json 中移除 "foo"。
AC-1.2  pytest -q tests/test_global_mcp_state_restore.py 通过：
        - 模拟 mcp_state.json 中含 ["A","B"]，restore_from_last_session() 完成后
          connected_servers == {"A","B"}（B 模拟连接失败时只保留 A 并抛 warning）。
```

**Files**

- New: `agenticx/runtime/global_mcp_manager.py`
- New: `agenticx/runtime/global_mcp_state.py`
- Modify: `agenticx/cli/studio_mcp.py`（append_/remove_mcp_auto_connect_name 双写状态文件）
- New tests: `tests/test_global_mcp_manager.py`、`tests/test_global_mcp_state_restore.py`

**Commit**

```bash
git add agenticx/runtime/global_mcp_manager.py \
        agenticx/runtime/global_mcp_state.py \
        agenticx/cli/studio_mcp.py \
        tests/test_global_mcp_manager.py \
        tests/test_global_mcp_state_restore.py
git commit -m "$(cat <<'EOF'
feat(runtime/mcp): introduce process-level GlobalMcpManager + last-state restore

## What & Why
为后续把 MCP 接线从 per-session 抽到 per-process 做准备：
- GlobalMcpManager：进程内唯一 MCPHub + connected_servers + mcp_configs。
- mcp_state.json：记录上次 connected 名单，启动时按名单后台恢复连接。
- append_/remove_mcp_auto_connect_name 同步双写，保持单一来源语义。

## Requirements
- FR-1.1 / FR-1.2 / FR-1.3
- AC-1.1 / AC-1.2

Plan-Id: 2026-05-06-machi-global-mcp-hub-and-restore
Plan-File: .cursor/plans/2026-05-06-machi-global-mcp-hub-and-restore.plan.md
Made-with: Damon Li
EOF
)"
```

---

### Step 2 · /api/session 与 /api/sessions 切到全局 Hub（删除 per-session auto_connect）

```text
FR-2.1  agenticx/studio/server.py:create_studio_app() 启动钩子里：
        - 初始化 GlobalMcpManager.singleton()；
        - 调度 manager.restore_from_last_session() 后台任务（不阻塞 server ready）。
FR-2.2  /api/session 创建分支：
        - 删除 mcp_configs / mcp_hub 显式赋值；
        - 删除 _schedule_mcp_autoconnect_for_new_session 调用；
        - 改为把 GlobalMcpManager.hub / connected_servers / mcp_configs 引用挂到
          managed.studio_session 上（read-through view，仍为同一对象）。
FR-2.3  /api/sessions 新建话题分支同上；删除 _schedule_mcp_autoconnect_for_new_session。
FR-2.4  保留旧字段在 StudioSession 上但改为 @property 代理到 GlobalMcpManager，
        避免本提交一次性改动 list_mcps / mcp_call / mcp_connect 等所有调用点。
AC-2.1  curl /api/session 多次创建新 session：观察 ps -ef | grep mcp，
        子进程数量不再线性增长（与首次启动相比 0 增量）。
AC-2.2  curl /api/sessions 新建话题：list_mcps 立刻看到上次 connected 的服务，
        无短暂 connecting 抖动（来自全局 hub 的快照）。
AC-2.3  pytest -q tests/test_session_routes.py 全绿（已有用例不应回归）。
```

**Files**

- Modify: `agenticx/studio/server.py`
- Modify: `agenticx/cli/studio.py`（StudioSession 字段改为 property 代理）
- Modify tests: `tests/test_session_routes.py`（新建 session 后断言 GlobalMcpManager.connected_servers 共享）

**Commit**

```bash
git add agenticx/studio/server.py agenticx/cli/studio.py tests/test_session_routes.py
git commit -m "$(cat <<'EOF'
refactor(studio/session): route MCP through GlobalMcpManager, drop per-session auto-connect

## What & Why
新 session 不再触发任何 MCP 连接 / 子进程；所有 session 共享 GlobalMcpManager 的
hub / connected_servers / mcp_configs。StudioSession 暂保留 @property 代理。

## Requirements
- FR-2.1 / FR-2.2 / FR-2.3 / FR-2.4
- AC-2.1 / AC-2.2 / AC-2.3

Plan-Id: 2026-05-06-machi-global-mcp-hub-and-restore
Plan-File: .cursor/plans/2026-05-06-machi-global-mcp-hub-and-restore.plan.md
Made-with: Damon Li
EOF
)"
```

---

### Step 3 · /api/mcp/connect /disconnect / list_mcps / mcp_call 改为读写全局 Hub

```text
FR-3.1  agenticx/studio/server.py:/api/mcp/connect:
        - 删除 sess.mcp_hub = MCPHub(...) 行；
        - 直接调 GlobalMcpManager.connect_one(name)；
        - 成功后 append_mcp_auto_connect_name(name) 已自动写 mcp_state.json（FR-1.3）。
FR-3.2  /api/mcp/disconnect 同步走 GlobalMcpManager.disconnect_one(name)；
        remove_mcp_auto_connect_name(name) 写回 mcp_state.json。
FR-3.3  agenticx/runtime/meta_tools.py:_list_mcps_payload 改为读 GlobalMcpManager 快照
        而不是 session.mcp_hub / session.connected_servers，降低 reload IO 抖动。
FR-3.4  agenticx/cli/agent_tools.py:dispatch_tool_async 内 mcp_call / list_mcps /
        mcp_connect 路径全部走 GlobalMcpManager（保留 fallback 到 session.mcp_hub
        以兼容旧 caller，但加 deprecation warning）。
FR-3.5  agenticx/cli/studio.py:StudioSession 移除 mcp_hub / connected_servers /
        mcp_configs 真实字段，仅保留 read-only @property 转发；外部赋值直接抛
        DeprecationWarning（防止后续 PR 回退）。
AC-3.1  桌面端 SettingsPanel → MCP Tab 在 session A 中点连接 chrome-devtools，
        切换到 session B 后 list_mcps 立即显示 chrome-devtools 已连接。
AC-3.2  关闭 session A 不再触发 chrome-devtools 子进程退出（ps 验证 PID 仍在）。
AC-3.3  Machi 完整退出 → ps 验证所有 MCP 子进程全部回收。
AC-3.4  pytest -q tests/test_meta_tools.py 全绿（list_mcps 路径）。
```

**Files**

- Modify: `agenticx/studio/server.py`（/api/mcp/connect /disconnect 与 connect_mcp_server）
- Modify: `agenticx/runtime/meta_tools.py`
- Modify: `agenticx/cli/agent_tools.py`
- Modify: `agenticx/cli/studio.py`（字段移除 + property）
- Modify tests: `tests/test_meta_tools.py`

**Commit**

```bash
git add agenticx/studio/server.py agenticx/runtime/meta_tools.py \
        agenticx/cli/agent_tools.py agenticx/cli/studio.py \
        tests/test_meta_tools.py
git commit -m "$(cat <<'EOF'
refactor(mcp): unify list_mcps / mcp_call / connect / disconnect on GlobalMcpManager

## What & Why
所有 MCP 调用统一读写 GlobalMcpManager。session 不再直接持有 MCP 状态；旧字段降级为
read-only property 以保持向后兼容并防止误回退。

## Requirements
- FR-3.1 / FR-3.2 / FR-3.3 / FR-3.4 / FR-3.5
- AC-3.1 / AC-3.2 / AC-3.3 / AC-3.4

Plan-Id: 2026-05-06-machi-global-mcp-hub-and-restore
Plan-File: .cursor/plans/2026-05-06-machi-global-mcp-hub-and-restore.plan.md
Made-with: Damon Li
EOF
)"
```

---

### Step 4 · session_manager 不再 kill MCP；统一在进程退出时回收

```text
FR-4.1  agenticx/studio/session_manager.py:_close_mcp_hub_sync 直接删除（或改为 no-op
        + DeprecationWarning），并删除其在 delete() / cleanup paths 的调用。
FR-4.2  agenticx/studio/server.py:create_studio_app() 注册 FastAPI lifespan/shutdown：
        await GlobalMcpManager.singleton().close_all() —— 唯一的 MCP 子进程回收点。
FR-4.3  桌面端 main.ts:before-quit 已经会 stop agx serve；无需额外改动。
AC-4.1  pytest -q tests/test_session_manager.py 全绿；
        新增用例：delete(session_id) 后 GlobalMcpManager.connected_servers 不变。
AC-4.2  Ctrl+C 关闭 agx serve，5s 内 ps 看不到任何残留 mcp stdio 子进程。
```

**Files**

- Modify: `agenticx/studio/session_manager.py`
- Modify: `agenticx/studio/server.py`（lifespan / shutdown handler）
- Modify tests: `tests/test_session_manager.py`

**Commit**

```bash
git add agenticx/studio/session_manager.py agenticx/studio/server.py \
        tests/test_session_manager.py
git commit -m "$(cat <<'EOF'
refactor(studio/session): stop killing MCP children on session delete; rely on lifespan

## What & Why
MCP 已经是进程级资源；session 生命周期不再决定子进程生命周期。统一在 FastAPI
shutdown 回调里 close 全局 Hub，避免 per-session kill 带来的可见状态抖动。

## Requirements
- FR-4.1 / FR-4.2
- AC-4.1 / AC-4.2

Plan-Id: 2026-05-06-machi-global-mcp-hub-and-restore
Plan-File: .cursor/plans/2026-05-06-machi-global-mcp-hub-and-restore.plan.md
Made-with: Damon Li
EOF
)"
```

---

### Step 5 · Desktop 文案与状态贴合（最小改动）

```text
FR-5.1  desktop/src/components/SettingsPanel.tsx:MCP Tab：
        - 「自动连接」开关下方新增一行说明：
          “该列表 = Machi 启动时要自动恢复的 MCP；新建对话不再触发额外连接。”
        - 删除「连接成功后才允许使用」类暗示 per-session 隔离的旧文案（如有）。
FR-5.2  ChatPane / 模型选择附近的「MCP 状态」chip（如有）显示文案改为
        「全局已连接 N / 总数 M」，与 list_mcps payload 对齐。
FR-5.3  SettingsPanel 不新增 API；仅消费 list_mcps payload 与现有 /api/mcp/* 接口。
AC-5.1  手工：DMG 启动后 list_mcps 立即显示 mcp_state.json 中名单的连接进度；
        新建 session 后无任何「连接中」状态闪烁。
AC-5.2  桌面端在 SettingsPanel 改 mcp.auto_connect 列表时，UI 文案与实际行为一致
        （只影响下次启动恢复，不影响当前 session）。
```

**Files**

- Modify: `desktop/src/components/SettingsPanel.tsx`（MCP Tab 文案区）
- Modify: `desktop/src/components/ChatPane.tsx`（如有 MCP chip 文案）

**Commit**

```bash
git add desktop/src/components/SettingsPanel.tsx desktop/src/components/ChatPane.tsx
git commit -m "$(cat <<'EOF'
fix(desktop/mcp): align UI copy with process-level MCP semantics

## Requirements
- FR-5.1 / FR-5.2 / FR-5.3
- AC-5.1 / AC-5.2

Plan-Id: 2026-05-06-machi-global-mcp-hub-and-restore
Plan-File: .cursor/plans/2026-05-06-machi-global-mcp-hub-and-restore.plan.md
Made-with: Damon Li
EOF
)"
```

---

## 5. 排期建议

| 周 | 内容 | 备注 |
|---|---|---|
| W1 | Step 1 + Step 2 | 新增类 + 切换 session 创建路径，先达成「新 session 不起子进程」的可观测主目标 |
| W2 | Step 3 | 全链路 list_mcps / mcp_call 切到全局；降级 StudioSession 字段为 property |
| W3 | Step 4 + Step 5 | 移除 per-session kill；Desktop 文案贴合，做完后回归 e2e |

每段独立 commit，统一带：

```text
Plan-Id: 2026-05-06-machi-global-mcp-hub-and-restore
Plan-File: .cursor/plans/2026-05-06-machi-global-mcp-hub-and-restore.plan.md
Made-with: Damon Li
```

## 6. 风险与缓解

```text
R-1  原 per-session 隔离在多用户 / 多 agent 并发时是「天然防串扰」假设；
     全局 Hub 后所有 session 共用 MCP，敏感工具（如带写权限的 file MCP）若被
     某 session 误用 → 影响其他 session。
     缓解：本 plan 不改 confirm gate / category policy 路径；危险工具仍走人审。

R-2  user 改 ~/.agenticx/mcp.json 配置后，全局 Hub 的 mcp_configs 需要热更新；
     若热更新滞后，list_mcps 可能短暂展示旧名单。
     缓解：GlobalMcpManager 监听文件 mtime，每次 list_mcps 调用前 short-circuit 重读。

R-3  现有 e2e / unit 测试中可能有 fixture 直接 set session.mcp_hub = MCPHub(...)。
     缓解：Step 3 把 StudioSession 字段降级为 read-only property + DeprecationWarning，
     先发出警告但不抛错；具体在 §6.4 列出预计要更新的测试列表。

R-4  group chat / sub-agent 通过 delegate_to_avatar 在不同 session 间穿透时，原本
     依赖各自 session 的 MCP 状态；现统一后变成共享。
     缓解：实际上之前各 session 的 MCP 状态本就由 auto_connect 决定且大多重复，
     共享后行为与「auto_connect 全部命中」等价；无功能性回归。

R-5  远程模式（remoteConfig）下 GlobalMcpManager 仍只在 agx serve 进程内单例；
     如果用户多客户端同时连一个远程 agx serve，他们看到的是同一份 MCP 状态。
     缓解：本 plan 接受该语义（与「MCP 是 host-process 级资源」一致）；
     文档在 SettingsPanel 远程模式下补一条说明。
```

### 6.4 测试更新清单（Step 3 落地时同步处理）

```text
- tests/test_meta_tools.py
- tests/test_session_routes.py
- tests/test_session_manager.py
- tests/test_studio_*.py 中所有断言 session.mcp_hub / session.connected_servers 的用例
- tests/test_smoke_hermes_agent_*.py 中涉及 mcp_call 的冒烟用例
```

## 7. Definition of Done

- [ ] Step 1 ~ Step 5 全部 commit 落地，每个 commit 带三 trailer。
- [ ] 启动 Machi 后无任何 session 创建动作，`ps -ef | grep mcp` 数量 == mcp_state.json
      中 `last_connected` 名单大小（连接失败的服务允许缺席并在日志告警）。
- [ ] 新建 10 个 session（pro 模式打开 10 个 pane / 群聊）后，
      `ps -ef | grep mcp` 数量 == 上一条相同（不再线性增长）。
- [ ] 在 session A 中 `mcp_connect chrome-devtools`，立即在 session B
      `list_mcps` 看到 connected=true；删除 session A 不影响 chrome-devtools 进程。
- [ ] Machi 退出后 5s 内所有 MCP stdio 子进程被回收（lifespan close）。
- [ ] `pytest -q tests/test_global_mcp_manager.py tests/test_global_mcp_state_restore.py
      tests/test_meta_tools.py tests/test_session_routes.py tests/test_session_manager.py`
      全绿。
- [ ] Desktop SettingsPanel MCP Tab 文案与上文 FR-5.1 一致；
      Manual QA：勾选 / 取消 `mcp.auto_connect` 名单后，重启 Machi 行为符合预期。
