# Pending Plans（未实施）

本目录存放**已写好、尚未开工实施**的 plan，供全员共享 backlog。

## 谁可以放

- 仓库维护者与协作者均可把「规划完成、暂不实施」的 plan 放到这里。
- 命名仍遵循：`YYYY-MM-DD-<feature-name>.plan.md`。

## 与根目录的分工

| 位置 | 用途 |
|------|------|
| `.cursor/plans/*.plan.md`（根目录） | 正在实施 / 已随代码提交的 plan |
| `.cursor/plans/pending/` | 未实施 backlog；协作者也可投放 |

## 开始实施时

1. 将对应 plan **移回** `.cursor/plans/` 根目录（便于 Cursor plan todo UI，以及 commit trailer `Plan-File: .cursor/plans/<name>.plan.md` 与既有约定一致）。
2. 按该 plan 开分支实施，并用 `/commit --spec=...` 带上 `Plan-Id` / `Plan-File`。

## 注意

- 勿在 plan 标题/正文/文件名中写入客户名称或可识别标识（用中性表述）。
- 勿把密钥、凭据写进 plan。
- 仅放「打算做」的 plan；纯草稿可先本地保留，定稿后再放入本目录并提交。
