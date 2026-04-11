---
name: cc-bridge-auto-token-and-a-b-reliability
overview: 实现 CC Bridge 首次启动自动生成并落盘本机 token，并补齐 Machi 在方式 A（bash_exec+claude）与方式 B（cc_bridge）两条链路的可执行与可验收闭环。
todos:
  - id: bridge-auto-token
    content: 实现 cc_bridge token 首次自动生成并写入本机配置，保持 env > config 优先级
    status: completed
  - id: cc-bridge-http-path
    content: 接入 ensure token 到 cc_bridge HTTP 调用链路并细化错误提示
    status: completed
  - id: desktop-cc-bridge-gui
    content: 新增 Desktop CC Bridge 设置项与 IPC/类型声明
    status: completed
  - id: bash-exec-cd-chain
    content: 支持 cd &&/; command 在 bash_exec 中自动转 cwd+后续执行
    status: completed
  - id: ab-template-update
    content: 补充方式 A/B 的简短执行模板与验收提示文案
    status: completed
  - id: tests-and-smoke
    content: 补充/更新单测与冒烟验证，覆盖 A/B 成功路径和关键失败路径
    status: completed
isProject: false
---

# CC Bridge 自动 Token 与 A/B 流程可靠性改造计划

## 目标与验收
- 目标1：首次使用 CC Bridge 时，无需手动配 token；本机自动生成随机 token，写入 `~/.agenticx/config.yaml`（`cc_bridge.token`），仅本机可见。
- 目标2：方式 A（`bash_exec` 直调 `claude`）可稳定执行，不再因 `cd` 拦截/多行引号导致“看似执行、实则未跑”。
- 目标3：方式 B（`cc_bridge_start/send`）在默认本机场景下可直接跑通（bridge 启动、session 创建、消息发送、落盘验证）。
- 验收：提供一组最小端到端自测脚本，覆盖 A/B 成功路径与关键失败提示（权限、rate limit、文件未落盘）。

## 现状约束（基于代码）
- Bridge 客户端取 token 仅支持环境变量/配置读取，不会自动生成：`agenticx/cc_bridge/settings.py`。
- `cc_bridge_*` 工具在 token 为空时直接失败：`agenticx/cli/agent_tools.py`。
- 方式 A 常见失败是 `bash_exec` 中写 `cd && ...`，被 `cd` 保护分支短路；且缺少“文件存在”硬验证。
- Desktop 尚无 CC Bridge 可视化设置入口（当前只见 tools/feishu 等设置 IPC）。

## 实施步骤

### 1) Bridge token 自动生成与本机持久化
- 在 `agenticx/cc_bridge/settings.py` 增加“ensure token”逻辑（仅本机配置）：
  - 当 `AGX_CC_BRIDGE_TOKEN` 与 `cc_bridge.token` 都为空时，生成高熵随机 token（例如 `secrets.token_urlsafe(32)`）。
  - 通过 `ConfigManager.set_value("cc_bridge.token", token, scope="global")` 持久化。
  - 返回 token 给调用方；默认不打印明文到用户对话。
- 保持优先级：环境变量 > 配置文件（兼容现有行为）。

### 2) cc_bridge 工具链路无感接入自动 token
- 在 `agenticx/cli/agent_tools.py` 的 bridge HTTP 调用路径上，改为调用新的“ensure token”接口，避免首次调用直接报 missing token。
- 保留错误场景：bridge 进程未启动、URL 非 loopback、鉴权不匹配时仍给出明确错误。
- 优化报错文本，区分：
  - token 自动生成成功但 bridge 端 token 不一致；
  - bridge 未启动；
  - URL/网络限制。

### 3) Desktop 设置增加 CC Bridge 区域（满足可改配置项 GUI）
- 在 `desktop/src/components/SettingsPanel.tsx` 增加 CC Bridge 设置分区：
  - `Bridge URL`（默认 `http://127.0.0.1:9742`）
  - `Token`（默认隐藏，支持显示/复制）
  - `自动生成本机 token` 开关或“重置并重新生成”按钮
- 新增/扩展 IPC：
  - `desktop/electron/main.ts`：`get-cc-bridge-config` / `save-cc-bridge-config` / `regen-cc-bridge-token`
  - `desktop/electron/preload.ts` 与 `desktop/src/global.d.ts`：类型声明同步
- 后端复用现有 ConfigManager 存取（通过 Studio API 或 Electron 直连方案二选一，保持与现有设置架构一致）。

### 4) 方式 A（不用 bridge）执行可靠性优化
- 在 `agenticx/cli/agent_tools.py` 的 `_tool_bash_exec` 增强：
  - 当命令命中 `cd ... && ...` 或 `cd ...; ...` 模式时，不直接返回“cd 不持久化”，而是：
    - 解析 `cd` 目标为 `cwd`，
    - 自动执行后续命令（并保留路径安全校验）。
  - 若用户仅 `cd` 不带后续命令，维持现有提示。
- 增加“结果验收建议”辅助文案：针对 `claude -p` 类命令，提示追加 `test -f`/`wc` 验证落盘（不强制改写命令）。

### 5) A/B 用例与提示词模板优化
- 在系统提示/工具说明中新增简短模板：
  - A：要求 `cwd` 参数、禁止 `cd &&`、结束后必须文件存在验证。
  - B：先 `cc_bridge_start` 拿 `session_id`，再 `cc_bridge_send`，最后验证产物路径。
- 文案位置：
  - `agenticx/cli/agent_tools.py` 中 `bash_exec` 与 `cc_bridge_*` description；
  - 必要时补到 docs（如 `docs/cc-bridge-protocol.md` 的“快速开始”）。

### 6) 测试与回归
- Python 单测：
  - `tests/test_cc_bridge_settings.py`：覆盖首次自动生成、读取优先级、持久化成功。
  - `tests/test_cc_bridge_http.py` / `tests/test_cc_bridge_protocol.py`：覆盖 token 存在但不匹配、未启动、正常调用。
- `bash_exec` 单测（新增）：
  - `cd && command` 自动转换执行；
  - 路径越权拦截仍有效；
  - 仅 `cd` 保持提示。
- Desktop 类型检查与关键 UI 冒烟（SettingsPanel 新增项）。

## 风险与回滚
- 风险：自动生成 token 若无显式展示，用户排障时不易感知。
  - 处理：设置页可见/可复制 token，且错误提示带“本机 token 来源”说明。
- 风险：`cd &&` 自动改写可能引入误判。
  - 处理：仅支持明确前缀 `cd <path> &&|; <cmd>` 的受控分支，其余走原逻辑。
- 回滚：按模块可独立回退（settings 逻辑、bash_exec 解析、Desktop UI IPC）。