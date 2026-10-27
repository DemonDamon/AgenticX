---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/webhook-api
fetched: 2026-10-23
title: Webhook
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Webhook

> Webhook API 提供 Webhook 端点的创建、查询、更新、删除，以及启用、停用、测试、重置密钥与事件查询操作。Webhook 用于接收 Managed Agents 的事件回调投递。

<meta property="og:title" content="Webhook" />

## 概述 <span id="h-webhook-overview" />

Webhook 端点（Webhook Endpoint）用于接收 Managed Agents 的事件回调投递。创建后即处于启用状态（`status` 为 `ACTIVE`），事件发生时向回调 URL 投递通知。每次投递失败会累计连续失败次数，可通过测试接口验证连通性，或通过重置密钥接口轮换签名密钥。

## Webhook 操作 <span id="h-webhook-ops" />

| **操作**                                         | **端点**                                      | **说明**                       |
| ---------------------------------------------- | ------------------------------------------- | ---------------------------- |
| [创建 Webhook](webhook-create.md)  | `POST /webhook_endpoints`                   | 创建 Webhook 端点，配置回调 URL 与订阅事件 |
| [获取 Webhook](webhook-get.md)     | `GET /webhook_endpoints/{id}`               | 根据 ID 获取单个 Webhook 详情        |
| [列出 Webhook](webhook-list.md)    | `GET /webhook_endpoints`                    | 列出当前工作区未删除的 Webhook          |
| [更新 Webhook](webhook-update.md)  | `PUT /webhook_endpoints/{id}`               | 更新回调 URL、订阅事件、描述             |
| [删除 Webhook](webhook-delete.md)  | `DELETE /webhook_endpoints/{id}`            | 删除 Webhook，操作不可恢复            |
| [启用 Webhook](webhook-enable.md)  | `POST /webhook_endpoints/{id}/enable`       | 启用 Webhook，开始对事件进行回调投递       |
| [停用 Webhook](webhook-disable.md) | `POST /webhook_endpoints/{id}/disable`      | 停用 Webhook，停止回调投递            |
| [测试 Webhook](webhook-test.md)    | `POST /webhook_endpoints/{id}/test`         | 向回调 URL 发送测试事件，验证连通性         |
| [重置密钥](webhook-reset-secret.md)  | `POST /webhook_endpoints/{id}/reset_secret` | 重置签名密钥，旧密钥立即失效               |
| [查询事件](webhook-list-events.md)   | `GET /webhook_endpoints/{id}/events`        | 分页查询该 Webhook 的投递事件记录        |
