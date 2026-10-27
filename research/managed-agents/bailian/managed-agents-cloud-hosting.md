---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-cloud-hosting
fetched: 2026-10-23
title: 云端托管环境
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 云端托管环境

> 运行环境定义工具调用的执行沙箱。在控制台环境页面创建和管理，可被多个会话复用。

<meta property="og:title" content="云端托管环境" />

<Warning>
  阿里云百炼托管的沙箱容器涉及基础云资源和服务，使用时应特别遵守[《阿里云产品服务协议》](https://terms.aliyun.com/legal-agreement/terms/suit_bu1_ali_cloud/suit_bu1_ali_cloud201802281451_77479.html)第 6 条关于网络和数据安全的约定，不应安装、使用盗版软件等，并对自行安装的软件和进行的操作所引起的结果承担全部责任。
</Warning>

## 类型

| **类型** | **说明**                                                          |
| ------ | --------------------------------------------------------------- |
| 云端     | 由阿里云百炼托管的沙箱容器，开箱即用，可被多个会话复用。配置预装包后可能需要预热，见[环境预热](#h-env-warmup) |

## 配置字段

在**环境**页面点击**添加环境**，填写以下字段：

| **字段** | **必填** | **可变更** | **说明**                                         |
| ------ | ------ | ------- | ---------------------------------------------- |
| 名称     | 是      | 是       | 工作空间内唯一标识                                      |
| 描述     | 否      | 是       | 环境用途说明                                         |
| 托管类型   | 否      | 否       | `cloud`（云端），由阿里云百炼托管。创建后无法变更                   |
| 预装包    | 否      | 是       | 按包管理器声明（`apt` / `pip` / `npm`），环境创建时自动安装       |
| 网络策略   | 否      | 是       | `unrestricted` 放行全部出站访问（仅 API 设置，控制台不显示）       |
| 作用域    | 否      | 是       | `organization`（默认），工作空间成员均可使用（仅 API 设置，控制台不显示） |
| 元数据    | 否      | 是       | 自定义键值对（对应 API 的 `metadata`），不影响运行行为            |

通过 API 创建环境时，指定沙箱类型与预装包。完整参数与响应字段详见[创建 Environment API](api/environment-create.md)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/environments" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "data-sandbox",
      "description": "数据分析沙箱",
      "config": {
        "type": "cloud",
        "packages": {
          "apt": ["ffmpeg"],
          "pip": ["pandas", "numpy", "matplotlib"]
        },
        "networking": {"type": "unrestricted"}
      }
    }'
  ```

  ```python
  env = client.environments.create(
      name="data-sandbox",
      config={
          "type": "cloud",
          "networking": {"type": "unrestricted"},
          "packages": {
              "apt": ["ffmpeg"],
              "pip": ["pandas", "numpy", "matplotlib"],
          },
      },
      description="数据分析沙箱",
  )
  ```

  ```java
  Environment env = client.environments().create(EnvironmentCreateParam.builder()
      .name("data-sandbox")
      .description("数据分析沙箱")
      .build());
  ```
</CodeGroup>

## 支持的包管理器

预装包按以下包管理器声明：

- **apt**：系统包，例如 ffmpeg
- **pip**：Python 包，例如 pandas、numpy
- **npm**：Node.js 包

## 环境预热 <span id="h-env-warmup" />

配置了预装包的环境，创建后可能需要预热时间安装依赖，耗时与包的数量和大小相关，可能持续数分钟以上。安装完成前环境处于**准备中**状态，不能被会话引用：此时创建会话返回 `invalid_parameter`，报错信息为 `The environment is still being prepared. Please wait until it is ready and try again.`。预热完成后即可正常绑定；未配置预装包的环境创建后立即可用。建议提前创建环境并预留预热时间，再绑定会话。

## 归档与删除

环境支持归档和删除两种操作：

- **归档**：环境保留但默认不出现在列表中，已绑定的会话继续可用。
- **删除**：硬删除，环境配置一并清除，不可恢复。如需保留配置请改用归档。

通过 API 归档环境，详见[归档 Environment API](api/environment-archive.md)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/environments/env_xxx/archive" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.environments.archive("env_xxx")
  ```

  ```java
  client.environments().archive("env_xxx");
  ```
</CodeGroup>

通过 API 删除环境，详见[删除 Environment API](api/environment-delete.md)：

<CodeGroup>
  ```bash
  curl -X DELETE "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/environments/env_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.environments.delete("env_xxx")
  ```

  ```java
  client.environments().delete("env_xxx");
  ```
</CodeGroup>

## 下一步

- [发起会话](managed-agents-session-event.md)：创建会话时绑定环境。
- [密钥库认证](managed-agents-credential.md)：为 MCP 服务和技能配置鉴权信息。
- [文件上传与挂载](managed-agents-file.md)：上传文件并挂载到会话。
