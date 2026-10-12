# 机器人策略会话 — 用户指南

> Plan-Id: `robot-policy-bridge`
> Plan-File: [`.cursor/plans/2026-09-27-robot-policy-bridge.plan.md`](../../.cursor/plans/2026-09-27-robot-policy-bridge.plan.md)
> 开发者文档（安装、测试、HTTP 接口）：[`packaging/robot-bridge/README.md`](../../packaging/robot-bridge/README.md)

在 Near 桌面端和 Machi（元智能体）对话，就能让一台本机机器人运行训练好的策略：启动、改子任务、复位、继续、停止、查状态、看相机快照。

## 分工：Machi 是导演，策略是演员

- **策略（演员）**：在独立进程 `agx-robot-bridge` 里以约 30Hz 的实时控制环驱动机器人，读相机、推理、下发关节目标。
- **Machi（导演）**：只做任务级决策——交给策略什么任务、看快照判断做没做好、要不要复位或停止。Machi **从不**下发关节动作或速度。

```
Near / Machi ──HTTP（仅 127.0.0.1 + token）──▶ agx-robot-bridge ──▶ 机器人 / 相机
```

机器人工具只在 **Machi 主会话**里可用；分身、群聊、定时任务、子智能体、`loop` 模式都不提供。

---

## 1. 准备 bridge 环境

bridge 用独立的 Python 3.12 环境，AgenticX 主环境不需要安装策略运行时。在仓库根目录执行：

```bash
uv venv --python 3.12 ~/.agenticx/robot-bridge-venv
source ~/.agenticx/robot-bridge-venv/bin/activate
uv pip install -e 'packaging/robot-bridge[lerobot]'
```

`lerobot` extra 固定到上游的一个 git 修订，因为 bridge 依赖的 rollout 控制接口还没进入任何已发布版本。`agx-robot-bridge serve` 启动时会检查该接口，缺失就打印原因并退出（退出码 2）。

## 2. 先人工标定机器人（必须）

bridge 运行时**不接受任何交互输入**。未标定的机器人不会被自动标定，会话会直接失败并返回 `calibration_required`，提示里给出对应的标定命令。请先在终端（同一个 bridge 环境里）完成标定：

```bash
lerobot-find-port        # 找到机器人串口，例如 /dev/tty.usbmodem5A460829821
lerobot-calibrate --robot.type=so101_follower \
  --robot.port=/dev/tty.usbmodem5A460829821 --robot.id=my_follower
```

`--robot.id` 要与下文 profile 里的 `id` 一致，标定文件按它查找。

## 3. 启动 bridge

```bash
agx-robot-bridge serve                    # 真实机器人，默认 127.0.0.1:8766
agx-robot-bridge serve --backend fake     # 无硬件的模拟后端
```

- 首次启动会生成 token 文件 `~/.agenticx/robot_bridge.token`（权限 0600），AgenticX 自动读取，不需要手抄。不要把它发给别人。
- bridge 只监听本机地址，`--host` 填其他地址会直接退出。
- 日志：`~/.agenticx/logs/robot_bridge/bridge.log`。

## 4. 配置 `~/.agenticx/config.yaml`

默认关闭。最小配置是打开开关并添加一个机器人别名（profile）：

```yaml
robot:
  enabled: true
  profiles:
    so101_desk:
      type: so101_follower               # 必填，机器人类型
      port: /dev/tty.usbmodem5A460829821
      id: my_follower                    # 与标定时的 --robot.id 一致
      policy_path: /path/to/pretrained_model   # 可选，默认策略
```

完整字段（均可省略，括号内为默认值）：

| 字段 | 说明 |
|---|---|
| `bridge_url`（`http://127.0.0.1:8766`） | bridge 地址 |
| `token` / `token_file`（空 / `~/.agenticx/robot_bridge.token`） | `token` 非空时直接使用，否则读 `token_file` |
| `default_max_relative_target`（`10.0`） | 单步限幅，profile 未写 `max_relative_target` 时使用；设为 `null` 则每个 profile 必须自带 |
| `confirm_each_task`（`true`） | 改任务、复位是否逐次确认；启动与继续**始终**确认 |
| `load_timeout_s`（`300`） | 等待策略加载的上限，首次加载慢时调大 |
| `stop_timeout_s`（`30`） | 等待停止完成的上限 |
| `home_tolerance`（`5.0`） | 回位校验容差，单位与关节读数一致 |
| `offline_backbone`（`true`） | 跳过视觉骨干初始化权重的联网下载，见"离线使用" |

profile 还可写 `max_relative_target`（覆盖默认限幅）、`cameras`（相机配置，原样透传）、`extra`（其余机器人配置项，如 `{"use_degrees": true}`）。

配置每条消息都会重新读取，改完后发下一条消息即生效，不需要重启 Near。

## 5. 在对话里使用

对 Machi 说，例如：

> 用 so101_desk 启动策略，任务是把红色方块放进盒子里。

Machi 会先弹出确认框，写明机器人、策略、任务和单步限幅，批准后机器人才会开始运动。之后可以让它"看一下现在的画面""换成把蓝色方块放进去""复位""继续""停下来"。

- 看快照需要当前模型支持图片输入，否则会提示 `robot_vision_unavailable`。
- 机器人工具默认按需加载，一轮对话里第一次用到时可能多一轮往返，属正常现象。
- 若策略不读取语言指令，改任务不会改变机器人动作，Machi 会如实告知。

### 无硬件体验

- **最快**：`agx-robot-bridge serve --backend fake`，profile 的 `type` 随意填（如 `fake_arm`），`policy_path` 填任意路径。模拟后端不需要策略运行时和硬件，适合走通对话与确认流程。
- **跑真实策略**：在 bridge 环境里再装模拟机器人插件，profile 的 `type` 用 `agx_sim_so101`，用 `agx-robot-bridge serve`（真实后端）启动。插件模拟 6 个关节和 `front` / `handeye` 两路 480×640 相机，策略的输入特征须与之一致。

  ```bash
  uv pip install -e packaging/robot-bridge/sim/lerobot_robot_agx_sim
  ```

---

## 安全须知

- **确认不可豁免**：启动、继续、改任务、复位的确认不受"全部自动执行"、工具白名单、无人值守放行等设置影响；无人值守时这类操作直接被拒绝。
- **`robot_stop` 不是物理急停**：它免确认、随时可调，会停止推理、让机器人回到初始位姿并断开连接，但依赖软件与通信正常。操作时急停按钮必须在手边。
- **回位校验**：停止和复位后会读回关节位姿，与初始位姿比较。结果为 `verified: false` 时，请人工检查机器人姿态再继续。
- **托管 bridge 进程**：bridge 收到终止信号时会先停止会话、回位、断开硬件再退出，用进程管理工具托管时 kill 宽限时间应不少于 15 秒。
- 同一时间只允许一个会话占用硬件。

## 离线使用

- `offline_backbone: true`（默认）时，加载策略不会为视觉骨干联网下载初始化权重，训练好的权重仍从策略目录读取。
- `policy_path` 用本地目录；填模型仓库 id 时首次加载需要联网下载。

## 排障

| 返回 | 含义与处理 |
|---|---|
| `bridge_unreachable` | 连不上 bridge：在 bridge 环境运行 `agx-robot-bridge serve`，并核对 `robot.bridge_url` |
| `token_missing` | 找不到 token 文件：先启动一次 bridge 生成；自定义过 `--token-file` 时同步改 `robot.token_file` |
| `calibration_required` | 机器人未标定：在终端执行提示里给出的标定命令 |
| `stdin_input_blocked` | 策略运行时请求了交互输入（通常是标定），处理同上 |
| `robot_unknown_profile` | 别名不存在：检查 `robot.profiles`，profile 缺 `type` 会被忽略 |
| `robot_policy_required` | 没有策略：对话里给出策略路径，或在 profile 写 `policy_path` |
| `max_relative_target_required` | 没有单步限幅：在 profile 或 `robot.default_max_relative_target` 设置 |
| `robot_load_timeout` | 加载超时，会话已停止：首次加载较慢时调大 `robot.load_timeout_s` |
| `robot_not_idle` | 只有已复位或一段运行结束（idle）的会话能继续；失败或已停止的会话需重新启动 |

更多信息看 `~/.agenticx/logs/robot_bridge/bridge.log`。
