---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-custom-mcp-skills
fetched: 2026-10-23
title: 进阶：自定义 MCP 与 Skills
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 进阶：自定义 MCP 与 Skills

> 把自有能力挂上 Agent：已运行的 MCP Server 注册进阿里云百炼（自定义 MCP，含按会话动态传入鉴权 Header），团队作业流程打包上传（Skills），含运行时机制与版本管理。

<meta property="og:title" content="进阶：自定义 MCP 与 Skills" />

## 概述 <span id="h-cm-intro" />

内置工具集（[入门篇](managed-agents-data-analysis.md)）、MCP 市场服务（[生产化篇](managed-agents-production.md)）都是「平台给的」能力；本篇讲反方向——**把已有的能力挂上 Agent**：已经跑着的 MCP Server 注册进阿里云百炼（自定义 MCP），团队的作业流程打包上传（Skills）。

## 场景：鹿鸣出版的审读助手 <span id="h-cm-scenario" />

「鹿鸣出版」是一家虚构的图书出版公司，内容运营部每个月要处理大量来稿。他们有两样现成的资产：

1. **一套编辑规范知识库**——早已建在阿里云百炼知识索引（RAG）上，对外暴露的就是一个标准的 MCP 端点。痛点：这个知识库以前只有应用侧能查，Managed Agent 用不上。
2. **一个稿件体检流程**——老编辑的「三看」经验：看标题层级、看段落长度、看绝对化用语。以前是人肉 checklist，想变成 Agent 自动执行。

诉求很清晰：<strong>知识库的 MCP 端点是现成的，让 Agent 能查它；体检流程是现成的，让 Agent 照着做。</strong>这正好对应本篇两个主题：自定义 MCP（注册已有服务）与自定义 Skills（上传自有流程）。

先明确能力分类——Agent 的外部能力分三档：

| 档位                        | 来源                                | 谁维护       | 出场篇章                                                                                                            |
| ------------------------- | --------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| 内置工具集 `builtin_toolkit`   | 平台内置（bash / 读写文件 / web\_search 等） | 阿里云百炼     | [入门篇](managed-agents-data-analysis.md)                                                            |
| 市场 MCP `type: official`   | MCP 市场服务                          | 阿里云百炼市场托管 | [生产化篇](managed-agents-production.md)、[多智能体篇](managed-agents-multiagent-proposal.md) |
| **自有资产** `type: customer` | **你的 MCP Server、你的 Skill 包**      | **你**     | **本篇**                                                                                                          |

## 自定义 MCP：把已有的 MCP Server 注册进阿里云百炼 <span id="h-cm-mcp" />

### 市场与自定义 <span id="h-cm-market" />

阿里云百炼的 MCP 管理分两个标签页：**市场**（阿里云百炼托管，开箱即用，`WebSearch` 就在这）和**自定义**（接入自己的 MCP 服务器或第三方服务）。自定义支持四种接入类型：**插件**、**脚本部署**、**AI 网关**、**阿里云 OpenAPI**。

本篇的重点场景是：**MCP Server 已经在跑了**（鹿鸣的知识库 RAG 端点），只差「在阿里云百炼登记一笔」。这种情况选**脚本部署**里的 **HTTP 部署**（安装方式选 `http`）——注意，这一步只是**注册**（把端点地址、鉴权方式告诉阿里云百炼），不会真正部署任何东西，**不产生部署费用**。

进入控制台「Managed Agent → MCP」的**自定义**标签页，点击右上角**创建MCP服务**，在弹出的类型选择里选**脚本部署**。

<Note>
  选择脚本部署后，表单的**安装方式**有 `npx` / `uvx` / `http` 三种。`npx` / `uvx` 会把服务真正部署到函数计算（Function Compute），按调用时长和次数计费；**`http` 是纯注册**——只登记现成端点，表单里的部署方式、部署地域字段会收起，不产生部署费用。
</Note>

安装方式选 `http`。

### 例：注册阿里云百炼 RAG 知识库的 MCP 端点 <span id="h-cm-rag" />

鹿鸣的编辑规范知识库建在阿里云百炼知识索引上，它的 MCP 端点是工作空间级的固定地址。填写服务名称与描述，在 **MCP服务配置**（JSON）里登记连接配置：

```json
{
  "mcpServers": {
    "rag_mcp": {
      "type": "streamableHttp",
      "url": "https://${workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/indices/rag/mcp",
      "headers": {
        "Authorization": "Bearer ${DASHSCOPE_API_KEY}"
      }
    }
  }
}
```

三个字段读法：

- `type` 取 `streamableHttp`（MCP 协议的标准 HTTP 传输类型），端点是单个 URL，无状态调用；也支持 `sse`；
- `url` 里的 `${workspaceId}` 是阿里云百炼工作空间 ID（控制台右上角可见，形如 `llm-xxxx`）；
- `headers` 里带鉴权——RAG 端点用的是普通 API Key（Bearer）。**注意：注册时填写的密钥存在阿里云百炼侧的 MCP 配置里，Agent 调用时由平台代为带上**，不用在 Agent 的 system 提示词或 vault 里再放一份。

<Note>
  这个例子反过来也说明一件常被误解的事：**「自定义 MCP」不要求从零写一个 MCP Server**。任何已经在运行的、暴露了 MCP 协议端点的服务——自研的业务系统 API 网关、第三方 SaaS 的 MCP 接口、甚至另一个云产品（如阿里云百炼知识索引）——都可以这样注册进来。阿里云百炼做的是「登记 + 代理调用」，不是「托管运行」。
</Note>

提交部署后，自定义列表里出现新服务；进入详情页，可在概览、工具、外部调用标签页查看服务状态与调用信息。

### API 挂载：`type: customer` <span id="h-cm-mount" />

注册完成后，到控制台 **MCP 管理**列表里记下该服务的**服务 ID**（形如 `mcp-xxxxxxxx`；列表卡片上 ID 一栏）。**挂载时 `name` 填服务 ID，不填显示名称**——`type: customer` 的 name 字段虽然叫 name，实际按 ID 解析，填显示名称会返回 `AGENT_010 查询MCP详情异常`。`mcp_servers` 字段与挂市场服务是同一个，只是 `type` 换成 `customer`：

```bash
curl -s -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "luming-editor",
    "model": {"id": "qwen3.8-max"},
    "mcp_servers": [
      {"type": "customer", "name": "mcp-xxxxxxxx"}
    ]
  }'
```

`$AGENTSTUDIO_URL` 与 `$DASHSCOPE_API_KEY` 的约定见[生产化篇](managed-agents-production.md)。挂载后工具的启用方式与市场服务完全一致：`tools` 里加 `mcp_toolkit`，`mcp_server_name` 填**同一个服务 ID**（与 `mcp_servers[].name` 两处必须一致），`configs[ ]` 逐工具 `enabled: true`（未逐工具启用时，运行时工具静默缺失，完整说明见[生产化篇](managed-agents-production.md)）。

**一个重要的差异——两种 type 的校验时机完全不同**：

|       | `type: official`（市场）           | `type: customer`（自定义）                          |
| ----- | ------------------------------ | ---------------------------------------------- |
| 声明时校验 | **不校验存在性**——写一个市场里不存在的名字也能创建成功 | **强制校验**——名字没注册过直接 400                         |
| 失败表现  | 运行时工具静默缺失，Agent 回复「没有可用工具」     | 创建即报错：`AGENT_010 "MCP Server 校验失败: 查询MCP详情异常"` |
| 排查难度  | 高（无报错，仅工具缺失，不易发现）              | 低（创建时即报错）                                      |

自定义 MCP 的接入顺序是固定的：**先在控制台注册，再写进 agents 配置**。顺带一提，当前自定义 MCP 的注册与增删改走控制台（API 总览里没有对应端点）。

### 动态传入 MCP 鉴权 Header <span id="h-cm-dynamic-header" />

上面的 RAG 例子用固定鉴权：注册时把密钥替换成实际值，之后全部会话共用这一份。同一个自定义 MCP 服务若需要**按会话使用不同的鉴权信息**，改用动态 Header 占位符。例如审读助手调用业务 MCP 时，要按会话传入访问凭证（`dynamic-header`）与租户标识（`X-Tenant-Id`）。做法分两步：注册 MCP 时声明动态 Header 占位符；调用 `POST /sessions` 创建会话时传入当前会话的真实值，平台调用该 MCP 时完成替换。

#### 注册时声明动态 Header <span id="h-cm-dynamic-register" />

在自定义 MCP 的 **MCP服务配置**（JSON）里，把需要动态传值的 Header 写成 `"Header名称": "${Header名称}"`。名为 `business_mcp` 的示例：

```json
{
  "mcpServers": {
    "business_mcp": {
      "type": "streamableHttp",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "dynamic-header": "${dynamic-header}",
        "X-Tenant-Id": "${X-Tenant-Id}"
      }
    }
  }
}
```

`${dynamic-header}` 与 `${X-Tenant-Id}` 是**注册时原样保留的动态占位符**，不要提前替换成某个会话的真实值；同一服务允许配置多个动态 Header。Header 名称、占位符名称与后续传参的键三者保持一致，配置对象的字段名为 `headers`。注册完成后按上一节完成 Agent 挂载与工具启用。

#### 创建会话时通过 `mcp_configs` 传入真实值 <span id="h-cm-dynamic-session" />

在 `POST /sessions` 请求体顶层添加 `mcp_configs`，与 `agent`、`environment_id` 并列（字段定义见[创建 Session API](api/session-create.md)）：

```bash
curl -s -X POST "$AGENTSTUDIO_URL/sessions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "agent": {"id": "agent_xxx"},
    "environment_id": "env_xxx",
    "title": "鹿鸣审读：租户 A",
    "mcp_configs": [
      {
        "mcp_server_name": "mcp-xxxxxxxx",
        "headers": {
          "dynamic-header": "session-a-token-example",
          "X-Tenant-Id": "tenant-a"
        }
      }
    ]
  }'
```

| 参数                              | 类型        | 填写说明                                                                              |
| ------------------------------- | --------- | --------------------------------------------------------------------------------- |
| `mcp_configs`                   | 数组        | 会话级 MCP 请求头配置，独立于 `agent`；省略时为空数组。为多个 MCP 服务传值时，在数组中分别添加配置                        |
| `mcp_configs[].mcp_server_name` | string，必填 | 目标 MCP Server 标识，与 Agent 挂载配置的 `mcp_servers[].name`、工具包的 `mcp_server_name` 三处保持一致 |
| `mcp_configs[].headers`         | object，必填 | 当前会话的请求头键值对，键和值均为字符串                                                              |

请求外层的 `Authorization` 用于调用 Managed Agents API；请求体中的 `mcp_configs[].headers` 用于 Agent 调用目标 MCP 服务。换一个租户时，复用同一个 Agent 与 MCP 注册，只替换 `headers` 里的值，无需重复注册 MCP。

<Note>
  传入不存在的 MCP Server 名称不会导致创建会话报错，但运行时该配置不生效——`mcp_server_name` 需要与注册的服务 ID 核对一致。另外，`mcp_configs` 不会出现在创建会话的响应里，`GET /sessions/{id}` 才会返回，核对时以 GET 结果为准。
</Note>

## Skills：把团队流程打包上传 <span id="h-cm-skills" />

MCP 解决「Agent 能调你的服务」，Skills 解决「Agent 会按你的流程干活」。一个 Skill 就是一个 zip 包：里面放着一份**说明书**（SKILL.md）加**随包资源**（脚本、模板、参考文件），打包上传、过审、挂到 Agent 上。SKILL.md 的完整编写规范见[技能](managed-agents-skill.md)。

### 打包 <span id="h-cm-pack" />

zip 包不超过 **10 MB**，**根目录必须有 SKILL.md**。frontmatter 声明 `name` 和 `description`——**智能体根据 description 决定何时调用这个技能**。

鹿鸣的「稿件体检」技能，两个文件打包：

**SKILL.md**（说明书）：

```markdown
---
name: manuscript-check
description: 稿件体检技能。当用户提交稿件要求"体检"、"审读"或"出版前检查"时使用：将稿件保存为文本文件后运行 manuscript_check.py，对稿件做标题层级跳跃、段落超长（>400 字）、绝对化禁用词三类检查，并将 JSON 输出整理为审读意见清单。
---

# 稿件体检

对稿件执行出版前体检时按以下流程操作：

1. 将用户提交的稿件内容保存为 `/tmp/manuscript.txt`
2. 运行 `python3 manuscript_check.py /tmp/manuscript.txt`
3. 将 JSON 输出整理为审读意见：逐项列出问题类型、所在段落与建议

## 检查项

- 标题层级跳跃（如 H1 直接到 H3）
- 段落超长（超过 400 字）
- 绝对化禁用词（"最好"、"第一"、"绝对"、"百分之百"、"史无前例"、"独一无二"）
```

**manuscript\_check.py**（随包资源，节选）：

```python
#!/usr/bin/env python3
"""稿件体检：标题层级、段落长度、禁用词检查。输出 JSON 审读清单。"""
import json, re, sys

BANNED = ["最好", "第一", "绝对", "百分之百", "史无前例", "独一无二"]

def check(path):
    text = open(path, encoding="utf-8").read()
    issues = [ ]
    # 标题跳级：逐行扫描（相邻标题不需要空行分隔，按空行分段会漏检）
    prev_level = 0
    for lineno, line in enumerate(text.splitlines(), 1):
        m = re.match(r"^(#{1,6})\s", line)
        if m:
            level = len(m.group(1))
            if prev_level and level > prev_level + 1:
                issues.append({"issue": "HEADING_SKIP",
                               "detail": f"第 {lineno} 行标题从 H{prev_level} 跳到 H{level}"})
            prev_level = level
    # 段落长度与禁用词：按空行分段
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    for i, para in enumerate(paras, 1):
        if len(para) > 400:
            issues.append({"issue": "PARA_TOO_LONG",
                           "detail": f"第{i}段 {len(para)} 字（上限 400）"})
        for w in BANNED:
            if w in para:
                issues.append({"issue": "BANNED_WORD", "detail": f"第{i}段出现禁用词「{w}」"})
    return {"paragraphs": len(paras), "issues": issues}

if __name__ == "__main__":
    print(json.dumps(check(sys.argv[1]), ensure_ascii=False, indent=2))
```

打包（根目录直接是 SKILL.md，不要再套一层目录）：

```bash
zip manuscript-check.zip SKILL.md manuscript_check.py
```

### 上传全链路（API） <span id="h-cm-upload" />

**第一步：先当普通文件上传**（POST /files，multipart），拿 `file_id`：

```bash
curl -s -X POST "$AGENTSTUDIO_URL/files" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -F "file=@manuscript-check.zip"
```

```json
{"id": "file_zq9kyvmkkprtg0b32afk8rto", "filename": "manuscript-check.zip",
 "mime_type": "application/octet-stream", "size_bytes": 1695,
 "status": "checking", "created_at": "2026-09-02T12:56:45+08:00", ...}
```

zip 文件本身也进入审核（`status: checking`）。

**第二步：用 file\_id 创建技能**（POST /skills，请求体就这一个字段）：

```bash
curl -s -X POST "$AGENTSTUDIO_URL/skills" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{"file_id": "file_zq9kyvmkkprtg0b32afk8rto"}'
```

```json
{
  "id": "skill_MWY3ZTY5ZDE3MGIzNDFkZWI2Zj",
  "name": "manuscript-check",
  "description": "稿件体检技能。当用户提交稿件要求\"体检\"、\"审读\"或\"出版前检查\"时使用：...",
  "source": "customer",
  "status": "checking",
  "latest_version": "1.0",
  "created_at": "2026-09-02T04:57:01Z",
  ...
}
```

两个值得注意的点：

1. **`name` 和 `description` 由服务端从 SKILL.md 解析**——请求体里根本没有这两个字段。front matter 写什么，技能就叫什么；SKILL.md 的 `name` 就是后面沙箱里的目录名。
2. **首个版本号自动分配为 "1.0"**。

<strong>第三步：等审核。</strong>参考时间线：

```plaintext
12:57:01  POST /skills         → status: checking
12:57:29 ~ 13:00:21  GET 轮询   → checking（5 次）
13:01:00  审核通过              → status: active   ← 耗时 3 分 59 秒
```

状态机：`checking` → `active`（可挂载）/ `rejected`（不可挂载，版本详情里有按文件路径列出的问题）→ `deleted`。

**审核不是秒级的**——脚本化上传时不要假设「传完立刻可挂载」，要么轮询 `GET /skills/{skill_id}` 等 `active`，要么把上传做成异步流水线（上传 → 通知 → 挂载）。

**第四步：挂载到 Agent**：

```bash
curl -s -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "luming-editor",
    "model": {"id": "qwen3.8-max"},
    "system": "你是鹿鸣出版的内容审读助手。收到稿件时必须使用 manuscript-check 技能执行体检，并将检查结果整理为审读意见。",
    "tools": [{"type": "builtin_toolkit", "default_config": {"enabled": true},
      "configs": [{"name": "bash", "enabled": true}, {"name": "read", "enabled": true},
                  {"name": "write", "enabled": true}, {"name": "glob", "enabled": true},
                  {"name": "grep", "enabled": true}]}],
    "skills": [{"type": "customer", "skill_id": "skill_MWY3ZTY5ZDE3MGIzNDFkZWI2Zj", "version": "1.0"}]
  }'
```

`skills[ ]` 每项三个字段：`type`（customer）、`skill_id`、**`version`（必须精确锁定一个存在的版本，不支持 latest）**。挂载校验的错误样本：

- 挂 `checking` 状态的技能 → `400 AGENT_010 "Skill 不存在或正在接受安全扫描: skill_xxx@1.0"`
- 挂 active 技能但版本号写 `9.9` → 同样的 400（错误信息把 `skill_id@version` 拼在一起，方便定位是哪一对没对上）

### 运行时：技能是怎么被「用」起来的 <span id="h-cm-runtime" />

发一篇问题稿件（标题跳级 + 禁用词 + 超长段落）给挂了技能的 Agent，事件历史里能完整看到技能的工作机制：

```plaintext
[05:03:33] tool_call        activate_skill  {"name": "manuscript-check"}
[05:03:33] tool_call_output {"name": "manuscript-check", "content": "<SKILL.md 全文>"}
[05:03:44] tool_call        write           稿件写入 /tmp/manuscript.txt
[05:03:47] tool_call        bash            "cd /root/workspace/skills/manuscript-check && python3 manuscript_check.py /tmp/manuscript.txt"
[05:03:47] tool_call_output 脚本的 JSON 结果（6 处问题）
[05:04:01] message          assistant       综合审读意见
```

逐条解读：

1. <strong>技能不预注入系统提示词。</strong>Agent 收到消息后，模型自己决定调用一个**隐藏工具** `activate_skill`，参数就是技能名——SKILL.md 全文（说明书）这时才进入对话上下文。好处显而易见：挂十个技能也不会撑爆系统提示词，按需加载。
2. **zip 包被解压到沙箱** `/root/workspace/skills/<技能名>/` 目录（目录名 = SKILL.md 的 name），说明书里引用的脚本直接用 bash 跑。SKILL.md 正文里的路径要写「相对技能目录」的用法（如上例直接 `manuscript_check.py`），Agent 自己会先 `cd` 过去。
3. <strong>说明书决定行为，脚本决定事实。</strong>Agent 拿到脚本输出的 JSON 后做的是「整理 + 判断」：「第一章 绪论」触发了禁用词「第一」的机械匹配，Agent 的处理是——「系章节序号用词触发，建议与审校确认序号类『第一』是否属于豁免情形」。**脚本管扫描，模型管裁量**，这是设计技能时最值得想清楚的分界线。

### 版本管理 <span id="h-cm-versions" />

上传新版本（`POST /skills/{skill_id}/versions`，请求体同样只有 `file_id`）：

```bash
# 改 manuscript_check.py 的 BANNED 常量（比如加"全网最低价"——检查逻辑读的是脚本里的硬编码列表，只改 SKILL.md 不会生效）→ 重新打包 → 上传
curl -s -X POST "$AGENTSTUDIO_URL/skills/skill_MWY3ZTY5ZDE3MGIzNDFkZWI2Zj/versions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{"file_id": "file_889syqcvxriijfzl5xe9kci9"}'
```

```json
{"id": "skillver_MTRiNWIwNDNiNWZjNDc5Y2", "version": null,
 "status": "checking", "type": "skill_version", "skill_id": "skill_MWY3...", ...}
```

行为要点：

- **版本号 0.1 步进自动分配**：`1.0` → `1.1` → `1.2`……（创建响应里 `version` 是 null，但版本列表立即出现新版本）；
- 新版本同样要过安全扫描（checking → active，耗时与首发同量级）；
- **挂载锁定**：新版本 `1.1` 变为 active 后，已挂载 `1.0` 的 Agent 配置纹丝不动（GET /agents 复核 `skills[0].version == "1.0"`）。要让 Agent 用新版，必须显式更新 Agent 配置——与 Agent 版本锁定（[入门篇](managed-agents-data-analysis.md)、[进阶：提示词版本管理与回滚](managed-agents-prompt-versioning.md)）同一哲学：**运行中的东西不被后台变更波及**；
- **当前升级窗口的两个实际行为**（新版本审核期间，实测约数分钟）：`latest_version` 在新版本**进入 checking 时即推进**到 `1.1`，而非审核通过后；且该窗口内**新建 Agent 挂载旧的 active 版本 `1.0` 会被拒**（400「Skill 不存在或正在接受安全扫描: ...\@1.0」），已挂载的 Agent 运行也可能报错。窗口结束后不改动任何配置即可恢复。计划升级时避开这个窗口建新 Agent，或等新版本 active 后再操作；
- 版本列表 `GET /skills/{id}/versions` 按新到旧排列；
- `GET /skills/{id}/versions/{version}/content` 返回 **OSS 预签名下载 URL**——可以把当年上传的包原样拿回来（审计利器：技能内容可追溯）。

注意：技能包里混入冗余文件（比如误打包了 `SKILL_v2.md`）不会阻断上传，审核也会通过——上传前请自查包内容，审核不负责把关。

## 运维与清理 <span id="h-cm-ops" />

```bash
# 状态观测：技能列表（source 过滤自建/官方）
curl -s "$AGENTSTUDIO_URL/skills?source=official&limit=10" -H "Authorization: Bearer $DASHSCOPE_API_KEY"   # 官方市场技能
curl -s "$AGENTSTUDIO_URL/skills" -H "Authorization: Bearer $DASHSCOPE_API_KEY"                            # 全部

# 删除：硬删除，不可恢复（技能只有 DELETE，没有 archive）
curl -s -X DELETE "$AGENTSTUDIO_URL/skills/skill_xxx" -H "Authorization: Bearer $DASHSCOPE_API_KEY"        # 200
```

- **技能删除是硬删除**——对比：Agent / Deployment 只能 archive 不能删。删除前想清楚：已挂载旧版本的 Agent 引用会失效。
- 自定义 MCP 的增删改在控制台（无 API），技能的增删改查在 API（本篇全链路）——两类资产的管理入口相反。
- `GET /skills` 列表返回工作空间下全部技能（含官方市场）的健康状态，可用于日常巡检。

## 小结 <span id="h-cm-summary" />

| 想要                           | 用什么                           | 关键动作                                                 |
| ---------------------------- | ----------------------------- | ---------------------------------------------------- |
| 平台内置的执行能力（bash/读写文件/联网）      | `builtin_toolkit`             | [入门篇](managed-agents-data-analysis.md) |
| 公网通用服务（搜索、文档处理…）             | 市场 MCP（`type: official`）      | [生产化篇](managed-agents-production.md)   |
| **自己的 MCP Server（知识库、业务系统）** | **自定义 MCP（`type: customer`）** | **控制台注册（脚本部署 → http 安装方式，仅注册免费）→ API 挂载**            |
| 同一个 MCP 按会话传入不同鉴权信息          | 动态 MCP Header                 | 注册时配置 `${Header名称}` 占位符 → 创建会话的 `mcp_configs` 传入真实值  |
| **团队的作业流程（清单、脚本、模板）**        | **自定义 Skill**                 | **打包 zip → API 上传 → 过审（分钟级）→ 挂载锁定版本**                |

MCP 与 Skills 的分工：**MCP 决定 Agent 能调用什么服务，Skill 决定 Agent 按什么流程执行**。鹿鸣的审读助手两者都挂载：RAG MCP 让它能查编辑规范，manuscript-check 技能让它按稿件体检流程完成检查。

工程清单（按优先级）：SKILL.md 的 description 写清「何时用」（模型靠它路由）→ 上传流水线预留审核等待（分钟级）→ 挂载锁定具体版本（不追随 latest）→ 说明书里脚本路径写相对用法 → 删除前评估已挂载引用。

## 下一步 <span id="h-cm-next" />

- [技能](managed-agents-skill.md)：SKILL.md 编写规范与字段校验规则。
- [MCP 服务](managed-agents-mcp.md)：MCP 挂载与审批。
- [入门：搭一个数据分析 Agent](managed-agents-data-analysis.md)：内置工具集的用法。
