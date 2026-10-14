# acp-14 会话目录隔离与出站域名

Planned-with: Grok 4.7
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

文件工具不能读另一个会话的私有目录。配置了出站域名名单后，远程 MCP 的 HTTP 地址必须落在名单里。名单为空时不额外拦截。

## 落点

- `agenticx/runtime/session_boundary.py`：私有目录 `~/.agenticx/sessions/<id>/work`，以及域名判断。
- `agenticx/cli/agent_tools.py` 的 `_raise_if_path_denied`：解析路径时拒绝别的会话目录。
- `session_manager.create` 写入 `studio_session.session_id` 并创建该目录。
- `agenticx/tools/remote_v2.py`：HTTP / SSE 连接前检查 `runtime.egress_allow_domains`。

## AC

- `pytest tests/test_session_boundary.py -q --no-cov` 通过。
- 会话 A 的文件路径在会话 B 下被拒绝；名单外的主机被拒绝；空名单不拒绝。
