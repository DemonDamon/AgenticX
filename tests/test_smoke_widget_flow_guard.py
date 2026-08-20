"""Smoke tests for widget_flow_guard text flow diagram detection."""

from __future__ import annotations

from agenticx.runtime.widget_flow_guard import (
    WIDGET_FLOW_MAX_RETRIES_PER_SESSION,
    build_widget_flow_retry_hint,
    contains_text_flow_diagram,
)


def test_detects_fenced_text_block_with_arrows() -> None:
    text = """这是一个方案：

```text
定时触发器（每日 08:00）
  ↓
OpenClaw Skill（自定义爬虫逻辑）
  ↓
微信数据源（微信读书/搜狗/第三方聚合）
  ↓
内容清洗 + 定向过滤（关键词/公众号白名单）
```

以上是基本流程。
"""
    assert contains_text_flow_diagram(text)


def test_detects_inline_arrow_chain() -> None:
    text = """2.2 进阶：中间人代理抓包（MitM）

微信PC客户端 → mitmproxy → 微信服务器
  ↓
拦截 /mp/getappmsgext 等接口
提取 JSON 数据（标题、链接、阅读数、点赞数）
"""
    assert contains_text_flow_diagram(text)


def test_detects_ascii_box_diagram() -> None:
    text = """架构图：
```
┌─────────┐    ┌──────────┐
│ Client  │───>│  Server  │
└─────────┘    └──────────┘
```
"""
    assert contains_text_flow_diagram(text)


def test_normal_text_not_flagged() -> None:
    text = """## 方案说明

这个方案使用了 mitmproxy 作为中间代理。具体步骤：
1. 安装 mitmproxy
2. 配置证书
3. 启动抓包

详见文档：https://docs.mitmproxy.org
"""
    assert not contains_text_flow_diagram(text)


def test_single_arrow_in_prose_not_flagged() -> None:
    text = "用户请求 -> 返回结果，这是正常的描述。"
    assert not contains_text_flow_diagram(text)


def test_code_block_with_real_code_not_flagged() -> None:
    text = """```python
def process(data):
    result = transform(data)
    return result
```"""
    assert not contains_text_flow_diagram(text)


def test_detects_leading_arrow_steps_in_fenced_block() -> None:
    text = """## 实现路径

```
search_reports(keyword="AI")
    → get_report_detail(report_id)
    → AI 提取结构化信息
```
"""
    assert contains_text_flow_diagram(text)


def test_mermaid_block_not_flagged() -> None:
    text = """```mermaid
flowchart LR
    A --> B --> C
```"""
    assert not contains_text_flow_diagram(text)


def test_language_fences_with_hr_between_not_flagged() -> None:
    """Closing ``` of a tagged fence must not start a bare-fence scan.

    Session f8918b11: bash then --- then yaml was treated as a text fence,
    and ``---`` matched ASCII_BOX.
    """
    text = """```bash
echo hi
```

---

```yaml
foo: 1
```
"""
    assert not contains_text_flow_diagram(text)


def test_markdown_table_after_language_fence_not_flagged() -> None:
    text = """```yaml
stream: false
```

| 优先级 | 方案 | 风险 |
|--------|------|------|
| 1 | 工具配置调优 | 无 |
"""
    assert not contains_text_flow_diagram(text)


def test_implication_bullets_with_single_arrow_not_flagged() -> None:
    text = """**判断逻辑**：
- 断开时间高度一致 → 指向固定超时策略
- 断开时间随机 → 指向 idle timeout
- 断开时收到 TCP RST → 主动断开
"""
    assert not contains_text_flow_diagram(text)


def test_consecutive_node_hops_in_prose_still_flagged() -> None:
    text = """客户端 → 公司代理
公司代理 → API 端点
"""
    assert contains_text_flow_diagram(text)


def test_arrow_chain_after_language_fence_still_flagged() -> None:
    text = """```bash
echo hi
```

客户端 → 代理 → 防火墙
  ↓
服务端
"""
    assert contains_text_flow_diagram(text)


def test_retry_hint_includes_hit_snippet() -> None:
    text = """微信PC客户端 → mitmproxy → 微信服务器
  ↓
拦截接口
"""
    hint = build_widget_flow_retry_hint(text)
    assert "命中片段" in hint
    assert "mitmproxy" in hint
    assert hint.startswith("[系统纪律违规]")


def test_widget_flow_max_retries_is_one() -> None:
    assert WIDGET_FLOW_MAX_RETRIES_PER_SESSION == 1
