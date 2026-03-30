#!/usr/bin/env python3
"""Mobile-friendly HTML for QR connect flow.

Author: Damon Li
"""

from __future__ import annotations

import html
import json
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agenticx.gateway.connect_session import ConnectSession


def render_connect_page(sess: "ConnectSession", *, page_url: str) -> str:
    """Return HTML document; caller should mark session scanned when serving this."""
    code_display = html.escape(sess.binding_code)
    sid = html.escape(sess.session_id)
    expires_ms = int(sess.expires_at * 1000)
    remaining_sec = max(0, int(sess.expires_at - time.time()))

    data_json = json.dumps(
        {
            "bindingCode": sess.binding_code,
            "expiresAt": expires_ms,
            "pageUrl": page_url,
        },
        ensure_ascii=False,
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Machi 绑定</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0; padding: 16px; background: #0f1014; color: #e8e8ec; }}
    h1 {{ font-size: 1.1rem; margin: 0 0 12px; }}
    .card {{ background: #1a1b22; border-radius: 12px; padding: 20px; margin-bottom: 16px; }}
    .code {{ font-size: 2rem; font-weight: 700; letter-spacing: 0.15em; text-align: center;
      padding: 16px; background: #0f1014; border-radius: 8px; margin: 12px 0; }}
    button {{ width: 100%; padding: 14px; border: none; border-radius: 8px; font-size: 1rem;
      cursor: pointer; margin-top: 8px; }}
    .primary {{ background: #3b82f6; color: #fff; }}
    .secondary {{ background: #2a2b35; color: #e8e8ec; }}
    .hint {{ font-size: 0.85rem; color: #9ca3af; line-height: 1.5; margin-top: 12px; }}
    .timer {{ text-align: center; color: #f59e0b; font-size: 0.9rem; margin-top: 8px; }}
    a.btn {{ display: block; text-align: center; text-decoration: none; }}
  </style>
</head>
<body>
  <h1>连接 Machi 远程指令</h1>
  <div class="card">
    <div>绑定码（复制后在飞书/企微机器人对话中发送）</div>
    <div class="code" id="code">{code_display}</div>
    <button type="button" class="primary" id="copyBtn">复制「绑定 {code_display}」</button>
    <div class="timer" id="timer">剩余有效时间约 {remaining_sec} 秒</div>
    <p class="hint">
      1. 点上方按钮复制整句消息。<br/>
      2. 打开飞书或企业微信，进入已配置好的机器人会话，粘贴发送。<br/>
      3. 收到「已绑定设备」即完成；Machi 桌面将显示已连接。
    </p>
    <a class="btn secondary" href="https://open.feishu.cn/" target="_blank" rel="noopener">打开飞书开放平台文档</a>
    <a class="btn secondary" href="https://work.weixin.qq.com/" target="_blank" rel="noopener" style="margin-top:8px">打开企业微信</a>
  </div>
  <p class="hint">会话 ID: {sid}</p>
  <script>
    const data = {data_json};
    const fullBind = '绑定 ' + data.bindingCode;
    document.getElementById('copyBtn').onclick = async function() {{
      try {{
        await navigator.clipboard.writeText(fullBind);
        this.textContent = '已复制';
        setTimeout(() => {{ this.textContent = '复制「绑定 ' + data.bindingCode + '」'; }}, 2000);
      }} catch (e) {{
        prompt('请手动复制：', fullBind);
      }}
    }};
    const end = data.expiresAt;
    const timerEl = document.getElementById('timer');
    setInterval(function() {{
      const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
      timerEl.textContent = left > 0 ? ('剩余有效时间约 ' + left + ' 秒') : '已过期，请回到 Machi 重新生成二维码';
    }}, 1000);
  </script>
</body>
</html>"""
