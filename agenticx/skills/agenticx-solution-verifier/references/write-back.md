# 写回飞书文档

动手前读 lark-doc 技能里的 `lark-doc-update.md` 和 `lark-doc-xml.md`，写入用的 XML 以它们为准。

## 写之前

```bash
# 取最新版本，和上次快照逐字比对
lark-cli docs +fetch --doc "<URL>" --detail with-ids --as user > before.json

# 有没有未解决的评论（默认的 fetch 会带 reference_map.comments）
lark-cli docs +fetch --doc "<URL>" --as user > simple.json

# 已有画板有没有被人改过：导出预览，和上一次导出的文件比 md5
lark-cli whiteboard +export --whiteboard-token <token> --output-type preview --output ./cur_d1 --as user
```

版本变了就先看变了什么，再定锚点。评论里有未解决的，不要整表替换。

## 准备片段

每个改动写成一个 XML 片段文件（不带 id 属性），再列一张 `ops.tsv`，制表符分隔：

```text
op	command	block_id	end_block_id	content	cwd	note
A	block_replace	doxcnAAA	doxcnBBB	edit/A.xml		同一父级的连续段落
B	block_insert_after	doxcnCCC		edit/B.xml	wb	含画板，cwd 设到 SVG 所在目录
```

- 同一父级的连续块用一次 `block_replace` 加 `end_block_id`，不要分多次。
- 表格要加行时没有「插行」命令，只能整表替换。用脚本从快照里取原表、改行、去掉 id，不要手抄。
- 标题写 `seq="auto"`，编号自动顺延。

## 执行

```bash
# 先演练，再正式执行
python3 scripts/apply_doc_ops.py --doc "<URL>" --ops edit/ops.tsv --dry --only A,B
python3 scripts/apply_doc_ops.py --doc "<URL>" --ops edit/ops.tsv --base-rev 16
```

每一步带 `--revision-id`，失败即停，日志在 `apply_log.jsonl`。中断后重跑会从日志里取上一步的版本号继续。

演练只检查请求的形态，不校验锚点存不存在，锚点过期了演练也会通过。所以执行前先用 `verify_doc.py` 或一次 fetch，确认 `ops.tsv` 里的每个 block id 都还在最新快照里。

`--content @file` 的文件必须在命令的工作目录之内，不能 `../` 越出去。片段和画板不在同一个目录时，片段用绝对路径，`cwd` 设到画板所在的目录。

## 画板

```bash
# 本地渲染并做几何检查（文字溢出、节点重叠、文字遮挡）
bash scripts/wb.sh d7_chain.svg
```

- 要求 0 error、0 warning，再看 PNG。
- 写入已有画板：`lark-cli whiteboard +update --whiteboard-token <token> --source @./x.svg --input_format svg --idempotent-token <唯一串> --overwrite --as user`。先加 `--dry-run` 看一眼请求。
- 写入后导出预览，用眼睛看。检查器只看几何关系，文字被相邻的形状盖住它查不出来。
- 新画板用 `<whiteboard type="svg" path="@./x.svg"></whiteboard>` 内嵌，路径相对于命令的工作目录。

布局上的坑：

- 多行文字用多个 `<text>`，不要指望自动换行。
- CJK 按 1em、拉丁按 0.6em 估宽度，容器留够。
- 标签和它标注的图形不要放在同一行上重叠，标签放到上面一行。
- 用到的 `marker`、`filter` 都要在 `<defs>` 里定义。

## 回读

```bash
lark-cli docs +fetch --doc "<URL>" --detail with-ids --as user > after.json
python3 scripts/verify_doc.py --old before.json --new after.json --snippets edit/ \
  --protect "会上确认的情况" --expect-missing 96 --table "验收表=指标:10"
```

核对清单：

- 消失的旧 block id 的数量，恰好等于被替换的块数。整表替换时算上表内的段落。
- 没被碰过的 id 一个不少。
- 每个片段的段落都能在新文档里找到。
- 标题编号顺延正确。新插一节后，后面的小节号加一。
- 表格行数、画板 token、代码块。
- 数字逐项对结果文件，取整方式一致。

## 文风

- 不写「值得注意的是」「综上所述」「不仅……而且」。口语里怎么说就怎么写。
- 一句话只说一件事，长了就拆。
- 原文的事实、人名、来源一律保留，只改与代码冲突的那一句。
- 每个合成数字旁边都写「合成数据」或「实测」。
