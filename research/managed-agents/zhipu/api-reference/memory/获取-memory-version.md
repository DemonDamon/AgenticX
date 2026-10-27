---
source: https://docs.bigmodel.cn/api-reference/managed-agents--memory/获取-memory-version
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取 Memory Version

> 获取指定 Memory Version 的不可变历史快照。



## OpenAPI

````yaml /openapi/openapi-managed-agents.json get /agent/managed/v1/memory_stores/{storeId}/memory_versions/{versionId}
openapi: 3.0.1
info:
  title: 智谱 AI Managed Agents API
  version: 1.0.0
  description: Agent、Environment、Session、File、Memory、Vault、Skill、Deployment 接口。
  contact:
    name: Z.AI 开发者
    url: https://chat.z.ai/legal-agreement/privacy-policy
    email: user_feedback@z.ai
servers:
  - url: https://open.bigmodel.cn/api/
    description: 开放平台服务
security:
  - bearerAuth: []
tags:
  - name: Managed Agents - Agent
    description: Agent 与版本管理。
    x-group: Agent
  - name: Managed Agents - Environment
    description: 声明式执行环境管理。
    x-group: Environment
  - name: Managed Agents - Session
    description: Session、Resource 与事件流。
    x-group: Session
  - name: Managed Agents - File
    description: Managed Files 上传、读取与删除。
    x-group: File
  - name: Managed Agents - Memory
    description: Memory Store、Memory 与版本管理。
    x-group: Memory
  - name: Managed Agents - Vault
    description: Vault 与 Credential 管理。
    x-group: Vault
  - name: Managed Agents - Skill
    description: 自定义 Skill 与版本管理。
    x-group: Skill
  - name: Managed Agents - Deployment
    description: 定时或手动 Deployment 与运行记录。
    x-group: Deployment
  - name: Thread
    description: 会话线程
    x-group: Thread
paths:
  /agent/managed/v1/memory_stores/{storeId}/memory_versions/{versionId}:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    get:
      tags:
        - Managed Agents - Memory
      summary: 获取 Memory Version
      description: 获取指定 Memory Version 的不可变历史快照。
      operationId: managedGetMemoryStoresByStoreIdMemoryVersionsByVersionId
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: storeId
          in: path
          required: true
          description: storeId 资源标识。
          schema:
            type: string
        - name: versionId
          in: path
          required: true
          description: versionId 资源标识。
          schema:
            type: string
        - name: beta
          in: query
          required: false
          description: SDK 兼容参数；提供时必须为 true。
          schema:
            type: string
            enum:
              - 'true'
        - name: view
          in: query
          required: false
          description: 返回基本信息或完整内容。
          schema:
            type: string
            enum:
              - basic
              - full
            default: full
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedMemoryVersion'
        default:
          description: 请求失败。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedAgentsErrorResponse'
components:
  parameters:
    ManagedZaiVersion:
      name: zai-version
      in: header
      required: true
      description: >-
        Managed Agents API 入口要求的基础协议标识，当前只接受 2026-05-26；响应兼容形态由 zai-beta
        选择。两个头均需携带。
      schema:
        type: string
        enum:
          - '2026-05-26'
        default: '2026-05-26'
        example: '2026-05-26'
    ManagedZaiBeta:
      name: zai-beta
      in: header
      required: true
      description: >-
        声明 Managed Agents Beta 协议并选择响应字段与兼容行为。新接入使用
        managed-agents-2026-09-22；旧客户端仍可使用 managed-agents-2026-05-26。必须同时携带
        zai-version: 2026-05-26。字段差异见 /cn/managed-agents/protocol-versions。
      schema:
        type: string
        default: managed-agents-2026-09-22
        example: managed-agents-2026-09-22
  schemas:
    ManagedMemoryVersion:
      type: object
      properties:
        id:
          type: string
        type:
          type: string
          enum:
            - memory_version
        memory_store_id:
          type: string
        memory_id:
          type: string
        operation:
          type: string
          enum:
            - created
            - modified
            - deleted
        path:
          type: string
          nullable: true
        content_sha256:
          type: string
          nullable: true
        content_size_bytes:
          type: integer
          nullable: true
        content:
          type: string
          nullable: true
          description: view=full 时返回内容；basic、deleted 或 redacted 时为 null。
        created_by:
          $ref: '#/components/schemas/ManagedMemoryActor'
        redacted_at:
          type: string
          nullable: true
          description: 脱敏时间。
        redacted_by:
          $ref: '#/components/schemas/ManagedMemoryActor'
        created_at:
          type: string
          format: date-time
          description: 创建时间。
      required:
        - id
        - type
        - memory_store_id
        - memory_id
        - operation
        - path
        - content_sha256
        - content_size_bytes
        - content
        - created_by
        - redacted_at
        - created_at
      additionalProperties: false
    ManagedAgentsErrorResponse:
      type: object
      properties:
        type:
          type: string
          enum:
            - error
        error:
          type: object
          properties:
            type:
              type: string
              enum:
                - invalid_request_error
                - authentication_error
                - permission_error
                - not_found_error
                - request_too_large
                - rate_limit_error
                - api_error
                - timeout_error
                - overloaded_error
                - memory_path_conflict_error
                - memory_precondition_failed_error
                - conflict_error
            message:
              type: string
            details:
              type: object
              additionalProperties: true
          required:
            - type
            - message
          additionalProperties: false
        request_id:
          type: string
          example: req_01J...
      required:
        - type
        - error
        - request_id
      additionalProperties: false
    ManagedMemoryActor:
      oneOf:
        - title: session_actor
          type: object
          properties:
            type:
              type: string
              enum:
                - session_actor
            session_id:
              type: string
          required:
            - type
            - session_id
          additionalProperties: false
        - title: user_actor
          type: object
          properties:
            type:
              type: string
              enum:
                - user_actor
            user_id:
              type: string
          required:
            - type
            - user_id
          additionalProperties: false
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.