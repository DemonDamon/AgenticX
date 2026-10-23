# SP-F: 案例上云 — 项目 Wiki/案例沉淀为 Enterprise 公司级资产

> **批次**: 独立切片（依赖 SP-A~E 已合入的 agenticx/cases/ 与 delivery 扩展）
> **目标**: 跑通「项目 wiki + 案例条目 → 上报 Enterprise context-service → 公司共享资产 → 后续项目检索消费」端到端闭环
> **验收形态**: 两个隔离目录模拟成员 A/B：A 上报，B 在干净环境检索到 A 的案例并注入新项目

## 架构

```
成员 A（本地）                      Enterprise（context-service, FastAPI）
┌────────────────────┐            ┌────────────────────────────────┐
│ 项目 wiki/ 目录      │──wiki push─►│ POST /context/wiki/push        │
│ case compile --push │────────────►│   批量 ingest + compile        │
└────────────────────┘            │   （SP31 增量编译，进共享 wiki）  │
                                  └────────────────────────────────┘
成员 B（本地干净环境）
┌────────────────────┐            ┌────────────────────────────────┐
│ case search --remote│───────────►│ POST /context/cases/search     │
│ case init --remote  │◄───────────┤ GET  /context/cases/get        │
│  （注入 plan+wiki）   │            │ GET  /context/wiki/list        │
└────────────────────┘            └────────────────────────────────┘
```

## API 契约（F1/F2 共同遵守，先定死）

环境变量：`AGX_CONTEXT_SERVICE_URL`（默认 http://localhost:8420）、`AGX_CONTEXT_SERVICE_TOKEN`

| 接口 | 请求 | 响应 |
|------|------|------|
| `POST /context/wiki/push` | `{"pages": [{"name": "...", "text": "..."}], "compile": true}` | `{"ok", "ingested": n, "compiled": n, "errors": [...]}`；name 必须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`（复用现有 `_SAFE_NAME_RE`）；compile 逐页跑，单页失败记 errors 不中断整体 |
| `POST /context/cases/search` | `{"query": "...", "scope_filter": {"domain": "..."}`, `"top_k": 5}` | `{"ok", "cases": [{"case_id", "title", "summary", "scope": {...}, "lifecycle_status", "matched_on" [...], "score"}]}`；从已入库文档中过滤 frontmatter 含 `case_id:` 的条目，scope_filter 硬过滤（键值相等，无键保守放行） |
| `GET /context/cases/get?case_id=...` | - | `{"ok", "case_id", "content": "<完整 case-entry md 原文>"}` |
| `GET /context/wiki/list` | - | `{"ok", "pages": ["synthesis/xxx.md", ...]}`（storage/wiki/ 下相对路径） |

所有新接口同样要求 `x-agx-internal-token`。frontmatter 解析复用 `agenticx/cases/model.py` 的 `parse_case_md` 逻辑（或 import 该模块——context-service 已依赖核心仓 agenticx 包）。

## SP-F1: context-service 服务端扩展

**只改** `enterprise/apps/context-service/context_service/app.py` + `tests/test_app.py`（追加）：

1. 四个新接口按上表契约实现（wiki/push、cases/search、cases/get、wiki/list）
2. cases/search 实现：向量检索 `runtime.search(query)` → 对每个 hit 读文档原文（documents_dir 下）→ 解析 frontmatter 过滤 `case_id` 存在的 → scope_filter 过滤 → 返回结构化条目。**向量检索只是召回手段，case 判定靠 frontmatter**
3. wiki/push：逐页 `runtime.register_document` + `ingest_document`，compile=true 时逐页 `compiler.compile_source`（SP31 增量：同名未变零 LLM）
4. wiki/list：walk `storage/wiki/**/*.md` 返回相对路径列表
5. 测试（追加到 test_app.py，参考既有测试的 client/token fixture 模式；LLM 依赖的 compile 用 skip 或 mock，参照既有测试对 compile 的处理方式）
6. 验收：`cd enterprise/apps/context-service && python -m pytest tests/ -q` 全绿

**纪律**：不改既有五接口行为；不动核心仓 agenticx/（F2 那边改）；不引入新依赖。

## SP-F2: CLI 客户端云端链路

**改** `agenticx/cases/`（新增 remote.py）+ `agenticx/cli/main.py`（追加命令）：

1. 新增 `agenticx/cases/remote.py`：
   - `push_wiki(wiki_dir, *, url, token) -> dict`：扫描目录 md → POST /context/wiki/push
   - `push_case(entry_md_path, *, url, token)`：POST /context/ingest(name=case_id) + /context/compile
   - `search_cases_remote(query, *, scope_filter, url, token, top_k) -> list[dict]`
   - `get_case_remote(case_id, *, url, token) -> str`（返回 md 原文）
   - HTTP 用 httpx（同步即可）；url/token 参数缺省读环境变量；连接失败抛清晰错误（提示设置环境变量）
2. CLI 追加：
   - `agenticx wiki push [--dir ./wiki] [--url] [--token]`
   - `agenticx case compile --plan <p> [--push]`（--push 时上报后仍落本地）
   - `agenticx case search <q> [--remote] [--domain] [--top-k]`（--remote 走云端，否则本地）
   - `agenticx case init --case <id> --target <dir> [--remote] [--intent]`（--remote：云端取 case md → parse_case_md → init_project_from_case；本地找不到时提示可加 --remote）
3. 测试 `tests/test_case_remote.py`：用 httpx MockTransport/respx 风格 mock（看仓库现有 httpx 测试怎么做，别起真服务），覆盖四条命令的参数拼装、错误处理、--remote 分支
4. 验收：`python -m pytest tests/test_case_remote.py tests/test_case_entry.py tests/test_case_consume.py -q` 全绿

**纪律**：不改 F1 的服务端文件；不破坏本地 case 命令既有行为（--remote 是加法）。

## Master E2E 验收（本人执行）

1. 两个子任务测试全绿
2. 起服务：`CONTEXT_SERVICE_INTERNAL_TOKEN=test-token CONTEXT_STORAGE_ROOT=/tmp/agx-ctx CONTEXT_WIKI_PROVIDER=<ollama> CONTEXT_WIKI_MODEL=qwen3.6:27b uvicorn context_service.app:create_app --factory --port 8420`（provider 名按 ProviderResolver 对 ollama 的实际支持调整）
3. 成员 A（/tmp/member-a，有 cases/ + wiki/）：`case compile --push` + `wiki push`
4. 成员 B（/tmp/member-b，空目录）：`case search "案例库" --remote` 命中 A 的案例 → `case init --remote --case <id> --target proj-new` → 检查注入产物（plan.mdc + wiki 页面 + case_refs）
5. `GET /context/wiki/list` 能看到 A 推上去的 wiki 页面；`GET /context/cases/get` 取回原文与 A 本地一致
6. 重复 push 未变页面 → compile skipped（SP31 增量零 LLM 验证）
