"""Pre-tool guard hook: block dangerous shell commands.

Inspects tool calls that may execute shell commands and blocks known
dangerous patterns (rm -rf, DROP TABLE/DATABASE, etc.).

Covers multiple shell-executing tool names beyond just ``bash_exec``.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Optional

import httpx

from agenticx.hooks.types import HookEvent

_SHELL_TOOL_NAMES = frozenset(
    {
        "bash_exec",
        "run_terminal_cmd",
        "shell_exec",
        "terminal",
        "execute_command",
        "run_command",
        "shell",
        "bash",
        "command",
    }
)

_COMMAND_FIELDS = ("command", "cmd", "script", "code", "shell_command")

_RM_PREFIX = r"(?m)(?:^|[;&]|\|\||&&)\s*"
# (pattern, short label for agent-facing block_reason)
_DANGEROUS_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            _RM_PREFIX + r"rm\s+-(?:[\w-]*r[\w-]*f|[\w-]*f[\w-]*r)\b",
            re.IGNORECASE,
        ),
        "rm -rf",
    ),
    (
        re.compile(_RM_PREFIX + r"rm\s+-\w*r\b\s+-\w*f\b", re.IGNORECASE),
        "rm -rf",
    ),
    (
        re.compile(_RM_PREFIX + r"rm\s+-\w*f\b\s+-\w*r\b", re.IGNORECASE),
        "rm -rf",
    ),
    (re.compile(r"\bDROP\s+(TABLE|DATABASE)\b", re.IGNORECASE), "DROP TABLE/DATABASE"),
    (re.compile(r"\bformat\s+[a-zA-Z]:", re.IGNORECASE), "format drive"),
    (
        re.compile(r">\s*/dev/(?:sd[a-z]|r?disk\d)", re.IGNORECASE),
        "write to raw disk device",
    ),
    (re.compile(r"\bmkfs\b", re.IGNORECASE), "mkfs"),
    # macOS 的擦除/建文件系统命令。上面那几条全是 Linux/Windows 的写法，在 darwin 上
    # 一条都不命中 —— 而 `diskutil eraseDisk` 正是「格式化整块盘」在 mac 上的标准说法。
    # 只拦破坏性子命令：`diskutil list` / `info` / `mount` 照常放行。
    (
        re.compile(
            r"\bdiskutil\b[^\n]*\b(?:eraseDisk|eraseVolume|reformat|partitionDisk"
            r"|zeroDisk|randomDisk|secureErase|resetFusion)\b",
            re.IGNORECASE,
        ),
        "diskutil 擦除/重新分区",
    ),
    (
        re.compile(
            r"\bdiskutil\b[^\n]*\bapfs\b[^\n]*\b(?:delete|erase)\w*\b",
            re.IGNORECASE,
        ),
        "diskutil apfs 删除容器/卷",
    ),
    (re.compile(r"\bnewfs_\w+\b", re.IGNORECASE), "newfs_*"),
    (re.compile(r"\bdd\s+.*\bof=/dev/", re.IGNORECASE), "dd to /dev"),
    # Download-and-execute via shell pipe (classic remote script execution).
    (
        re.compile(
            r"\b(?:curl|wget)\b[^\n|]*\|\s*(?:bash|sh|zsh)\b",
            re.IGNORECASE,
        ),
        "curl|wget piped to shell",
    ),
    # Reverse shell-ish patterns.
    (
        re.compile(r"/dev/tcp/\d{1,3}(?:\.\d{1,3}){3}/\d{1,5}", re.IGNORECASE),
        "/dev/tcp reverse shell",
    ),
    (
        re.compile(r"\b(?:nc|ncat|netcat)\b[^\n]*\s(?:-e|--exec)\b", re.IGNORECASE),
        "netcat -e",
    ),
]

_DEFAULT_BLOCK_REASON = "工具调用被 Hook 策略阻止。"


def _set_block_reason(event: HookEvent, detail: str) -> None:
    """Attach an agent-facing reason so callers do not mis-attribute the block."""
    text = str(detail or "").strip() or _DEFAULT_BLOCK_REASON
    event.context["block_reason"] = text


def _reason_for_dangerous_label(label: str) -> str:
    if label == "rm -rf":
        return (
            f"{_DEFAULT_BLOCK_REASON}命中危险模式：`rm -rf`。"
            "请去掉 `rm -rf`/`rm -fr` 后重试；"
            "`git clone` / `curl` 下载 / `gh repo clone` 本身未被禁止。"
            "清理目录请用 `rm -r`（不带 f）、换新目录，或将清理与下载拆成两次 `bash_exec`。"
        )
    if label == "curl|wget piped to shell":
        return (
            f"{_DEFAULT_BLOCK_REASON}命中危险模式：`curl|wget | bash`。"
            "请改为先下载文件再执行，或使用不含管道执行的安装方式；"
            "普通 `curl`/`wget` 下载本身未被禁止。"
        )
    return (
        f"{_DEFAULT_BLOCK_REASON}命中危险模式：{label}。"
        "请去掉该危险片段后重试，不要据此断言网络下载或 clone 被平台禁止。"
    )

_CC_BRIDGE_LOG_TAIL_PATTERN = re.compile(
    r"\btail\b[^\n]*\.agenticx/logs/cc-bridge/.*\.log",
    re.IGNORECASE,
)


def _resolve_shell_command(event: HookEvent) -> str:
    """Extract shell command text from the event context.

    Strategy (in priority order):
    1. Explicit ``context["command"]`` set by the event bridge.
    2. For any known shell tool name, scan ``tool_input`` for
       command-like fields.
    """
    raw = event.context.get("command", "")
    if isinstance(raw, str) and raw.strip():
        return raw

    tool_name = str(event.context.get("tool_name", "")).strip().lower()
    ti = event.context.get("tool_input")

    if tool_name in _SHELL_TOOL_NAMES and isinstance(ti, dict):
        return _extract_command_from_input(ti)

    if isinstance(ti, dict):
        candidate = _extract_command_from_input(ti)
        if candidate:
            return candidate

    return ""


def _extract_command_from_input(ti: dict) -> str:
    """Search tool_input dict for command-like field values."""
    for field in _COMMAND_FIELDS:
        val = ti.get(field, "")
        if isinstance(val, str) and val.strip():
            return val
    return ""


async def _has_active_visible_tui_session() -> bool:
    """Return True when cc-bridge has running visible_tui sessions."""
    try:
        from agenticx.cc_bridge.settings import cc_bridge_base_url, cc_bridge_token

        base = cc_bridge_base_url()
        token = cc_bridge_token()
        headers = {"Authorization": f"Bearer {token}"}
        timeout = httpx.Timeout(5.0, connect=2.0)
        transport = httpx.AsyncHTTPTransport()
        async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
            resp = await client.get(f"{base}/v1/sessions", headers=headers)
        if resp.status_code >= 400:
            return False
        payload = resp.json() if resp.content else {}
        rows = payload.get("sessions") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return False
        for row in rows:
            if not isinstance(row, dict):
                continue
            mode = str(row.get("mode") or "").strip().lower()
            poll = row.get("poll")
            if mode == "visible_tui" and poll is None:
                return True
        return False
    except Exception:
        return False


async def handle(event: HookEvent) -> Optional[bool]:
    if event.type != "tool" or event.action != "before_call":
        return True

    command = _resolve_shell_command(event)
    if not command.strip():
        return True

    if _CC_BRIDGE_LOG_TAIL_PATTERN.search(command):
        if await _has_active_visible_tui_session():
            _set_block_reason(
                event,
                f"{_DEFAULT_BLOCK_REASON}可见 TUI 会话期间禁止用 bash_exec 轮询 cc-bridge 日志；"
                "请向用户报告已投递并等待终端交互。",
            )
            return False

    for pattern, label in _DANGEROUS_PATTERNS:
        if pattern.search(command):
            _set_block_reason(event, _reason_for_dangerous_label(label))
            return False

    return True
