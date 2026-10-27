---
source: https://docs.bigmodel.cn/api-reference/managed-agents--deployment/列出-deployment
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Deployment

> 分页列出可访问的 Deployment，支持按 Agent、状态和创建时间筛选。

<Accordion title="使用说明">

分页列出当前身份可读取的 Deployment，支持按 Agent、状态和创建时间过滤。默认不返回已归档记录；传入 `include_archived=true` 可包含已归档 Deployment。归档状态由 `archived_at` 表示，`status` 仍只会是 `active` 或 `paused`。

</Accordion>



## OpenAPI

````yaml /openapi/openapi-managed-agents.json get /agent/managed/v1/deployments
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
  /agent/managed/v1/deployments:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    get:
      tags:
        - Managed Agents - Deployment
      summary: 列出 Deployment
      description: >-
        分页列出可访问的 Deployment，支持按 Agent、状态和创建时间筛选。


        <Accordion title="使用说明">


        分页列出当前身份可读取的 Deployment，支持按 Agent、状态和创建时间过滤。默认不返回已归档记录；传入
        `include_archived=true` 可包含已归档 Deployment。归档状态由 `archived_at`
        表示，`status` 仍只会是 `active` 或 `paused`。


        </Accordion>
      operationId: managedGetDeployments
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: agent_id
          in: query
          required: false
          description: 按 Agent ID 过滤。
          schema:
            type: string
        - name: status
          in: query
          required: false
          description: 按状态过滤。
          schema:
            type: string
            enum:
              - active
              - paused
        - name: created_at[gte]
          in: query
          required: false
          description: 创建时间下界。
          schema:
            type: string
            format: date-time
        - name: created_at[lte]
          in: query
          required: false
          description: 创建时间上界。
          schema:
            type: string
            format: date-time
        - name: include_archived
          in: query
          required: false
          description: 是否包含已归档 Deployment。
          schema:
            type: boolean
            default: false
        - name: limit
          in: query
          required: false
          description: 每页数量；大于 100 时服务端截断为 100。
          schema:
            type: integer
            minimum: 1
            default: 20
        - name: order
          in: query
          required: false
          description: 排序方向。
          schema:
            type: string
            enum:
              - asc
              - desc
            default: desc
        - name: page
          in: query
          required: false
          description: opaque cursor。
          schema:
            type: string
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedDeploymentPage'
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
    ManagedDeploymentPage:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/ManagedDeployment'
        next_page:
          type: string
          nullable: true
      required:
        - data
        - next_page
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
    ManagedDeployment:
      type: object
      properties:
        id:
          type: string
        type:
          type: string
          enum:
            - deployment
        name:
          type: string
        agent:
          $ref: '#/components/schemas/ManagedDeploymentAgent'
        environment_id:
          type: string
          description: Deployment 绑定的 Environment ID。旧数据缺失该字段时可能返回内部兼容值 `env_default`。
        description:
          type: string
          nullable: true
          description: 用途说明。
        metadata:
          $ref: '#/components/schemas/ManagedMetadata'
        resources:
          type: array
          items:
            $ref: '#/components/schemas/ManagedDeploymentResourceInput'
        schedule:
          allOf:
            - $ref: '#/components/schemas/ManagedScheduleResponse'
          nullable: true
        initial_events:
          type: array
          items:
            $ref: '#/components/schemas/ManagedDeploymentInitialEvent'
        status:
          type: string
          enum:
            - active
            - paused
        paused_reason:
          allOf:
            - $ref: '#/components/schemas/ManagedDeploymentPausedReason'
          nullable: true
          description: 暂停原因。手动暂停返回 `manual`；因资源失效自动暂停时返回对应错误类型。
        vault_ids:
          type: array
          items:
            type: string
        archived_at:
          type: string
          nullable: true
          description: 归档时间。
        created_at:
          type: string
          format: date-time
          description: 创建时间。
        updated_at:
          type: string
          format: date-time
          description: 更新时间。
      required:
        - id
        - type
        - name
        - agent
        - environment_id
        - description
        - metadata
        - resources
        - schedule
        - initial_events
        - status
        - paused_reason
        - vault_ids
        - archived_at
        - created_at
        - updated_at
      additionalProperties: false
    ManagedDeploymentAgent:
      type: object
      properties:
        type:
          type: string
          enum:
            - agent
        id:
          type: string
        version:
          type: integer
          minimum: 0
      required:
        - type
        - id
        - version
      additionalProperties: false
    ManagedMetadata:
      type: object
      additionalProperties:
        type: string
      description: 客户端自定义元数据；省略时默认为空对象。最多 16 个键，键名长度不超过 64 字符，值必须是长度不超过 512 字符的字符串。
      maxProperties: 16
    ManagedDeploymentResourceInput:
      oneOf:
        - title: memory_store
          allOf:
            - $ref: '#/components/schemas/ManagedDeploymentMemoryStoreResourceInput'
        - title: file
          allOf:
            - $ref: '#/components/schemas/ManagedFileResourceInput'
    ManagedScheduleResponse:
      type: object
      properties:
        type:
          type: string
          enum:
            - cron
        expression:
          type: string
        timezone:
          type: string
          enum:
            - Asia/Shanghai
        last_run_at:
          type: string
          nullable: true
          description: 上次运行时间。
        upcoming_runs_at:
          type: array
          description: 即将触发的计划时间。下次运行看数组第一项；manual-only 时整个 schedule 为 null。
          items:
            type: string
            format: date-time
      required:
        - type
        - expression
        - timezone
        - last_run_at
        - upcoming_runs_at
      additionalProperties: false
    ManagedDeploymentInitialEvent:
      allOf:
        - $ref: '#/components/schemas/ManagedInitialUserMessageEventInput'
      description: >-
        Deployment 每次运行时注入的初始用户消息。仅支持 `user.message`，内容块仅支持文本和图片（base64、url 或
        file 来源），不支持 document；图片要求生效模型支持图片输入。
    ManagedDeploymentPausedReason:
      oneOf:
        - title: manual
          type: object
          properties:
            type:
              type: string
              enum:
                - manual
          required:
            - type
          additionalProperties: false
        - title: error
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
                    - environment_archived_error
                    - environment_not_found_error
                    - file_not_found_error
                    - memory_store_archived_error
                    - vault_archived_error
                    - vault_not_found_error
              required:
                - type
              additionalProperties: false
          required:
            - type
            - error
          additionalProperties: false
    ManagedDeploymentMemoryStoreResourceInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - memory_store
          description: 固定为 memory_store。
        memory_store_id:
          type: string
          minLength: 1
          description: Agent 所有者名下处于 active 状态的 Memory Store ID。
        access:
          type: string
          enum:
            - read_only
            - read_write
          default: read_write
          description: 挂载权限；省略时由 Memory 服务按 read_write 处理。
        instructions:
          type: string
          description: 提供给 Agent 的使用说明；省略时不设置。
      required:
        - type
        - memory_store_id
    ManagedFileResourceInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - file
          description: 固定为 file。
        file_id:
          type: string
          minLength: 1
          description: 已存在且归当前资源所有者所有的 File ID。
        mount_path:
          type: string
          nullable: true
          description: >-
            沙箱内挂载路径；省略或传 null 时默认为 /mnt/session/uploads/{file_id}。路径会归一化到
            /mnt/session/uploads 下，不能逃逸该目录，UTF-8 总长度不超过 1024 字节。
      required:
        - type
        - file_id
      additionalProperties: false
    ManagedInitialUserMessageEventInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - user.message
          description: 固定为 user.message。
        content:
          type: array
          minItems: 1
          description: 非空内容块数组；初始消息允许 text/image，普通消息还允许 document。图片最多 50 张；总量受请求体限制。
          items:
            $ref: '#/components/schemas/ManagedInitialContentBlock'
      required:
        - type
        - content
    ManagedInitialContentBlock:
      oneOf:
        - title: text
          allOf:
            - $ref: '#/components/schemas/ManagedTextBlock'
        - title: image
          allOf:
            - $ref: '#/components/schemas/ManagedImageBlock'
    ManagedTextBlock:
      type: object
      properties:
        type:
          type: string
          enum:
            - text
          description: 固定为 text。
        text:
          type: string
          minLength: 1
          description: 非空文本内容。
      required:
        - type
        - text
    ManagedImageBlock:
      type: object
      properties:
        type:
          type: string
          enum:
            - image
          description: 固定为 image。
        source:
          allOf:
            - $ref: '#/components/schemas/ManagedImageSource'
          description: base64、HTTPS URL 或 File ID 图片来源，需使用支持图片输入的模型。
      required:
        - type
        - source
      additionalProperties: false
    ManagedImageSource:
      description: >-
        图片来源为 base64、url 或 file。每事件最多 50 张，单张最多 50 MiB；1–20 张时宽高各不超过 8000
        px，21–50 张时各不超过 2000 px。图片 Base64 总量最多 112 MiB，带图请求体最多 128 MiB。
      oneOf:
        - title: base64
          allOf:
            - $ref: '#/components/schemas/ManagedImageBase64Source'
        - title: url
          allOf:
            - $ref: '#/components/schemas/ManagedImageUrlSource'
        - title: file
          allOf:
            - $ref: '#/components/schemas/ManagedImageFileSource'
    ManagedImageBase64Source:
      type: object
      properties:
        type:
          type: string
          enum:
            - base64
          description: 内联 Base64 图片。
        media_type:
          type: string
          enum:
            - image/jpeg
            - image/png
            - image/gif
            - image/webp
          description: 图片 MIME 类型。
        data:
          type: string
          description: 标准 Base64 字符串；单张解码后不超过 50 MiB，且须满足像素与请求总量限制。
      required:
        - type
        - media_type
        - data
      additionalProperties: false
      title: base64
    ManagedImageUrlSource:
      type: object
      properties:
        type:
          type: string
          enum:
            - url
        url:
          type: string
          description: 可从平台访问的公网 HTTPS 图片地址；抓取受账号网络策略限制，建议优先使用 file_id。
          format: uri
      required:
        - type
        - url
      additionalProperties: false
      title: url
    ManagedImageFileSource:
      type: object
      properties:
        type:
          type: string
          enum:
            - file
        file_id:
          type: string
          description: 通过 Files API 上传的、当前调用身份有权访问的图片文件 ID。
      required:
        - type
        - file_id
      additionalProperties: false
      title: file
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.