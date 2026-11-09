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

`lerobot` extra 固定到上游一个 git 修订（见 `pyproject.toml`）：`RolloutController` 尚未进入任何已发布版本。`serve --backend lerobot` 启动时会检查该接口，缺失则打印原因并以退出码 2 退出。

### 模拟机器人（无硬件联调）

`sim/lerobot_robot_agx_sim` 是一个模拟 SO-101 从臂插件（机器人类型 `agx_sim_so101`），关节与相机特征（6 个 `<joint>.pos`，`front` / `handeye` 480×640）与 SO-101 的 ACT 策略一致，可直接跑真实策略：

```bash
uv pip install -e packaging/robot-bridge/sim/lerobot_robot_agx_sim   # 装进已含 lerobot extra 的同一环境
```

插件本身不声明 lerobot 依赖，避免覆盖上面固定的修订。`robot.extra` 可传 `{"calibrated": false}` 模拟未标定机器人、`{"camera_names": [...]}` 改相机集合。

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
| POST | `/session` | 创建会话并后台加载，返回 202 与 `session_id`；`robot.max_relative_target` 必填，见下文 |
| GET | `/session/{sid}?since=<seq>` | 状态、事件（`seq > since`）、`pose_check`、错误信息 |
| POST | `/session/{sid}/start` | 开始一段运行（仅 `idle`） |
| POST | `/session/{sid}/task` | `{"task": "..."}`，改任务，下一次推理生效 |
| POST | `/session/{sid}/reset` | 停止当前动作、回到初始位姿、恢复初始任务；约 0.5 秒后给出回位校验 |
| POST | `/session/{sid}/stop` | 任何状态可调、幂等；加载中调用返回 202 `stopping` |
| GET | `/session/{sid}/snapshot?camera=<name>` | PNG（宽度 ≤ 640）的 base64 与落盘路径 |

会话状态：`loading` → `idle` ⇄ `running` / `resetting`，失败为 `failed`，停止过程为 `stopping` → `stopped`。

### 创建会话（`POST /session`）

```json
{
  "robot": {"type": "so101_follower", "port": "/dev/tty.usbmodem1", "id": "arm1",
            "max_relative_target": 10.0, "cameras": {}, "extra": {}},
  "policy_path": "/path/to/pretrained_model",
  "task": "pick up the cube",
  "fps": 30, "duration_s": 0, "device": "cpu", "home_tolerance": 5.0, "offline_backbone": true
}
```

- `robot.extra` 透传其余机器人配置项（如 `{"use_degrees": true}`），值为对象 / 数组时按 JSON 传入；不能用它覆盖 `type` / `port` / `id` / `cameras` / `max_relative_target`。
- `offline_backbone`（默认 `true`）：跳过视觉骨干的 ImageNet 初始化权重下载，训练好的权重仍从 checkpoint 加载，离线环境可用。
- 加载前会先以不标定方式连一次机器人：未标定直接失败为 `calibration_required`，`hint` 给出对应的 `lerobot-calibrate` 命令；加载过程中任何一步失败都会断开已连接的机器人。
- `stop` 与 `reset` 之后的回位都会读回关节位姿并与初始位姿比较（`pose_check`），误差超过 `home_tolerance`（单位与关节读数一致）即 `verified: false`。
- CPU 推理时控制环常低于目标 fps，日志里的 "Control loop is running slower" 告警属预期。

## 测试

```bash
cd packaging/robot-bridge
python -m pytest tests -q
```

包内自带 pytest 配置，不会读取仓库根目录的配置。未安装 lerobot 时真实后端用例自动跳过，其余测试不需要 torch 或硬件。

真实后端集成用例（真实策略 + 模拟机器人，需要 `lerobot` extra 与模拟插件）：

```bash
AGX_ROBOT_BRIDGE_POLICY_PATH=/path/to/act_so101_checkpoint AGX_ROBOT_BRIDGE_DEVICE=cpu \
  python -m pytest tests/test_lerobot_backend_sim.py -v
```
