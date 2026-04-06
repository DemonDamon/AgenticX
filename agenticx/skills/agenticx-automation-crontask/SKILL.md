---
name: agenticx-automation-crontask
description: Build and maintain Machi Desktop scheduled (cron) tasks — default workspace ~/.agenticx/crontask, schedule_task tool, execution contract, and user-facing output. Use when the user wants recurring automation, crontab-style jobs, or to author/fix automation task prompts.
metadata:
  author: AgenticX
  version: "0.1.2"
---

# AgenticX 定时任务（Crontask）

## 任务根目录（工程约定，与 Desktop / `schedule_task` 一致）

| 用户在自动化里是否填写「工作区」 | 任务根目录 |
|----------------------------------|------------|
| **填写了** | 用户给定目录（Desktop 会 `mkdir`） |
| **留空** | `~/.agenticx/crontask/<task_id>/`（**每个定时任务独占一个子目录**，与 `automation:<task_id>` 对话一一对应） |

- **Python venv**：一律在任务根下 **`<任务根>/.venv`**，用 `<任务根>/.venv/bin/pip` / `python`；不要把定时任务专属依赖装到仓库 `.venv` 或任意路径，除非该路径就是用户指定的任务根。
- **脚本、数据、日志、临时文件、辅助工具**：**全部**放在任务根或其子目录内；不要在 `~/.agenticx/scripts`、仓库根等散落（除非用户显式把其中某路径设为任务根）。

## Meta-Agent：调用 `schedule_task` 之前（运行环境）

定时任务**以后**在 **automation 专属会话**里执行，不会在当时的 Machi 对话里自动装包。在调用 `schedule_task` **之前**应代用户准备好任务根下的环境：

1. 先拿到 **任务根**：用户指定的 `workspace`，或创建任务后默认的 `~/.agenticx/crontask/<task_id>/`（`schedule_task` 返回的 `task_id` 可用于路径）。
2. 在任务根下 **`python3 -m venv .venv`**（若尚无），**`.venv/bin/pip install …`**。
3. **`bash_exec` 用 `<任务根>/.venv/bin/python` 试跑脚本**，确认无 import 错误。
4. `instruction` 里的命令必须与 **同一解释器路径** 一致。

## 默认工作区（摘要）

- 未指定 `workspace` 时，Desktop 与 `schedule_task` 均写入 **`~/.agenticx/crontask/<task_id>`** 并创建目录。
- 删除任务时，UI 会**二次确认**是否同时删除该目录下的本地文件（仅针对上述 crontask 子目录，不随意删除用户任意路径）。

## 用 `schedule_task` 创建任务（对话 / Meta-Agent）

在 `instruction`（提示词）里写清：

1. **何时跑**：已在工具参数里用 `frequency_type` / `time` / `days` 表达；提示词内可再写一句业务语义（如「交易日 9:28」）便于人读。
2. **怎么跑**：必须要求 **真实执行**（如 `bash_exec` + `python3`），禁止「只给代码不运行」。
3. **输出格式**：给出**严格版式**（标题、字段、单位），并写明「最终回复只允许该版式，禁止工具 JSON」。
4. **失败**：简短错误（接口/库/网络），不超过若干行，不要教程、不要反问。
5. **依赖**：写明 `pip install` 包名；执行环境以本机为准。

可选参数 `workspace`：仅当用户明确要求固定目录时填写；否则留空使用默认 crontask 目录。

## 任务执行时（automation 会话）

会话 `avatar_id` 为 `automation:<task_id>` 时，后端会注入执行器系统提示，强调：

- 先工具执行、再按用户版式输出；
- 不在最终回复粘贴 `schedule_task` 等原始 JSON；
- 失败简短说明。

编写或审阅提示词时，应与此行为一致。

## 验收清单

- [ ] 提示词是否要求**实际跑命令**并得到数据？
- [ ] 是否定义了**唯一允许的输出模板**？
- [ ] 是否说明**非交易日 / 无数据**时的单行或短输出？
- [ ] 是否需要**默认 crontask 路径**下的脚本文件（便于复跑与排障）？
