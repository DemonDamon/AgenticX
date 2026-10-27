---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/deployment-api
fetched: 2026-10-23
title: Deployment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Deployment

> 部署（Deployment）API 提供部署的创建、查询、更新、归档，以及执行触发、暂停/恢复与执行记录查询操作。部署绑定 Agent 并配置触发方式，支持定时触发与手动触发。

<meta property="og:title" content="Deployment" />

## 概述 <span id="h-deployment-overview" />

Deployment 绑定一个 Agent 并配置触发方式：不传 `schedule` 为手动触发，传入 `cron` 表达式为定时触发。部署的状态（`status`）为 `active` 或 `paused`，是否已归档由 `archived_at` 时间戳表示：暂停停止定时触发但保留配置，归档后不可触发。每次触发产生一个 Deployment Run，记录执行来源、关联会话与状态。

## Deployment 操作 <span id="h-deployment-ops" />

| **操作**                                               | **端点**                                      | **说明**                        |
| ---------------------------------------------------- | ------------------------------------------- | ----------------------------- |
| [创建 Deployment](deployment-create.md)  | `POST /deployments`                         | 创建部署，绑定 Agent 并配置触发方式         |
| [获取 Deployment](deployment-get.md)     | `GET /deployments/{deployment_id}`          | 根据 ID 获取单个 Deployment 的详细信息   |
| [列出 Deployment](deployment-list.md)    | `GET /deployments`                          | 分页查询，支持按 Agent、状态、关键词、创建时间筛选  |
| [更新 Deployment](deployment-update.md)  | `POST /deployments/{deployment_id}`         | 更新配置；`schedule` 传 null 清除定时触发 |
| [归档 Deployment](deployment-archive.md) | `POST /deployments/{deployment_id}/archive` | 归档部署，操作幂等                     |
| [触发 Deployment Run](deployment-run.md) | `POST /deployments/{deployment_id}/run`     | 手动触发一次执行                      |
| [暂停 Deployment](deployment-pause.md)   | `POST /deployments/{deployment_id}/pause`   | 暂停，停止定时触发                     |
| [恢复 Deployment](deployment-unpause.md) | `POST /deployments/{deployment_id}/unpause` | 将已暂停的 Deployment 恢复为活跃状态      |

## Deployment Run 操作 <span id="h-deployment-run-ops" />

| **操作**                                                      | **端点**                                     | **说明**                  |
| ----------------------------------------------------------- | ------------------------------------------ | ----------------------- |
| [获取 Deployment Run](deployment-get-run.md)    | `GET /deployment_runs/{deployment_run_id}` | 获取单次执行记录的详情             |
| [列出 Deployment Runs](deployment-list-runs.md) | `GET /deployments/{deployment_id}/runs`    | 分页列出指定 Deployment 的执行记录 |
