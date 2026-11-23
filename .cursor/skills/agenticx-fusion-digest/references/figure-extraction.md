# 取图与插图

## 从原文找候选图

1. 只在正文容器里找图：`<article>`、`<main>` 或正文所在的 `div`。导航栏、侧栏、页脚、推荐阅读里的图都不要。
2. 取最高清的地址：优先 `srcset` 里宽度最大的一项，其次 `data-src` / `data-original`（懒加载），最后才是 `src`。相对路径要按页面 URL 补全。
3. 同时记下 `alt`、`<figcaption>` 和图片前后的那段正文。这三样决定它在支撑什么论点。
4. `og:image`、`twitter:image` 和正文第一张横幅图默认视为封面，不进候选。
5. 论文类来源（arXiv、PDF）：优先用论文页里的 HTML 版图片；只有 PDF 时，截取图所在区域并保留图号，例如「原文图 3」。

## 看过再决定

把候选图下载到工作目录的 `figures/`，用多模态能力查看内容，再按 `selection-rubric.md` 的四问判断。看不了图时，至少确认尺寸不小于 600px 宽、图注说明它是数据或结构图；仍拿不准就不放。

文件命名：`<来源简称>-<序号>.<扩展名>`，例如 `anthropic-01.png`，便于在 `digest-selection.md` 里对应。

## 插入目标文档

### 本地 Markdown

```markdown
![对照组与偏向组的最终选择比例](figures/anthropic-01.png)

*图：原文实验结果，看右侧两根柱子的差距。来源：[原文标题](https://...)*
```

图下这一行说明读者该看哪里，并标出处。

GitHub 仓库落盘时同样用这种相对路径写法，图片和正文一起提交。

### 飞书文档（lark-cli）

公开 HTTPS 图片可以在写入正文时直接用 URL，CLI 会下载并上传：

```bash
lark-cli docs +update --as user --doc "<doc_id>" --command block_insert_after \
  --block-id "<目标 block_id>" \
  --content '<img href="https://example.com/figure.png" caption="图：看右侧两根柱子的差距"/>'
```

图片需要登录才能访问、或 URL 不稳定时，先下载到本地，再用 `path` 或 `+media-insert`：

```bash
lark-cli docs +media-insert --as user --doc "<doc_id>" \
  --file ./figures/anthropic-01.png --align center --caption "图：看右侧两根柱子的差距"
```

`+media-insert` 只能插到文末。要把图放在章节中间，整篇重写时在正文里用 `<img path="@./figures/anthropic-01.png"/>`。`--doc` 传 docx 的 `doc_id`，不要直接传 `/wiki/` 链接。

响应格式须为 PNG、JPEG、GIF 或 WebP，单图不超过 20 MiB。SVG 先转成 PNG。

## 不要做

- 不要热链会过期的签名 URL（带 `Expires=`、`X-Amz-Signature=` 等参数），先下载再上传。
- 不要为了配图去搜索引擎找图，只用原文里的图。
- 不要把同一张图在不同章节各放一次。
