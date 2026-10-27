---
source: https://docs.bigmodel.cn/api-reference/managed-agents--file/上传-file
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 上传 File

> 通过 `multipart/form-data` 上传一个 File，供 Session 或 Deployment 作为文件资源挂载。请求必须包含 `file` 字段，并受平台文件大小限制。



## OpenAPI

````yaml /openapi/openapi-managed-agents.json post /agent/managed/v1/files
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
  /agent/managed/v1/files:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    post:
      tags:
        - Managed Agents - File
      summary: 上传 File
      description: >-
        通过 `multipart/form-data` 上传一个 File，供 Session 或 Deployment
        作为文件资源挂载。请求必须包含 `file` 字段，并受平台文件大小限制。
      operationId: managedPostFiles
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                file:
                  type: string
                  format: binary
              required:
                - file
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedUploadedFile'
              example:
                type: file
                id: file_01911111-1111-7111-8111-111111111111
                size_bytes: 1024
                created_at: '2026-10-15T08:00:00.000Z'
                filename: report.txt
                mime_type: text/plain
                downloadable: false
                expires_at: null
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
    ManagedUploadedFile:
      type: object
      properties:
        type:
          type: string
          enum:
            - file
        id:
          type: string
          description: File ID。
          example: file_01911111-1111-7111-8111-111111111111
        size_bytes:
          type: integer
          format: int64
        created_at:
          type: string
          format: date-time
          description: 创建时间。
        filename:
          type: string
        mime_type:
          type: string
        downloadable:
          type: boolean
          description: 上传文件为 false，不可再下载；写入 /mnt/session/outputs 后编目的会话产物为 true。
          enum:
            - false
          example: false
        expires_at:
          type: string
          nullable: true
          enum:
            - null
          example: null
          description: 新协议固定为 null，不设自动过期时间；旧协议省略此字段。
      required:
        - type
        - id
        - size_bytes
        - created_at
        - filename
        - mime_type
        - downloadable
      additionalProperties: false
      example:
        type: file
        id: file_01911111-1111-7111-8111-111111111111
        size_bytes: 1024
        created_at: '2026-10-15T08:00:00.000Z'
        filename: report.txt
        mime_type: text/plain
        downloadable: false
        expires_at: null
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
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.