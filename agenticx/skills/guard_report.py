#!/usr/bin/env python3
"""HTML report export for deep skill guard scans.

Author: Damon Li
"""

from __future__ import annotations

import html
from datetime import datetime, timezone
from pathlib import Path

from agenticx.skills.guard_types import ScanResult, finding_to_dict


def render_html_report(result: ScanResult, *, skill_name: str = "", skill_path: str = "") -> str:
    """Render a minimal Near-themed HTML security report."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    rows = []
    for f in result.findings:
        rows.append(
            "<tr>"
            f"<td>{html.escape(f.severity)}</td>"
            f"<td>{html.escape(f.pattern_name)}</td>"
            f"<td>{html.escape(f.category or '')}</td>"
            f"<td>{html.escape(f.file_path)}:{f.line_number}</td>"
            f"<td><code>{html.escape(f.matched_text[:120])}</code></td>"
            "</tr>"
        )
    body_rows = "\n".join(rows) if rows else "<tr><td colspan='5'>No findings</td></tr>"
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>Skill Guard Report — {html.escape(skill_name or skill_path)}</title>
  <style>
    body {{ font-family: system-ui, sans-serif; background: #0f1014; color: #e8e8ec; padding: 2rem; }}
    h1 {{ font-size: 1.25rem; }}
    .meta {{ color: #9ca3af; margin-bottom: 1.5rem; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.875rem; }}
    th, td {{ border: 1px solid #2a2d35; padding: 0.5rem; text-align: left; }}
    th {{ background: #1a1c22; }}
    .grade {{ font-size: 2rem; font-weight: 700; color: #6366f1; }}
  </style>
</head>
<body>
  <h1>Skill 安全扫描报告</h1>
  <div class="meta">
    <div>技能：{html.escape(skill_name or skill_path)}</div>
    <div>时间：{now}</div>
    <div>等级：<span class="grade">{html.escape(result.grade or '—')}</span> · 分数 {result.score if result.score is not None else '—'} · 结论 {html.escape(result.verdict)}</div>
    <div>Tier：{html.escape(result.tier or '—')} · 模式库 {html.escape(result.pattern_set_version or '—')}</div>
  </div>
  <table>
    <thead><tr><th>严重性</th><th>规则</th><th>类别</th><th>位置</th><th>匹配</th></tr></thead>
    <tbody>{body_rows}</tbody>
  </table>
</body>
</html>"""


def write_html_report(result: ScanResult, output_path: Path, **kwargs: str) -> Path:
    """Write HTML report to disk."""
    output_path = Path(output_path).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_html_report(result, **kwargs), encoding="utf-8")
    return output_path
