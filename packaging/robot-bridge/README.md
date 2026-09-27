# agx-robot-bridge

本机机器人策略桥接服务：在独立 Python 3.12 环境里托管一个策略 rollout 会话（加载策略、连接机器人、运行 / 改任务 / 复位 / 停止、相机快照），通过仅监听本机的 HTTP 接口供 AgenticX 调用。实时控制环完全在本进程内运行，AgenticX 只下发任务级指令，从不下发关节动作。

- `--backend fake`：纯 Python 模拟后端，不需要 torch 和硬件，用于测试与联调。
- `--backend lerobot`：真实后端，包装 LeRobot 的 `RolloutController`（需安装 `lerobot` extra）。

## 安装

```bash
uv venv --python 3.12 ~/.agenticx/robot-bridge-venv
source ~/.agenticx/robot-bridge-venv/bin/activate
uv pip install -e 'packaging/robot-bridge[test]'            # 仅 fake 后端
uv pip install -e 'packaging/robot-bridge[lerobot,test]'    # 真实机器人
```

bridge 不依赖 AgenticX 主包，AgenticX 主环境也不需要安装 lerobot / torch。

## 运行

```bash
agx-robot-bridge serve --backend fake          # 默认 127.0.0.1:8766
agx-robot-bridge serve --backend lerobot --port 8766
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--host` | `127.0.0.1` | 只接受 `127.0.0.1` / `localhost` / `::1`，其他地址直接退出（退出码 2） |
| `--port` | `8766` | |
| `--backend` | `lerobot` | `lerobot` 或 `fake` |
| `--token-file` | `~/.agenticx/robot_bridge.token` | 不存在或为空时自动生成，权限 0600 |
| `--snapshot-dir` | `~/.agenticx/robot/snapshots` | 快照 PNG 落盘目录 |

日志同时写 stderr 与 `~/.agenticx/logs/robot_bridge/bridge.log`（含访问日志，不含 token）。

进程启动时会把 `input()` 替换为立即报错、并把 stdin 指向 `/dev/null`：任何库代码请求交互输入（典型是未标定机器人的标定提示）都会让会话以 `stdin_input_blocked` 失败，而不是卡住或吞掉输入。标定必须事先在终端用 `lerobot-calibrate` 完成。

收到 SIGTERM / Ctrl+C 时，bridge 会先停止当前会话（停推理、回位、校验位姿、断开硬件）再退出；托管该进程时 kill 宽限应 ≥ 15 秒。

## HTTP 接口

所有接口（含 `/health`）都要求 `Authorization: Bearer <token>`。错误统一返回 `{"ok": false, "error_code", "error", "hint"}`。同一时间只允许一个占用硬件的会话。

| Method | Path | 说明 |
|---|---|---|
| GET | `/health` | 版本、后端名、Python 与 lerobot 版本 |
| POST | `/session` | 创建会话并后台加载，返回 202 与 `session_id`；`robot.max_relative_target` 必填 |
| GET | `/session/{sid}?since=<seq>` | 状态、事件（`seq > since`）、`pose_check`、错误信息 |
| POST | `/session/{sid}/start` | 开始一段运行（仅 `idle`） |
| POST | `/session/{sid}/task` | `{"task": "..."}`，改任务，下一次推理生效 |
| POST | `/session/{sid}/reset` | 停止当前动作、回到初始位姿、恢复初始任务；约 0.5 秒后给出回位校验 |
| POST | `/session/{sid}/stop` | 任何状态可调、幂等；加载中调用返回 202 `stopping` |
| GET | `/session/{sid}/snapshot?camera=<name>` | PNG（宽度 ≤ 640）的 base64 与落盘路径 |

会话状态：`loading` → `idle` ⇄ `running` / `resetting`，失败为 `failed`，停止过程为 `stopping` → `stopped`。

## 测试

```bash
cd packaging/robot-bridge
python -m pytest tests -q -k "not lerobot_backend_sim"
```

包内自带 pytest 配置，不会读取仓库根目录的配置；测试不需要 torch、lerobot 或硬件。
