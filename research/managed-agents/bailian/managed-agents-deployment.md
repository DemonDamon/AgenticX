---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-deployment
fetched: 2026-10-23
title: 定时任务
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 定时任务

> 定时任务（Scheduled Task）绑定一个智能体并配置触发方式，定时或手动触发运行，适合每日汇总、定期巡检等无人值守任务。

<meta property="og:title" content="定时任务" />

## 概念 <span id="h-dp-concept" />

定时任务（Scheduled Task，API 与 CLI 中的资源名为 Deployment）绑定一个智能体并配置触发方式：定时触发按 cron 表达式自动执行，手动触发在点击「运行」时执行。每次触发创建一个会话，向智能体发送创建时固定的初始消息，执行过程与结果记录为一条运行记录（Run）。

控制台侧边栏的「部署」页即定时任务的管理入口；API 与 CLI 中的资源名仍为 Deployment。

适合无人值守的周期性任务：每日数据汇总、定期巡检、按小时同步。需要多轮交互的任务参见[委派任务给 Agent](managed-agents-session.md)。

## 创建定时任务 <span id="h-dp-create" />

在控制台[「部署」](https://bailian.console.aliyun.com/managed-agent/deployment)页面点击**创建**，在弹窗中配置：

| **配置项**  | **说明**                       |
| -------- | ---------------------------- |
| 名称       | 任务名称，最长 256 字符               |
| 描述（可选）   | 用途说明                         |
| 智能体      | 选择要运行的智能体                    |
| 环境（可选）   | 选择运行环境                       |
| 环境变量（可选） | 注入会话运行时                      |
| 密钥（可选）   | 绑定密钥库，供 MCP 服务和技能引用          |
| 初始消息     | 每次触发时作为初始用户消息发送给智能体，1 到 50 条 |
| 文件（可选）   | 挂载到任务运行的会话中                  |
| 元数据（可选）  | 自定义 key-value                |
| 触发器      | 手动触发或定时调度                    |

定时调度配置，控制台实时预览未来 5 次运行时间：

| **配置项**  | **说明**                                        |
| -------- | --------------------------------------------- |
| 频率       | 每小时、每天、工作日、每周、每月，或自定义 Cron                    |
| Cron 表达式 | 标准五位（分 时 日 月 周）；`*` 任意，`*/5` 每 5 个单位，`1-5` 范围 |
| 时区       | 表达式对应的执行时区，例如 `(GMT+08:00) Asia/Shanghai`     |

通过 API 创建，返回 `depl_` 前缀的 ID。`agent.version` 锁定智能体版本，不传则使用最新版本。完整参数与响应字段详见[创建 Deployment API](api/deployment-create.md)。

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/deployments" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "每日订单汇总",
      "agent": {
        "id": "agent_xxx",
        "version": 12
      },
      "environment_id": "env_xxx",
      "schedule": {
        "type": "cron",
        "expression": "0 9 * * 1-5",
        "timezone": "Asia/Shanghai"
      },
      "initial_events": [
        {
          "type": "message",
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": "汇总昨日订单数据"
            }
          ]
        }
      ]
    }'
  ```
</CodeGroup>

更新任务时 `schedule` 传 `null` 清除定时触发，改回手动。详见[更新 Deployment API](api/deployment-update.md)。

## 运行与运行记录 <span id="h-dp-run" />

手动任务在控制台列表或详情页点击**运行**触发，或调用[触发 Deployment Run API](api/deployment-run.md)；定时任务按表达式自动触发。每次触发产生一条运行记录，在任务详情页的**运行历史**查看，字段包含：

- **运行 ID**：单次执行的标识，`drun_` 前缀。
- **触发来源**：`manual` 或 `scheduled`。
- **状态**：`running`、`succeeded`、`failed`。
- **会话**：本次运行创建的会话 ID，可按会话方式查询事件历史与输出。
- **开始 / 结束时间**。

完整字段与分页参数详见[列出 Deployment Runs API](api/deployment-list-runs.md)、[获取 Deployment Run API](api/deployment-get-run.md)。

## 暂停与归档 <span id="h-dp-lifecycle" />

- **暂停**：停止定时触发，保留配置；恢复后继续按原表达式执行。详见[暂停](api/deployment-pause.md)、[恢复](api/deployment-unpause.md)。
- **归档**：归档后不可触发，操作幂等。详见[归档 Deployment API](api/deployment-archive.md)。

## 使用 CLI <span id="h-dp-cli" />

| **操作**          | **命令**                                                |
| --------------- | ----------------------------------------------------- |
| 创建定时任务（可配置定时执行） | `bl managed-agent deployment create`                  |
| 立即触发运行          | `bl managed-agent deployment run`                     |
| 暂停 / 恢复         | `bl managed-agent deployment pause` / `unpause`       |
| 查看任务            | `bl managed-agent deployment list` / `get` / `search` |
| 查看运行记录          | `bl managed-agent deployment runs list` / `runs get`  |

更多命令参见 [Managed Agent 命令参考](managed-agents-cli.md)。

## 下一步 <span id="h-dp-next" />

- [委派任务给 Agent](managed-agents-session.md)：多轮交互的任务改用会话。
- [Deployment API](api/deployment-api.md)：定时任务与运行记录的完整接口。
- [Webhook 通知](managed-agents-webhook.md)：订阅定时任务与运行的状态变更事件。
