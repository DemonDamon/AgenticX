---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-cli
fetched: 2026-10-23
title: 使用 CLI
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 使用 CLI

> 在终端用阿里云百炼 CLI 以基础设施即代码方式管理 Agent 与会话。

<meta property="og:title" content="使用 CLI" />

[阿里云百炼 CLI](https://docs.bailian.console.aliyun.com/zh/model-studio/cli) 支持以基础设施即代码的方式管理智能体，从声明配置到运行会话一气呵成。

<Note>
  Managed Agent 相关 CLI 能力目前仅对中国站（aliyun.com）账号开放。
</Note>

## Agent 一键创建&部署 <span id="h-cli-deploy" />

### 生命周期

- `bl managed-agent init`：创建 YAML 配置模板，默认包含 Agent（智能体）和 Environment（运行环境）资源示例；还可按需配置 Skill（技能）、Vault（凭据仓库，含 Credential 凭据）、File（文件）和 Deployment（定时任务）资源
- `bl managed-agent validate`：校验资源配置
- `bl managed-agent plan`：预览资源变更
- `bl managed-agent apply`：读取 YAML 中的资源配置，默认先刷新已管理资源的云端状态，再计算变更计划；按依赖关系创建或更新资源，删除已从配置中移除且由当前项目管理的云端资源，并同步本地状态记录。可通过 --file 指定配置文件；执行前可用 `plan` 预览变更，确认后添加 --yes 执行
- `bl managed-agent destroy`：销毁本地状态跟踪的全部云端资源

### 本地资源状态

- `bl managed-agent state list`：列出本地资源状态记录
- `bl managed-agent state show`：查看指定资源的本地状态
- `bl managed-agent state import`：将已有云端资源导入本地状态
- `bl managed-agent state rm`：移除本地资源状态记录，不删除云端资源

### 会话预览

- `bl managed-agent playground`：在浏览器启动会话的在线调试预览

## 本地项目管理 <span id="h-cli-project" />

### 项目初始化

- `bl managed-agent project init`：创建目录式项目；通过 `--project .` 可在当前目录初始化

### 项目校验

- `bl managed-agent project validate`：校验项目的目录结构及资源配置是否符合规范

### 项目构建

- `bl managed-agent project build`：整理并写回本地目录源文件，生成不可变的发布 Build；可用 `--dry-run` 预览

### 项目发布

- `bl managed-agent project publish`：发布当前 Build、并记录版本；确认发布后使用 `--yes` 执行

### 项目工作台

- `bl managed-agent project workbench`：启动目录式项目的 Config UI Workbench，可视化编辑和调试项目

### 项目版本

- `bl managed-agent project version list`：列出本地项目快照版本
- `bl managed-agent project version enable`：启用本地项目版本管理
- `bl managed-agent project version disable`：停用本地项目版本管理
- `bl managed-agent project version status`：查看本地项目版本管理状态
- `bl managed-agent project version preview`：预览本地项目历史版本
- `bl managed-agent project version restore`：将历史版本恢复到项目工作目录

## 资源操作 <span id="h-cli-resources" />

按资源提供查询、创建和运行等操作。Agent、Environment、Skill、Vault 和 Deployment 等创建命令支持通过参数生成资源声明，通过 `--yes` 确认后写入配置并创建资源。

### Agent

- `bl managed-agent agent create`：创建 Agent
- `bl managed-agent agent list`：列出远端 Agent
- `bl managed-agent agent get`：获取 Agent 详情，可指定版本
- `bl managed-agent agent search`：按 ID、名称或描述搜索 Agent
- `bl managed-agent agent versions`：列出 Agent 的版本

### Environment

- `bl managed-agent environment list`：列出远端环境
- `bl managed-agent environment get`：获取环境详情
- `bl managed-agent environment search`：按 ID、名称或描述搜索环境
- `bl managed-agent environment create`：创建云端环境

### Skill

- `bl managed-agent skill list`：列出远端自定义或官方 Skill
- `bl managed-agent skill get`：获取 Skill 详情
- `bl managed-agent skill search`：按 ID、名称或描述搜索 Skill
- `bl managed-agent skill create`：创建自定义 Skill
- `bl managed-agent skill versions`：列出 Skill 的版本
- `bl managed-agent skill download`：下载 Skill 到本地，可指定版本

### Vault

- `bl managed-agent vault list`：列出远端凭据仓库
- `bl managed-agent vault get`：获取凭据仓库详情
- `bl managed-agent vault search`：按 ID、名称或元数据搜索凭据仓库
- `bl managed-agent vault create`：创建空凭据仓库
- `bl managed-agent vault credential create`：向已跟踪的 Vault 创建环境变量凭据

### Deployment

- `bl managed-agent deployment list`：列出远端部署
- `bl managed-agent deployment get`：获取部署详情
- `bl managed-agent deployment search`：按关键词搜索部署
- `bl managed-agent deployment create`：创建部署，可配置定时执行
- `bl managed-agent deployment run`：立即触发指定部署运行一次
- `bl managed-agent deployment pause`：暂停部署及其定时执行
- `bl managed-agent deployment unpause`：恢复部署及其定时执行
- `bl managed-agent deployment runs list`：列出指定部署的运行记录
- `bl managed-agent deployment runs get`：获取单次部署运行的详情

### Session

- `bl managed-agent session create`：创建会话
- `bl managed-agent session run`：创建会话、发送 Prompt 并流式输出响应
- `bl managed-agent session send`：向已有会话发送文本消息并流式输出响应
- `bl managed-agent session list`：列出远端会话
- `bl managed-agent session get`：获取会话详情
- `bl managed-agent session search`：按 ID、标题、状态或 Agent ID 搜索会话
- `bl managed-agent session update`：更新会话标题或元数据
- `bl managed-agent session archive`：归档指定会话
- `bl managed-agent session delete`：删除指定会话
- `bl managed-agent session event list`：列出会话历史事件
- `bl managed-agent session event send`：向会话发送原始事件对象或事件数组
- `bl managed-agent session event stream`：流式读取会话事件，支持从指定事件之后续传
- `bl managed-agent session debug`：汇总会话、事件及文件元数据等诊断信息
- `bl managed-agent session export`：将脱敏后的会话诊断信息导出为 ZIP，不含文件正文

### File

- `bl managed-agent file list`：列出远端文件
- `bl managed-agent file get`：获取文件元数据
- `bl managed-agent file search`：按 ID、文件名或 MIME 类型搜索文件
- `bl managed-agent file upload`：上传本地文件
- `bl managed-agent file download`：下载远端文件正文到本地
- `bl managed-agent file delete`：删除指定远端文件

## 示例

```bash
bl managed-agent plan                                    # 预览将要创建/变更的资源
bl managed-agent apply                                   # 应用配置，创建智能体与环境
bl managed-agent session run --prompt "分析 sales.csv 的 Q3 销售趋势"
```

任意命令追加 `--help` 可查看完整参数说明，例如 `bl managed-agent apply --help`。
