---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/credential-api
fetched: 2026-10-23
title: Credential
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Credential

> 密钥（Credential）API 提供保险箱内具体密钥的创建、查询、更新、归档与删除操作。auth 当前仅支持 environment_variable 类型。

<meta property="og:title" content="Credential" />

## 概述 <span id="h-credential-overview" />

Credential 是 Vault 内的具体密钥条目，通过 `auth` 描述认证信息，当前仅支持 `environment_variable` 一种类型。`secret_value` 等敏感值仅写入时传入，响应中不返回明文。归档为软操作，归档后 Credential 不再注入会话，但仍可查询和恢复；删除为硬删除，不可恢复。

## Credential 操作 <span id="h-credential-ops" />

| **操作**                                               | **端点**                                                        | **说明**                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| [创建 Credential](credential-create.md)  | `POST /vaults/{vault_id}/credentials`                         | 在指定 Vault 中创建一个 Credential                                     |
| [获取 Credential](credential-get.md)     | `GET /vaults/{vault_id}/credentials/{credential_id}`          | 获取详情，auth 中的敏感值已脱敏                                             |
| [列出 Credential](credential-list.md)    | `GET /vaults/{vault_id}/credentials`                          | 分页列出指定 Vault 下的 Credential                                     |
| [更新 Credential](credential-update.md)  | `POST /vaults/{vault_id}/credentials/{credential_id}`         | 更新 display\_name、auth、metadata；auth 的 type 和 secret\_name 不可修改 |
| [归档 Credential](credential-archive.md) | `POST /vaults/{vault_id}/credentials/{credential_id}/archive` | 软归档，不再注入会话，仍可查询和恢复                                             |
| [删除 Credential](credential-delete.md)  | `DELETE /vaults/{vault_id}/credentials/{credential_id}`       | 硬删除，不可恢复                                                       |
