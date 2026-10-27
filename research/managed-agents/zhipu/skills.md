---
source: https://docs.bigmodel.cn/cn/managed-agents/skills
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# Agent Skills

Skill 将领域工作流程、模板和脚本打包给云端 Agent。Agent 先读名称与描述，再按任务读取正文和配套资料，不必每次把整套方法塞进 system prompt。

需要本地编码助手帮你创建 Agent 时，使用[Z Agent Builder](builder-skill.md)；本页介绍云端业务 Skill 的上传、挂载和版本管理。

## 控制台操作

进入 **Managed Agents → 技能**，在技能市场查看并安装所需 Skill，或在已安装列表上传自定义 Skill 包。已有自定义 Skill 可上传新版本；在详情中检查文件内容与版本记录。

回到 **Agent 定义** 添加 Skill，确认所选版本，并启用内置工具集后保存 Agent。已固定的 Session 不会自动切换 Skill；Agent 显式引用版本时需更新引用，引用 `latest` 时则在新建 Session 时解析最新版本。Skill 包结构与版本规则见下文。

### 使用技能市场

打开市场条目，查看发布者、来源、版本和包内容；切换版本后，文件预览与整包下载跟随所选版本。安装后，可在已安装列表查看，再回到 Agent 定义添加引用。安装到技能库后仍需为 Agent 配置该 Skill。

市场列表提供**免责声明**入口，详情显示条目提供的许可证名称；未提供时显示“许可证未提供”。在包文件树中查看 `LICENSE`、`NOTICE` 等法律文件，确认所选版本的授权条件。许可证名称或市场收录本身不代表平台保证 Skill 安全或不存在侵权情形。

下载、安装前请阅读免责声明并评估包内脚本及依赖。如发现侵权或其他问题，可通过[用户协议](https://docs.bigmodel.cn/cn/terms/user-agreement)或[隐私政策](https://docs.bigmodel.cn/cn/terms/privacy-policy)列明的联系方式反馈。

## 选择内置或自定义 Skill

* **内置**：type:zai，以 `GET /v1/skills?source=zai` 查询当前目录，不固定承诺某个名字或版本永远存在。
* **自定义**：type:custom，上传你的 SKILL.md 和所需模板/脚本。

```text theme={null}
financial-modeling/
  SKILL.md
  templates/dcf.xlsx
  references/method.md
```

SKILL.md frontmatter 写 name 和非空 description；正文说清任务流程、何时读参考文件、输出要求。一个 Skill 解决一类任务，避免宽泛触发。

## 上传一个自定义 Skill

```bash theme={null}
skill=$(curl -sS "$BASE_URL/v1/skills" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -F "display_name=Financial Modeling" \
  -F "financial-modeling/SKILL.md=@financial-modeling/SKILL.md" \
  -F "financial-modeling/templates/dcf.xlsx=@financial-modeling/templates/dcf.xlsx")
SKILL_ID=$(jq -r '.id' <<< "$skill")
SKILL_VERSION=$(jq -r '.latest_version_id' <<< "$skill")
```

新协议响应：

```json theme={null}
{
  "id":"skill_example","type":"skill","display_name":"Financial Modeling",
  "source":{"type":"custom"},"latest_version_id":"skver_1759264410641129",
  "created_at":"2026-10-13T00:00:00.000Z","updated_at":"2026-10-13T00:00:00.000Z"
}
```

新协议创建成功回 200，旧协议相关创建接口回 201。文件 part 使用相对路径，所有文件在同一个顶层目录；单版本总量不超过 20 MB、最多 200 个文件，不要依赖服务端截断超量上传。目录冲突返回 409，资源配额超限返回 429。

新协议 display\_name 最大 255 字符；未给时从 Skill 名称派生。一个 Skill 的目录 slug 在首版建立后固定，新版上传不能改变目录名。

## 挂载到 Agent

```json theme={null}
{
  "name":"Financial analyst","model":"glm-5.3",
  "tools":[{"type":"agent_toolset_20260601"}],
  "skills":[{"type":"custom","skill_id":"skill_example","version":"latest"}]
}
```

| 字段 | 用法 |
| - | - |
| type | zai 或 custom |
| skill\_id | 列表/创建返回的实际 ID |
| version | 可省略/null/latest，或显式固定版本 ID/版本串 |

Skill 非空时必须同时声明 agent\_toolset\_20260601；Agent 使用的 Skill 最多 20 个，目录不得重复。运行目录为 `/workspace/skills/<目录名>/`，按需读取。创建 Session 可通过 agent\_with\_overrides 覆盖 skills；Session 中途不能替换 skills。

## latest 何时固定

* 新协议：创建 Session 时，将主 Agent 和 Agent 列表 成员的 latest 解析为具体版本，之后保持固定。
* 新协议 Deployment：每次触发建立新 Session 时解析 latest。
* 旧协议：会话每次沙箱启动时解析 latest，更新 Skill 可能影响后续轮次。
* 显式固定具体版本适合复现与生产验收；latest 适合希望新运行自动采用更新的场景。

## 版本与删除

| 接口 | 用途 |
| - | - |
| POST /v1/skills/:id/versions | 上传完整目录的新版本 |
| GET /v1/skills/:id/versions | 新协议分页版本列表，默认 20、上限 1000；传 page 继续读取，旧协议返回全量 |
| GET /v1/skills/:id/versions/latest | 读取当前 head 版本 |
| GET /v1/skills/:id/versions/:v | 获取版本元数据 |
| GET /v1/skills/:id/versions/:v/content | 下载该版本 ZIP |
| DELETE /v1/skills/:id/versions/:v | 摘牌版本 |
| DELETE /v1/skills/:id | 摘牌整个 Skill |

新协议 SkillVersion 以 id 标识版本，name 表示目录 slug，不再返回独立 version/directory。版本路径仍接受 skver\_ ID、skill\_version\_ ID 和兼容版本串，详见[协议版本](protocol-versions.md)。

新协议的 Skill 与版本列表都支持 `limit` 和 `page`：`limit` 默认 20，大于 1000 时按 1000 返回；将上一页的 `next_page` 原样作为 `page` 传入。旧协议的 Skill 列表上限为 100，版本列表则一次返回全部。

删除不再因配置引用返回 409。被摘牌资源从目录消失，不能用于新 Agent/Session 引用，Deployment 后续触发会失败；已固定的 Session 保留可运行字节，直到最后有效运行引用消失后才回收。不能只删除 Skill 的最后一个在架版本（400），要清空应删除整个 Skill。归档 Agent 不等于立即回收全部运行资源。

## 旧客户端兼容

旧协议仍使用 display\_title、source 字符串、latest\_version；新协议使用 display\_name、source 对象、latest\_version\_id。新协议 Skill 与版本列表都用 data/next\_page；旧 Skill 列表还带 has\_more。先升级字段读取再切换 beta header，不要把一个版本的响应原样当另一个版本请求。

## 下一步

> **[定义 Agent](agent-setup.md)**
>
> 配置 Skills 与工具

> **[创建会话](create-session.md)**
>
> 固定版本与覆盖配置

> **[Z Agent Builder](builder-skill.md)**
>
> 安装到本地助手

> **[协议版本](protocol-versions.md)**
>
> 旧版与新版字段对照


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.