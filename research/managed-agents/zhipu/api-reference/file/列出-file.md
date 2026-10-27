---
source: https://docs.bigmodel.cn/api-reference/managed-agents--file/列出-file
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 File

> 新协议返回 data/next_page，旧协议返回 data/has_more/first_id/last_id。ids[] 为不分页批量查 ID 入口，见 Files 指南。



## OpenAPI

````yaml /openapi/openapi-managed-agents.json get /agent/managed/v1/files
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
    get:
      tags:
        - Managed Agents - File
      summary: 列出 File
      description: >-
        新协议返回 data/next_page，旧协议返回 data/has_more/first_id/last_id。ids[] 为不分页批量查
        ID 入口，见 Files 指南。
      operationId: managedGetFiles
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: limit
          in: query
          required: false
          description: 每页数量。
          schema:
            type: integer
            minimum: 1
            maximum: 1000
            default: 20
        - name: before_id
          in: query
          required: false
          description: 返回此 File 之前的一页。
          schema:
            type: string
        - name: after_id
          in: query
          required: false
          description: 返回此 File 之后的一页。
          schema:
            type: string
        - name: scope_id
          in: query
          required: false
          description: 按 Session scope 过滤，必须为 sess_ 前缀。
          schema:
            type: string
        - name: page
          in: query
          schema:
            type: string
          description: 将新协议 next_page 原样传入；优先于 before_id/after_id。
        - name: ids[]
          in: query
          schema:
            type: array
            maxItems: 100
            items:
              type: string
          style: form
          explode: true
          description: 按 ID 查询，去重最多100；不可与 page/limit/before_id/after_id 同用。
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedFilePage'
              example:
                data:
                  - type: file
                    id: file_01911111-1111-7111-8111-222222222222
                    size_bytes: 1024
                    created_at: '2026-10-15T08:00:00.000Z'
                    filename: report.txt
                    mime_type: text/plain
                    downloadable: true
                    expires_at: null
                    scope:
                      type: session
                      id: sess_01911111-1111-7111-8111-111111111111
                next_page: null
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
    ManagedFilePage:
      oneOf:
        - $ref: '#/components/schemas/ManagedFilePageCurrent'
        - $ref: '#/components/schemas/ManagedFilePageLegacy'
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
    ManagedFilePageCurrent:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/ManagedFile'
        next_page:
          type: string
          nullable: true
      required:
        - data
        - next_page
      additionalProperties: false
      title: 2026-09-22 Files 列表
    ManagedFilePageLegacy:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/ManagedFile'
        has_more:
          type: boolean
        first_id:
          type: string
        last_id:
          type: string
      required:
        - data
        - has_more
      additionalProperties: false
      title: 2026-05-26 兼容形态
    ManagedFile:
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
        scope:
          type: object
          properties:
            type:
              type: string
              enum:
                - session
            id:
              type: string
          required:
            - type
            - id
          additionalProperties: false
          description: 仅会话范围文件在列出或获取时返回；组织级上传文件和上传响应不含此字段。
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
        id: file_01911111-1111-7111-8111-222222222222
        size_bytes: 1024
        created_at: '2026-10-15T08:00:00.000Z'
        filename: report.txt
        mime_type: text/plain
        downloadable: true
        expires_at: null
        scope:
          type: session
          id: sess_01911111-1111-7111-8111-111111111111
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.