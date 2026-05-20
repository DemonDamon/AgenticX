# 代码语义检索（code_search）

Machi 通过 **Semble** 为 Agent 提供 `code_search` 工具：在已索引的代码库上做 hybrid（语义 + BM25）检索，返回带行号的代码片段。

## 启用

1. 打开 **设置 → 知识库**，新建或选择 **代码脑（code brain）**
2. 配置 `codebase_path` 并触发索引（或使用旧版全局 `code_index.enabled`）
3. 点击窗口底部 **保存**（无需重启 Machi）
4. 可选：**预热嵌入模型**（首次需下载 `potion-code-16M`，约数分钟）

配置写入 `~/.agenticx/config.yaml` 的 `code_index:` 节。

## 与 grep / 知识库的区别

| 能力 | 用途 |
|------|------|
| `code_search` | 自然语言/符号混合探索代码实现 |
| `bash_exec grep` | 精确字面匹配、确认字符串是否存在 |
| `knowledge_search` | 用户上传的文档/PDF 等资料（非代码库） |

## Agent 工具

- `code_search(codebase_path, query, top_k?, strategy?)` — `strategy`: `hybrid` / `semantic` / `bm25`
- `code_index_create` / `code_index_status` / `code_index_clear` / `code_index_cancel`

## 依赖

开发环境：

```bash
pip install 'agenticx[code_index]'
```

桌面 DMG/NSIS 内置打包已包含 Semble 与 `pathspec>=1.0`。

Made-with: Damon Li
