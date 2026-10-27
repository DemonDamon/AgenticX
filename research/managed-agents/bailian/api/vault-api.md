---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/vault-api
fetched: 2026-10-23
title: Vault
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Vault

> 密钥库（Vault）API 提供保险箱容器的创建、查询、更新、归档与删除操作。Vault 用于集中存储和管理 Credential。

<meta property="og:title" content="Vault" />

## 概述 <span id="h-vault-overview" />

Vault 是 Credential 的容器，用于集中存储和管理密钥。归档为软操作，`archived_at` 被填入归档时间后默认不出现在列表中（除非查询时传 `include_archived=true`），已绑定会话仍可使用其 Credential。删除为硬删除，不可恢复，密钥库内的全部 Credential 一并删除。

## Vault 操作 <span id="h-vault-ops" />

| **操作**                                     | **端点**                            | **说明**                          |
| ------------------------------------------ | --------------------------------- | ------------------------------- |
| [创建 Vault](vault-create.md)  | `POST /vaults`                    | 创建一个 Vault，用于集中存储和管理 Credential |
| [获取 Vault](vault-get.md)     | `GET /vaults/{vault_id}`          | 根据 ID 获取单个 Vault 的详细信息          |
| [列出 Vault](vault-list.md)    | `GET /vaults`                     | 分页列出工作空间下的 Vault，默认不包含已归档项      |
| [更新 Vault](vault-update.md)  | `POST /vaults/{vault_id}`         | 使用补丁语义更新名称或元数据                  |
| [归档 Vault](vault-archive.md) | `POST /vaults/{vault_id}/archive` | 软归档，已绑定会话不受影响                   |
| [删除 Vault](vault-delete.md)  | `DELETE /vaults/{vault_id}`       | 硬删除，不可恢复，密钥库内全部 Credential 一并删除 |
