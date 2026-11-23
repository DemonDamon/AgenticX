# 落盘位置

三种产出（日报、定向搜集、聚焦专题）共用。调用方可以同时指定多个落盘位置，按给出的顺序写，第一个是主位置。

`sinks` 写法：

| 写法 | 含义 |
| --- | --- |
| `local:<目录>` | 本地永久目录 |
| `local-temp` | 本地临时目录 |
| `feishu:<文件夹 / 知识库节点 / 文档的 token 或 URL>` | 飞书指定位置 |
| `feishu` | 飞书「我的文档库」 |
| `github:<owner/repo 或本地路径>:<目录>` | 已有 GitHub 仓库 |
| `github-new:<仓库名>:<目录>` | 新建 GitHub 私有仓库 |

## 产物

| 文件 | 日报 | 定向搜集 | 聚焦专题 |
| --- | --- | --- | --- |
| 正文 | `daily/YYYY-MM-DD.md`（周报为 `weekly/YYYY-Www.md`） | `research/YYYY-MM-DD-<主题短名>/report.md` | `focus/<主题短名>/report.md`，每轮更新同一份 |
| 增量 | 无 | 无 | `focus/<主题短名>/updates/YYYY-MM-DD.md` |
| 来源清单 | 正文末尾的原文索引 | 同目录 `sources.md` | 同目录 `sources.md`，跨轮累积 |
| 过程文件 | 状态目录 `.state/` | `brief.md`、`notes/`、`sources.jsonl` | 状态目录 `focus/<主题短名>/` |
| 图片 | 与正文同目录的 `figures/` | 同左 | 同左 |

`<主题短名>` 用小写英文或拼音加连字符，不超过 40 个字符，例如 `agent-sandbox-isolation`。

## 本地文件夹

**永久目录**（`local:<目录>`）：默认 `./intel`。目录不存在就创建。

- 同一路径已有文件时：日报同一天重跑可以覆盖；定向搜集不覆盖，在目录名后加 `-2`、`-3`；聚焦专题的 `report.md` 每轮原地更新。
- 图片用相对路径引用：`![说明](figures/xxx.png)`。

**临时目录**（`local-temp`）：写到系统临时目录下的 `agx-intel/<日期>-<主题短名>/`（macOS 和 Linux 为 `$TMPDIR` 或 `/tmp`）。

- 适合一次性查询、给另一个智能体中转用的结果。
- 回复时写明完整路径，并提醒「临时目录可能被系统清理，需要保留请另存」。
- 状态文件（快照、账本、偏好、聚焦专题）不能放临时目录。调用方只给了 `local-temp` 时，状态目录改用 `./intel/.state/`。

## 飞书文档或知识库

用本机 `lark-cli`，身份用 `--as user`。

**指定了位置**（文件夹或知识库节点）：

```bash
lark-cli docs +create --as user --doc-format markdown \
  --title "<标题>" --content "@./report.md" \
  --parent-token "<文件夹 token 或知识库节点 token>"
```

调用方给的是知识库 URL 时，先用 `lark-cli wiki +node-get --node-token '<wiki_url>' --as user --format json` 解析出节点 token。

**没指定位置**：写到「我的文档库」。

```bash
lark-cli docs +create --as user --doc-format markdown \
  --title "<标题>" --content "@./report.md" \
  --parent-position my_library
```

**更新已有的一篇**：

- 日报：调用方给了固定文档 token 时更新这篇，不新建。整篇重写用 `docs +update --command overwrite`，会丢掉评论和部分资源，只对专门用于日报的文档这样做。
- 聚焦专题：第一轮新建文档后，把文档 token 记进 `focus.md`；之后每轮更新同一篇，按章节用 `block_replace` 或 `block_insert_after`，保留读者的评论。增量简报每轮新建一篇子文档，挂在专题文档所在的同一位置下。

**其他**：

- 图片按 `figure-extraction.md` 的方法插入。
- `sources.md` 作为正文最后一节写入；`notes/` 和 `sources.jsonl` 不写入飞书，只保留在本地，或按调用方要求上传为附件。
- 拿到返回的 `url` 后把链接告诉用户。返回里有 `warnings` 时一并说明。

## GitHub 仓库

用本地 clone 和 `git` / `gh` 操作，不通过网页上传。

**已有仓库**（`github:<owner/repo 或本地路径>:<目录>`）：仓库还没 clone 时先 clone 到工作目录。

**新建仓库**（`github-new:<仓库名>:<目录>`）：

```bash
gh repo create <仓库名> --private --add-readme --clone \
  --description "情报搜集产出"
```

- 一律建私有仓库。用户明确要求公开时才用 `--public`。
- 交互式使用时，建之前先告诉用户仓库名和可见性，确认后再建。非交互调用时，只有调用方在参数里明确给了 `github-new` 才建。
- 建好后把仓库地址告诉用户，并建议后续改用 `github:<owner/repo>:<目录>` 指向它。

**写入步骤**：

1. 从默认分支新建分支 `intel/YYYY-MM-DD-<主题短名>`，把文件写到目标目录下。新建的空仓库可以直接提交到默认分支。
2. 提交前检查：
   - 只添加本次产物的文件，不要 `git add -A`。
   - 单张图片不超过 5 MB，超过的压缩或不放。
   - 正文和笔记里没有密钥、Token、内部账号、客户名称等不该进仓库的信息。
3. 提交信息只写这次新增了什么，例如 `docs(intel): 更新沙箱隔离专题第 3 轮`。
4. 推送分支，用 `gh pr create` 开 PR，把 PR 链接告诉用户。

只有调用方明确允许时，才直接推到已有仓库的默认分支。仓库是公开仓库、而内容涉及内部资料时，停下来提醒用户确认。

## 落盘失败

- 主位置失败：改写到本地永久目录 `./intel` 下的同名路径，把失败原因原样告诉用户，不要声称已写入。
- 多个位置中有一个失败：其余照常写，最后汇报每个位置的结果。
- 日报模式下，只有主位置写入成功才更新快照和账本。
