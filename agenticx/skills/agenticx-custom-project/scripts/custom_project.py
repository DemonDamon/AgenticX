#!/usr/bin/env python3
"""Guide custom AgenticX projects: init mode, upstream decision, issue/PR drafts.

User-facing text is Chinese. This file does not read ~/.agenticx, does not
clone repositories, and does not push to any remote. Network is used only by
``doctor`` (a short TCP probe) and by ``submit --execute`` (GitHub CLI).

Author: Damon Li
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

UPSTREAM_REPO = "DemonDamon/AgenticX"
UPSTREAM_WEB = "https://github.com/DemonDamon/AgenticX"
PIN_EXAMPLE = "0.6.5"
POLICY_VERSION = "v1"

KIND_ALIAS = {
    "bug": "bug",
    "defect": "bug",
    "缺陷": "bug",
    "问题": "bug",
    "feat": "feat",
    "feature": "feat",
    "功能": "feat",
    "新功能": "feat",
    "docs": "docs",
    "doc": "docs",
    "文档": "docs",
    "style": "style",
    "文案": "style",
    "样式": "style",
    "deps": "deps",
    "dep": "deps",
    "依赖": "deps",
    "升级": "deps",
    "security": "security",
    "安全": "security",
}
WHERE_ALIAS = {
    "business": "business",
    "业务": "business",
    "runtime": "runtime",
    "运行时": "runtime",
    "框架": "runtime",
    "protocol": "protocol",
    "协议": "protocol",
    "enterprise": "enterprise",
    "企业": "enterprise",
    "网关": "enterprise",
    "desktop": "desktop",
    "桌面": "desktop",
    "near": "desktop",
    "docs": "docs",
    "文档位置": "docs",
}
TRI_ALIAS = {
    "yes": "yes",
    "y": "yes",
    "true": "yes",
    "1": "yes",
    "是": "yes",
    "已有": "yes",
    "明确": "yes",
    "清楚": "yes",
    "需要": "yes",
    "no": "no",
    "n": "no",
    "false": "no",
    "0": "no",
    "否": "no",
    "没有": "no",
    "不需要": "no",
    "不明确": "no",
    "unknown": "unknown",
    "不确定": "unknown",
    "未知": "unknown",
    "没查": "unknown",
    "不清楚": "unknown",
    "还没查": "unknown",
}
SIZE_ALIAS = {"small": "small", "小": "small", "large": "large", "大": "large"}
AGREED_ALIAS = {"yes": "yes", "是": "yes", "no": "no", "否": "no"}
FIX_ALIAS = {"yes": "yes", "是": "yes", "能": "yes", "no": "no", "否": "no", "不能": "no"}

SECRET_RULES: Tuple[Tuple[str, str, re.Pattern[str]], ...] = (
    ("私钥", "private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    (
        "密钥赋值",
        "assigned-secret",
        re.compile(
            r"(?i)\b(api[_-]?key|secret|password|access[_-]?token|token)\b\s*[:=]\s*\S+"
        ),
    ),
    (
        "令牌前缀",
        "token-prefix",
        re.compile(r"(?i)\b(?:sk|ghp|github_pat)_[A-Za-z0-9_\-]{8,}"),
    ),
    (
        "Bearer 令牌",
        "bearer",
        re.compile(r"(?i)\bbearer\s+[A-Za-z0-9\-._~+/]{8,}"),
    ),
)
IPV4_PRIVATE = re.compile(
    r"\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b"
)
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,40}$")

GLOBAL_DO_NOT = (
    "不要推送到官方仓库的 main 分支。",
    "不要 reset、rebase，也不要覆盖用户已经改过的文件。",
    "不要把客户名称、密钥、内网地址或真实业务数据写进公开的 Issue、PR 或提交说明。",
    "不要因为官方还没合并，就停下已经授权的业务交付。",
)


def configure_stdio() -> None:
    """Keep Chinese readable on Windows consoles that default to a legacy code page."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            continue


def configure_stdio_or_note() -> None:
    configure_stdio()


class InputError(ValueError):
    """User input that should be corrected, not retried blindly."""


def _alias(table: Mapping[str, str], value: str, label: str, allowed: str) -> str:
    key = str(value or "").strip()
    if key not in table and key.lower() in table:
        key = key.lower()
    if key not in table:
        raise InputError(f"{label} 不能是「{value}」。可用值：{allowed}。")
    return table[key]


def normalize(raw: Mapping[str, Any]) -> Dict[str, str]:
    """Validate classify inputs. Raises InputError with a Chinese hint."""
    kind = _alias(
        KIND_ALIAS,
        str(raw.get("kind", "")),
        "改动类型 --kind",
        "bug/缺陷、feat/新功能、docs/文档、style/文案、deps/依赖、security/安全",
    )
    where = _alias(
        WHERE_ALIAS,
        str(raw.get("where", "")),
        "改动位置 --where",
        "business/业务、runtime/运行时、protocol/协议、enterprise/企业、desktop/桌面、docs/文档位置",
    )
    cause = _alias(TRI_ALIAS, str(raw.get("cause_clear", "unknown")), "根因 --cause-clear", "yes/明确、no/不明确、unknown/不清楚")
    size = _alias(SIZE_ALIAS, str(raw.get("size", "small")), "范围 --size", "small/小、large/大")
    others = _alias(
        TRI_ALIAS,
        str(raw.get("others_need", "unknown")),
        "其他人是否需要 --others-need",
        "yes/需要、no/不需要、unknown/不确定",
    )
    upstream = _alias(
        TRI_ALIAS,
        str(raw.get("upstream_has", "unknown")),
        "官方是否已有 --upstream-has",
        "yes/已有、no/没有、unknown/没查",
    )
    agreed = _alias(
        AGREED_ALIAS,
        str(raw.get("maintainer_agreed", "no")),
        "维护者是否同意改 enterprise --maintainer-agreed",
        "yes/是、no/否",
    )
    can_fix = _alias(FIX_ALIAS, str(raw.get("can_fix", "yes")), "这边能否改代码 --can-fix", "yes/能、no/不能")
    return {
        "kind": kind,
        "where": where,
        "cause_clear": cause,
        "size": size,
        "others_need": others,
        "upstream_has": upstream,
        "maintainer_agreed": agreed,
        "can_fix": can_fix,
    }


def _claim(upstream: str, applicable: bool) -> str:
    if not applicable:
        return "not_applicable"
    return {"yes": "has", "no": "missing", "unknown": "unchecked"}[upstream]


def _pack(
    action: str,
    title: str,
    reason: str,
    next_steps: Sequence[str],
    do_not: Sequence[str],
    *,
    must_check: bool,
    issue: bool,
    pr: bool,
    upstream: str,
    claim_applicable: bool,
) -> Dict[str, Any]:
    merged: List[str] = []
    for item in list(do_not) + list(GLOBAL_DO_NOT):
        if item not in merged:
            merged.append(item)
    return {
        "action": action,
        "title": title,
        "reason": reason,
        "next_steps": list(next_steps),
        "do_not": merged,
        "must_check_upstream": must_check,
        "allow_submit_issue": issue,
        "allow_submit_pr": pr,
        "delivery_can_continue": True,
        "upstream_claim": _claim(upstream, claim_applicable),
    }


def classify(raw: Mapping[str, Any]) -> Dict[str, Any]:
    """Return the upstream decision for one change. Pure function, no I/O."""
    fields = normalize(raw)
    kind = fields["kind"]
    where = fields["where"]
    cause = fields["cause_clear"]
    size = fields["size"]
    others = fields["others_need"]
    upstream = fields["upstream_has"]
    agreed = fields["maintainer_agreed"]
    can_fix = fields["can_fix"]

    def local_only(reason: str, extra_do_not: Sequence[str] = ()) -> Dict[str, Any]:
        return _pack(
            "local-only",
            "留在你自己的仓库里做，不要给官方提 Issue 或 PR。",
            reason,
            (
                "在当前仓库完成这次改动。",
                "提交说明只写这次行为变化，不写客户名称。",
            ),
            ("不要开官方 Issue 或 PR。", *extra_do_not),
            must_check=False,
            issue=False,
            pr=False,
            upstream=upstream,
            claim_applicable=False,
        )

    def local_fix(reason: str) -> Dict[str, Any]:
        return _pack(
            "local-fix",
            "先在当前仓库修，现在不必给官方提 PR。",
            reason,
            (
                "只改这一处，并只跑和这次改动有关的测试。",
                "现在不必联网，也不必搜索官方 Issue。",
                "如果同一批里还有同类的小修，以后可以合成一个 PR，不要一行开一个。",
            ),
            ("不要为了这一处去克隆或扫描官方全仓。", "不要把还没确认的「以后同步」写成已经提交。"),
            must_check=False,
            issue=False,
            pr=False,
            upstream=upstream,
            claim_applicable=False,
        )

    def investigate(reason: str) -> Dict[str, Any]:
        return _pack(
            "investigate-local",
            "先在当前仓库把原因查清，先不要找官方。",
            reason,
            (
                "用你已经能复现的步骤在本仓定位。",
                "查清后重新运行 classify：根因明确的小问题会变成「本仓修」。",
                "还没复现步骤时，不要开一个空的官方 Issue。",
            ),
            ("不要为了还没查清的问题做全仓或全历史扫描。",),
            must_check=False,
            issue=False,
            pr=False,
            upstream=upstream,
            claim_applicable=False,
        )

    def check(reason: str) -> Dict[str, Any]:
        return _pack(
            "check-upstream",
            "先只核对官方相关的那一块，再决定移植还是提 PR。",
            reason,
            (
                "只看这次改动涉及的目录、对应测试，以及标题能对上的 Issue 或 PR。",
                "同一批、同一模块已经有结论时，直接复用，不要每个子任务都查一次。",
                "查完后把 --upstream-has 改成 yes 或 no，再运行一次 classify。",
                "现在上不了网：业务继续做。草稿里写「尚未对照最新上游」，不能写成已经检查过最新版本。",
            ),
            ("不要做全历史扫描，也不要开定时同步。", "不要在没核对时创建 PR。"),
            must_check=True,
            issue=False,
            pr=False,
            upstream="unknown",
            claim_applicable=True,
        )

    def port(reason: str) -> Dict[str, Any]:
        return _pack(
            "port",
            "官方已经有了。优先升级依赖或做最小移植，不要重写一遍。",
            reason,
            (
                "优先升级你们锁定的 AgenticX 版本；做不到就只移植需要的那一段及其依赖。",
                "不要为了这一处把整个官方仓库合并进来，也不要恢复已经裁掉的模块。",
                "在现有说明里记下你实际看过的版本或提交号。",
            ),
            ("不要整仓合并或强制所有业务仓使用同一个版本。",),
            must_check=False,
            issue=False,
            pr=False,
            upstream="yes",
            claim_applicable=True,
        )

    def split(reason: str) -> Dict[str, Any]:
        return _pack(
            "split",
            "拆开做：通用部分给官方提 PR，这家业务留在你的仓库。",
            reason,
            (
                "通用部分做成官方仓库里能单独复现的最小改动，并带上相关测试。",
                "客户流程、规则、业务界面和部署配置留在业务仓，可以先交付。",
                "PR 里可以用「业务仓内部记录」关联，不要写客户名称。",
                "现在不能提交时，留下草稿和具体阻塞，并明确说尚未提交。",
            ),
            ("不要把整个业务功能搬进官方运行时。", "不要用真实客户数据当复现材料。"),
            must_check=False,
            issue=True,
            pr=True,
            upstream="no",
            claim_applicable=True,
        )

    def upstream_issue(reason: str, *, must_check: bool, pr: bool) -> Dict[str, Any]:
        return _pack(
            "upstream-issue",
            "给官方开 Issue。现在不要提 PR。" if not pr else "先给官方开 Issue。修复可以另开一个不含敏感信息的 PR。",
            reason,
            (
                "用 draft 写下现象、期望、合成复现步骤、版本和操作系统。",
                "enterprise 目录（门户、管理台、网关）在维护者同意前只开 Issue。",
                "提交失败就把草稿留下，告诉用户尚未提交，并写上失败原因。",
            ),
            ("不要把密钥、利用细节或客户环境写进 Issue。",),
            must_check=must_check,
            issue=True,
            pr=pr,
            upstream=upstream,
            claim_applicable=must_check or upstream != "unknown",
        )

    def upstream_pr(reason: str, *, docs_only: bool = False) -> Dict[str, Any]:
        steps = [
            "从一个新分支提交，PR 目标是官方 main，不要直接推 main。",
            "说明改了什么、怎么验证。测试写改动前后的结果，而不是声称全量全绿。",
            "一个 PR 只做一件事。不能提交时留下草稿，并写明尚未提交。",
        ]
        if docs_only:
            steps.insert(1, "只核对文档正文、链接和 diff。不要为此跑全量测试，也不要读取密钥或启动模型。")
        return _pack(
            "upstream-pr",
            "可以向官方提 PR。业务交付不必等它合并。",
            reason,
            steps,
            ("不要在 PR 里夹带无关功能或客户材料。",),
            must_check=False,
            issue=not docs_only,
            pr=True,
            upstream=upstream,
            claim_applicable=(not docs_only) and upstream != "unknown",
        )

    def ask(reason: str) -> Dict[str, Any]:
        return _pack(
            "ask",
            "还差一个事实，先不要开 Issue 或 PR。",
            reason,
            ("按原因里的问题补上参数后，重新运行 classify。不要猜。",),
            ("不要在事实没齐时创建 PR。",),
            must_check=False,
            issue=False,
            pr=False,
            upstream=upstream,
            claim_applicable=False,
        )

    if can_fix == "no":
        if kind == "feat" and others == "unknown" and where != "enterprise":
            return ask(
                "先分清：这是只给当前项目用的功能，还是不看这家客户的规则、其他 AgenticX 用户也需要？"
                "只给当前项目用就加 --others-need no；其他用户也需要就加 --others-need yes。"
            )
        if where == "business" or (kind == "feat" and others == "no") or (kind == "style" and others != "yes"):
            return local_only("当前仓库的事，而且这边现在不改代码。不要开官方 Issue，交给负责这个仓库的人。")
        if kind == "security":
            return upstream_issue(
                "这边不改官方代码。可以开 Issue 说明现象，但不要写密钥、令牌或利用步骤。",
                must_check=False,
                pr=False,
            )
        return upstream_issue(
            "这边不修改官方代码。可以开一个 Issue，写清你看到的现象、期望、版本和操作系统。不必先把官方仓库克隆下来。",
            must_check=False,
            pr=False,
        )

    if where == "enterprise" and agreed != "yes":
        return upstream_issue(
            "官方仓库里的 enterprise/（员工门户、管理台、Go 网关）不接受事先没有约定的外部 PR。"
            "请只开 Issue。不要附带部署路径、内网地址或客户环境。",
            must_check=kind in {"security", "deps"} and upstream == "unknown",
            pr=False,
        )
    if where == "enterprise" and agreed == "yes":
        return upstream_pr("维护者已经在 Issue 里同意修改 enterprise/。PR 里仍然不要写部署细节和客户信息。")

    if kind == "style" and others != "yes":
        return local_only("文案、样式或客户规则留在当前仓库，不触发上游查阅。")
    if kind == "style" and others == "yes":
        return local_fix("这是大家都会看到的文案。先在有源码的仓库里改。要回报官方时，并进同一批小修，不要为了一句文案单独开 PR。")

    if where == "business":
        if others == "yes" and kind in {"bug", "feat", "security", "deps", "docs"}:
            return ask(
                "你说改动在业务仓库，又说其他用户也需要。请拆开再判断两次："
                "通用部分用 --where runtime；客户部分用 --where business --others-need no。"
                "公开内容只能用合成样例。"
            )
        if kind == "security":
            return local_only(
                "安全问题出在业务仓库。请在本地轮换密钥并修复，不要开公开 Issue，也不要把密钥贴到对话里。",
                ("不要在聊天记录里重复那串密钥。",),
            )
        return local_only("这是业务仓库里的改动，其他 AgenticX 用户不需要。")

    if kind == "security":
        return upstream_issue(
            "这是运行时、桌面或协议上的安全问题。先开 Issue。公开文字不写密钥和利用细节。根因已经明确时，再另提一个最小修复 PR。",
            must_check=upstream == "unknown",
            pr=cause == "yes" and upstream != "unknown",
        )

    if kind == "deps":
        if upstream == "yes":
            return port("官方已经有合适的版本或修复。")
        if upstream == "no":
            return local_only("官方还没有这个依赖结果。各业务仓不必锁成同一个版本。把你们验证过的版本写在本仓。")
        return check("依赖升级要先核对官方当前版本、相关变更和测试。对不上再决定是改本仓的版本锁定，还是提一个通用修复。")

    if kind == "docs":
        if others == "yes":
            return upstream_pr("这是官方文档的问题，可以提一个只改文档的 PR。", docs_only=True)
        if others == "unknown" and where == "docs":
            return ask("这份文档只给当前项目看，还是要改正官方文档？前者加 --others-need no，后者加 --others-need yes。")
        return local_only("文档只影响当前仓库。核对内容、链接和 diff 即可，不必跑全量测试。")

    if kind == "feat":
        if others == "unknown":
            return ask(
                "先回答：不看这家客户的规则，其他 AgenticX 用户是否也需要这个能力？"
                "需要就加 --others-need yes；不需要就加 --others-need no。"
            )
        if others == "no":
            return local_only("这是这家业务才需要的功能，不要推进官方运行时。")
        if upstream == "yes":
            return port("官方已经有相应能力。")
        if upstream == "no":
            return split("核对过：官方还没有这个通用能力。")
        return check("新增可复用的运行时能力之前，必须先做一次有范围的官方核对。同一批已有结论就不要重复查。")

    if kind == "bug":
        if where == "protocol" and size == "large" and others == "no":
            return ask("协议上的大改通常会影响所有接入方。若这真的只是私有扩展，请把它和通用协议拆开，再判断两次。")
        if cause == "yes" and size == "small":
            return local_fix(
                "根因已经明确的小缺陷，默认在当前仓库修并做定向验证，包括共享运行时里的小修。"
                "可以使用你已经知道的官方基线，不要求联网或搜索 Issue。"
            )
        if others == "no" and where != "protocol":
            if cause != "yes":
                return investigate("这是当前项目的问题，而且原因还没查清。")
            return local_fix("这是只影响当前项目的缺陷。")
        if upstream == "yes":
            return port("官方已经有这处修复。移植后删掉被覆盖的本地重复补丁，并写明还没收口的适配。")
        if upstream == "no" and cause == "yes":
            return upstream_pr("核对过官方还没有这处修复，而且根因已经明确。请提最小 PR，不要混入无关功能。")
        if upstream == "no":
            return upstream_issue(
                "核对过官方还没有对应修复，但根因还不清楚。Issue 只写已知现象和合成复现，不要声称已经定位。",
                must_check=False,
                pr=False,
            )
        if cause != "yes" and others != "yes" and where != "protocol":
            return investigate("原因还没查清，也不能确定是所有用户都会遇到的问题。")
        return check("这是较大的共享修复、协议改动，或你准备把它贡献回去。先做有范围的核对。")

    return ask("无法判断。请检查 --kind 和 --where 是否是列出的那些值。")


CLAIM_TEXT = {
    "unchecked": "上游核对：还没做。对外不能写「已检查最新版本」或「已确认官方没有」。",
    "has": "上游核对：按你的标记，官方已有。说明里写上你实际看过的版本或提交号。",
    "missing": "上游核对：按你的标记，官方还没有。说明里写上你看过的版本或提交号。",
    "not_applicable": "上游核对：这次不需要。",
}


def render(result: Mapping[str, Any]) -> str:
    """Format a classify result for a person, not only for another program."""
    lines = [
        f"结论：{result['title']}",
        "",
        f"原因：{result['reason']}",
        "",
        CLAIM_TEXT[str(result["upstream_claim"])],
        "业务交付：可以继续，不必等官方合并。",
        "",
        "接下来：",
    ]
    for index, step in enumerate(result["next_steps"], 1):
        lines.append(f"{index}. {step}")
    lines.append("")
    lines.append("先不要：")
    for item in result["do_not"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append(
        "内部标记："
        f"action={result['action']} "
        f"issue={'yes' if result['allow_submit_issue'] else 'no'} "
        f"pr={'yes' if result['allow_submit_pr'] else 'no'} "
        f"must_check={'yes' if result['must_check_upstream'] else 'no'}"
    )
    return "\n".join(lines)


def scan_secrets(text: str) -> List[Dict[str, Any]]:
    """Return secret hits without echoing the secret itself."""
    hits: List[Dict[str, Any]] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        for label, rule_id, pattern in SECRET_RULES:
            if pattern.search(line):
                hits.append({"line": line_no, "rule": rule_id, "label": label})
                break
    return hits


def redact_private(text: str, hide_words: Sequence[str]) -> str:
    """Replace private IPs and caller-supplied names. Does not try to guess customers."""
    redacted = IPV4_PRIVATE.sub("内网地址已隐藏", text)
    for word in hide_words:
        cleaned = word.strip()
        if len(cleaned) < 2:
            continue
        redacted = redacted.replace(cleaned, "[已隐藏]")
    return redacted


def secret_report(hits: Sequence[Mapping[str, Any]]) -> str:
    if not hits:
        return ""
    lines = [
        "草稿里有不能公开的内容，文件没有写入，也没有提交。",
        "请删掉对应行里的密钥后再运行。不要把密钥发给助手，也不要贴进 Issue。",
    ]
    for hit in hits:
        lines.append(f"- 第 {hit['line']} 行：{hit['label']}")
    return "\n".join(lines)


def python_launch(executable: Optional[str] = None) -> str:
    exe = executable or sys.executable
    if " " in exe:
        return f'"{exe}"'
    return exe


def _newer_python() -> Optional[str]:
    for candidate in ("python3.13", "python3.12", "python3.11", "python3.10"):
        found = shutil.which(candidate)
        if found:
            return found
    return None


def install_python() -> str:
    """Interpreter that is allowed to pip-install AgenticX. Empty when none is new enough."""
    if sys.version_info >= (3, 10):
        return python_launch()
    newer = _newer_python()
    if newer:
        return python_launch(newer)
    return ""


def _low_python_warning() -> str:
    if sys.version_info >= (3, 10):
        return ""
    newer = _newer_python()
    if newer:
        return (
            f"注意：当前脚本跑在 Python {sys.version_info.major}.{sys.version_info.minor} 上，不能用来安装 AgenticX。"
            f"下面的安装命令已改成 {newer}。"
        )
    return (
        f"注意：当前解释器是 {sys.version_info.major}.{sys.version_info.minor}，低于 3.10。"
        "下面先不要执行 pip。请安装 Python 3.10 或更高后再运行 plan。"
    )


def os_label() -> str:
    if sys.platform == "win32":
        return "Windows"
    if sys.platform == "darwin":
        return "macOS"
    return "Linux"


def other_os_hint() -> str:
    if sys.platform == "win32":
        return "同事如果用 macOS 或 Linux，把下面命令里的 Python 路径换成 python3。"
    return "同事如果用 Windows，在「命令提示符」里用 py -3 代替 python3。中文乱码时先执行 set PYTHONUTF8=1。"


def _tcp(host: str, port: int, timeout: float = 3.0) -> Optional[str]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return None
    except OSError as exc:
        return str(exc)


def _run(cmd: Sequence[str], timeout: int) -> Tuple[int, str]:
    try:
        completed = subprocess.run(
            list(cmd),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return 124, f"命令超过 {timeout} 秒还没有返回。"
    except OSError as exc:
        return 127, str(exc)
    output = (completed.stdout or "") + (completed.stderr or "")
    return completed.returncode, output.strip()


def doctor() -> Tuple[str, int]:
    """Check the local machine. Never reads ~/.agenticx or environment secrets."""
    version = sys.version_info
    py_ok = (version.major, version.minor) >= (3, 10)
    lines = [
        f"系统：{os_label()}",
        f"Python：{version.major}.{version.minor}.{version.micro}（{sys.executable}）",
    ]
    exit_code = 0
    if py_ok:
        lines.append("Python 版本：符合 3.10 或更高，可以用来安装 AgenticX。")
    else:
        exit_code = 1
        lines.append(
            f"Python 版本：{version.major}.{version.minor} 低于 AgenticX 要求的 3.10。"
            "检查会继续，但不要用这个解释器执行 pip install agenticx。"
        )
        newer = _newer_python()
        if newer:
            lines.append(f"下一步：改用已经装好的更高版本重跑本脚本：\"{newer}\"")
        elif sys.platform == "win32":
            lines.append("下一步：从 python.org 安装 Python 3.10 或更高，并勾选 Add python.exe to PATH。装完后关掉窗口再开一个。不要改系统目录。")
        else:
            lines.append("下一步：安装 Python 3.10 或更高。不要为了过这一关去改系统自带的旧 Python。")

    git_path = shutil.which("git")
    if git_path:
        lines.append(f"Git：已找到（{git_path}）。分叉模式才需要它。只装依赖时可以先不用。")
    else:
        lines.append("Git：没找到。只通过 pip 使用官方包时可以先不装。")
        lines.append("下一步：要分叉源码时再安装 Git。Windows 安装包在 https://git-scm.com/download/win 。装完后重开终端。")

    agx_path = shutil.which("agx")
    if not agx_path:
        launch = install_python()
        lines.append("agx 命令：没找到。还没安装 AgenticX，或安装后没有进入当前窗口的命令路径。")
        if launch:
            lines.append(f"下一步：执行 {launch} -m pip install agenticx")
        else:
            lines.append("下一步：先安装 Python 3.10 或更高，再执行 pip install agenticx。不要用当前这个旧解释器。")
        lines.append("若提示命令不存在：关掉终端再开一次。Windows 还要确认 Python 的 Scripts 目录在 PATH 里。")
    else:
        code, output = _run([agx_path, "--version"], 20)
        if code == 0:
            first = output.splitlines()[0] if output else "有输出但没有版本行"
            lines.append(f"agx 命令：可用。{first}")
        elif code == 124:
            lines.append("agx 命令：找到了，但 20 秒内没有返回。这通常是 Python 冷启动慢，不是项目创建失败。")
            lines.append(f"下一步：再直接执行一次 \"{agx_path}\" --version。仍无输出时，把完整报错留下来。")
        else:
            lines.append("agx 命令：找到了，但执行失败。")
            lines.append(f"下一步：看这段输出里的最后一行原因：{output.splitlines()[-1] if output else '没有输出'}")

    gh_path = shutil.which("gh")
    if gh_path:
        lines.append(f"GitHub CLI：已找到（{gh_path}）。没有登录也可以先写草稿。")
    else:
        lines.append("GitHub CLI：没找到。不影响分类和写草稿。")
        lines.append("下一步：提交时用浏览器打开官方仓库即可，不必为了写草稿安装 gh。")

    github_error = _tcp("github.com", 443)
    if github_error is None:
        lines.append("连接 github.com:443：成功。这只说明网络能到达，不代表已经登录或已经看过最新代码。")
    else:
        lines.append("连接 github.com:443：失败。国内网络里这很常见，不是你的项目坏了。")
        lines.append(f"原因：{github_error}")
        lines.append("下一步：分类和草稿可以离线完成。不要说已经看过最新官方代码，也不要说已经提交。稍后再试，或把草稿交给能打开 GitHub 的人。")

    pypi_error = _tcp("pypi.org", 443)
    if pypi_error is None:
        lines.append("连接 pypi.org:443：成功。")
    else:
        lines.append("连接 pypi.org:443：失败。pip 安装官方包会超时或报无法连接。")
        lines.append(f"原因：{pypi_error}")
        lines.append("下一步：先用你们单位已有的包镜像。没有的话，只对这一次安装使用清华镜像，不要改全局 pip 配置：")
        mirror_py = install_python() or "python3"
        lines.append(f"{mirror_py} -m pip install agenticx -i https://pypi.tuna.tsinghua.edu.cn/simple")

    lines.append(other_os_hint())
    lines.append("本检查不会读取 ~/.agenticx，也不会上传任何文件。")
    return "\n".join(lines), exit_code


def project_dest(parent: Path, name: str) -> Path:
    if not NAME_RE.fullmatch(name):
        raise InputError("项目名只能用字母、数字、下划线和短横线，并且以字母开头。例如 my-agent。不要用空格、中文或 .. 。")
    root = parent.expanduser().resolve()
    dest = (root / name).resolve()
    if dest.parent != root:
        raise InputError("项目路径跑到了目标目录外面。请换一个名字。")
    return dest


def _agents_short() -> str:
    return f"""# 与 AgenticX 的关系

本仓库通过依赖使用 AgenticX（上游协作条款 {POLICY_VERSION}），不在这里修改框架源码。

- 客户流程、文案、规则和部署配置留在本仓库。
- 根因已经明确的小缺陷，在本仓库修。不要为了每一处都去扫官方仓库。
- 其他用户也需要的新能力，或准备回报官方时，先做一次有范围的核对，再向 {UPSTREAM_WEB} 提 Issue 或 PR。
- 公开内容不写客户名称、密钥、内网地址和真实业务数据。
- 若本仓库后来改成了分叉或精简拷贝，并且根目录已经有 `agenticx-upstream-policy` 标记段，不要改写那段原文。
"""


def _gitignore() -> str:
    return """
.env
.venv/
__pycache__/
.agenticx-upstream/
*.pem
*.key
""".lstrip()


def _readme_python(name: str) -> str:
    launch = "python3" if sys.platform != "win32" else "py -3"
    return f"""# {name}

基于 AgenticX 的业务项目。框架来自官方发布包，业务代码留在本仓库。

写作这份骨架时，官方示例版本是 {PIN_EXAMPLE}。安装前请以你机器上的 `agx --version` 或 PyPI 上的当前版本为准，不要把示例版本当成永远最新。

## 安装

```bash
{launch} -m pip install "agenticx=={PIN_EXAMPLE}"
```

装不上时，先看技能里的「安装失败」：超时多半是连不上 pypi.org，不要把它当成代码错误。

## 接下来

1. 把 `.env.example` 复制成 `.env`，密钥只放在 `.env`。
2. 业务代码写在 `main.py`。
3. 不要把客户材料提交到任何公开仓库。
"""


def _readme_node(name: str) -> str:
    return f"""# {name}

这个目录是业务侧程序，通过本机已经装好的 AgenticX 运行时工作，不复制框架源码。

## 本机运行时

官方桌面或 `agx serve` 启动后，端口写在用户目录的 `serve.port` 文件里：

- macOS / Linux：`~/.agenticx/serve.port`
- Windows：`%USERPROFILE%\\.agenticx\\serve.port`

本技能不读取这个文件，因为它旁边还有令牌文件。请你自己打开端口文件。

检查服务时不要走系统代理：

```bash
curl --noproxy "*" http://127.0.0.1:端口/api/session
```

Windows 10 及以上自带 curl。若返回连接失败，先确认运行时已经启动，而不是先改业务代码。

## 版本

把你们实际安装的 AgenticX 版本写在这里。示例版本 {PIN_EXAMPLE} 只是骨架生成时的上游版本。
"""


def _upstream_notes() -> str:
    return f"""# 精简拷贝记录

- 官方仓库：{UPSTREAM_WEB}
- 实际对齐的版本或提交号：（填写你看过的那一个，没看过就写「尚未对照」）
- 拷贝了哪些目录：
- 故意没拷的模块：
- 本地补丁：
- 许可证：Apache-2.0。保留上游的许可证、署名和 NOTICE，不要删。

不要为了补一个功能把整个官方仓库合并进来，也不要恢复已经决定不带的模块。
"""


def render_plan(mode: str, stack: str, name: str) -> str:
    """Return the human instructions for one init mode. Does not touch the network."""
    launch = install_python() or python_launch()
    pip_install = (
        f"{install_python()} -m pip install \"agenticx=={PIN_EXAMPLE}\""
        if install_python()
        else "（先安装 Python 3.10 或更高，再运行 plan。这一步先不要 pip。）"
    )
    dest_hint = name
    lines = [f"系统：{os_label()}", f"项目名：{name}", ""]
    warning = _low_python_warning()
    if warning and stack == "python":
        lines += [warning, ""]
    if mode == "depend" and stack == "desktop":
        lines += [
            "结论：直接安装官方桌面版即可，不必为了使用它新建仓库。",
            "macOS 与 Windows 安装包在 https://www.agxbuilder.com/ 。",
            "只有要改桌面源码时，才改用 --mode fork --stack desktop。",
            "本命令没有创建文件。",
        ]
        return "\n".join(lines)
    if mode == "depend" and stack == "python":
        lines += [
            "结论：新建业务仓库，用官方发布包装 AgenticX。不要克隆框架源码。",
            "",
            "推荐命令（复制这一行；若上面有版本提示，以提示里的解释器为准）：",
            pip_install,
            "",
            "装好并且 `agx` 可用时，再用官方脚手架。它若询问「目录已存在，是否覆盖」，回答否，除非用户明确说可以覆盖。",
            f"agx project create {dest_hint} --template basic",
            "",
            "模板只有 basic、multi_agent、enterprise 三个名字。",
            "这里的 enterprise 模板只是一个带监控示例的应用骨架，不是官方仓库里的 enterprise/ 目录。那个目录不接受未约定的外部 PR。",
            "",
            other_os_hint(),
            "pip 超时见 doctor 给出的镜像命令。不要擅自改全局 pip 配置。",
        ]
        return "\n".join(lines)
    if mode == "depend" and stack == "node":
        lines += [
            "结论：业务程序单独建仓库，调用本机 AgenticX，不复制框架源码。",
            "先确认本机 `agx serve` 或官方桌面已经在运行，再写业务代码。",
            other_os_hint(),
        ]
        return "\n".join(lines)
    if mode == "fork":
        lines += [
            "结论：只有必须修改官方源码、并且要长期跟着官方升级时才分叉。",
            "客户业务不要写进这个分叉里。业务放到另一个仓库，用依赖方式引用版本。",
            "本技能不会克隆仓库，也不会修改 git remote。",
            "",
            "请你自己执行：",
            f"git clone {UPSTREAM_WEB}.git {dest_hint}",
            f"cd {dest_hint}",
            "git remote rename origin upstream",
            "git remote add origin <你的远程地址>",
            f"{launch} -m pip install -e \".[dev]\"",
            "",
            "不要执行 git push upstream，也不要推 main。",
        ]
        if stack == "desktop":
            lines += [
                "",
                "桌面源码在 desktop/ 目录：",
                "cd desktop",
                "npm install",
                "npm run dev",
                "Windows 若要编译终端组件，按官方说明重装 node-pty。不要在没改桌面代码时做这一步。",
            ]
        lines.append(other_os_hint())
        return "\n".join(lines)
    if mode == "vendor":
        lines += [
            "结论：只复制需要的那一段运行时，不整仓带走。",
            "本技能不会从官方仓库拉代码。",
            "",
            "你需要自己做的事：",
            "1. 记下实际看过的官方版本或提交号。没看过就写尚未对照。",
            "2. 只复制这次要用的目录，以及它真正依赖的文件。",
            "3. 保留 Apache-2.0 许可证、署名和 NOTICE。",
            "4. 在 UPSTREAM_NOTES.md 写清裁剪范围和本地补丁。",
            "5. 不要恢复你已经决定不带的模块。",
            other_os_hint(),
        ]
        return "\n".join(lines)
    raise InputError("模式只能是 depend（只装依赖）、fork（分叉源码）或 vendor（精简拷贝）。技术栈只能是 python、node 或 desktop。")


def write_plan(mode: str, stack: str, dest: Path) -> str:
    """Create a business skeleton. Refuses to overwrite or to clone upstream."""
    if mode == "fork" or (mode == "depend" and stack == "desktop"):
        return render_plan(mode, stack, dest.name) + "\n\n没有写入文件。"
    if dest.exists() and any(dest.iterdir()):
        raise InputError(f"目录 {dest} 里已经有文件。没有覆盖任何东西。请换一个项目名，或清空该目录后再试。")
    dest.mkdir(parents=True, exist_ok=True)
    (dest / ".gitignore").write_text(_gitignore(), encoding="utf-8")
    (dest / "AGENTS.md").write_text(_agents_short(), encoding="utf-8")
    if mode == "vendor":
        (dest / "UPSTREAM_NOTES.md").write_text(_upstream_notes(), encoding="utf-8")
        return render_plan(mode, stack, dest.name) + f"\n\n已写入空的记录目录：{dest}"
    if stack == "python":
        (dest / "README.md").write_text(_readme_python(dest.name), encoding="utf-8")
        (dest / "requirements.txt").write_text(f"agenticx=={PIN_EXAMPLE}\n", encoding="utf-8")
        (dest / ".env.example").write_text("OPENAI_API_KEY=\n", encoding="utf-8")
        (dest / "main.py").write_text(
            '"""Business entry. Put product code here after installing AgenticX.\n\nAuthor: project owner\n"""\n\n\ndef main() -> None:\n    print("业务代码写在这里。不要提交 .env 或客户材料。")\n\n\nif __name__ == "__main__":\n    main()\n',
            encoding="utf-8",
        )
    elif stack == "node":
        (dest / "README.md").write_text(_readme_node(dest.name), encoding="utf-8")
        (dest / "package.json").write_text(
            json.dumps(
                {
                    "name": dest.name,
                    "private": True,
                    "description": "Calls a local AgenticX runtime. Does not vendor the framework.",
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    else:
        raise InputError("这个组合不能自动写文件。请看上面的说明自己执行。")
    return render_plan(mode, stack, dest.name) + f"\n\n已写入：{dest}\n草稿目录 .agenticx-upstream/ 已在 gitignore 中，避免没检查完的笔记被提交。"


def build_draft(
    *,
    kind: str,
    title: str,
    summary: str,
    expected: str,
    actual: str,
    steps: str,
    version: str,
    os_name: str,
    python_version: str,
    upstream_note: str,
    tests: str,
    hide_words: Sequence[str],
) -> str:
    if kind not in {"issue", "pr"}:
        raise InputError("草稿类型只能是 issue 或 pr。")
    if not title.strip():
        raise InputError("标题是空的。请用一句话写用户能看懂的现象或需求。")
    if "\n" in title or "\r" in title:
        raise InputError("标题不能换行。")
    if len(title.strip()) > 120:
        raise InputError("标题超过 120 个字。请缩短成一句话。")
    checked = upstream_note.strip() or "尚未对照最新上游。不能据此声称已检查最新版本。"
    heading = "问题说明" if kind == "issue" else "改动说明"
    test_block = ""
    if kind == "pr":
        test_block = f"\n## 怎么验证\n\n{tests.strip() or '（填写改动前后各跑了哪一个测试，结果是什么。不要只写全量测试全绿。）'}\n"
    body = f"""<!-- 状态：尚未提交。确认没有客户信息和密钥之后，再由你自己提交到 GitHub。 -->

# {title.strip()}

## {heading}

{summary.strip() or "（用两句话说明用户可见的现象或希望增加的能力。）"}

## 期望

{expected.strip() or "（期望发生什么。）"}

## 实际

{actual.strip() or "（实际发生了什么。没有日志就写「无」。）"}

## 复现步骤

使用合成数据。不要粘贴客户材料、导出的业务文件或真实对话。

{steps.strip() or "1. （第一步）"}

## 环境

- AgenticX 版本：{version.strip() or "（agx --version 的输出；不知道就写未知）"}
- 操作系统：{os_name.strip() or os_label()}
- Python：{python_version.strip() or "（python --version；与运行时无关就写不适用）"}

## 对照上游

{checked}
{test_block}
## 公开前确认

- 没有客户名称、密钥、令牌、私钥、内网地址和真实业务数据
- 若涉及 enterprise/（门户、管理台、网关），只开 Issue，除非维护者已经在 Issue 里同意
- 目标仓库是 {UPSTREAM_WEB} ，PR 指向 main，但不直接推送 main
"""
    return redact_private(body, hide_words)


def draft_path(root: Path, kind: str) -> Path:
    folder = root / ".agenticx-upstream"
    folder.mkdir(parents=True, exist_ok=True)
    name = "ISSUE.md" if kind == "issue" else "PR.md"
    return folder / name


def submission_blockers(result: Mapping[str, Any], want: str, hits: Sequence[Mapping[str, Any]]) -> List[str]:
    """Reasons that must stop a public submit. Empty list means the gates passed."""
    blockers: List[str] = []
    if hits:
        blockers.append("草稿仍有密钥或私钥，尚未提交。")
    if want == "issue" and not result["allow_submit_issue"]:
        blockers.append("当前结论是留在本仓或先补事实，不能创建官方 Issue。尚未提交。")
    if want == "pr" and not result["allow_submit_pr"]:
        blockers.append("当前结论不能创建 PR。尚未提交。若还没对照上游，请先做有范围的核对，或只保留草稿。")
    return blockers


def gh_argv(want: str, repo: str, title: str, body_file: Path) -> List[str]:
    if not REPO_RE.fullmatch(repo):
        raise InputError("仓库名只能是 owner/name，例如 DemonDamon/AgenticX。")
    if want not in {"issue", "pr"}:
        raise InputError("提交类型只能是 issue 或 pr。")
    if "\n" in title or "\r" in title:
        raise InputError("标题不能换行。")
    noun = "issue" if want == "issue" else "pr"
    return ["gh", noun, "create", "--repo", repo, "--title", title, "--body-file", str(body_file)]


def execute_gh(argv: Sequence[str]) -> Tuple[int, str]:
    if shutil.which("gh") is None:
        return 127, "没有找到 gh。尚未提交。可以用浏览器打开 https://github.com/DemonDamon/AgenticX/issues/new 把草稿贴进去。"
    code, output = _run(argv, 45)
    if code == 0:
        return 0, output or "GitHub CLI 已返回成功。"
    tail = output.splitlines()[-1] if output else "没有输出"
    return code, f"GitHub CLI 失败，尚未提交。最后一行：{tail}"


def self_test() -> Tuple[str, int]:
    """Run the decision table, redaction, and skeleton writer without network."""
    cases = [
        ({"kind": "style", "where": "business"}, "local-only", False, False),
        ({"kind": "bug", "where": "runtime", "cause_clear": "yes", "size": "small", "others_need": "yes"}, "local-fix", False, False),
        ({"kind": "feat", "where": "runtime", "others_need": "yes", "upstream_has": "unknown"}, "check-upstream", False, False),
        ({"kind": "feat", "where": "runtime", "others_need": "yes", "upstream_has": "yes"}, "port", False, False),
        ({"kind": "feat", "where": "runtime", "others_need": "yes", "upstream_has": "no"}, "split", True, True),
        ({"kind": "feat", "where": "business", "others_need": "no"}, "local-only", False, False),
        ({"kind": "bug", "where": "enterprise"}, "upstream-issue", True, False),
        ({"kind": "bug", "where": "enterprise", "maintainer_agreed": "yes"}, "upstream-pr", True, True),
        ({"kind": "security", "where": "business"}, "local-only", False, False),
        ({"kind": "security", "where": "runtime", "upstream_has": "unknown"}, "upstream-issue", True, False),
        ({"kind": "security", "where": "runtime", "cause_clear": "yes", "upstream_has": "no"}, "upstream-issue", True, True),
        ({"kind": "deps", "where": "runtime", "upstream_has": "yes"}, "port", False, False),
        ({"kind": "deps", "where": "runtime", "upstream_has": "unknown"}, "check-upstream", False, False),
        ({"kind": "feat", "where": "runtime", "others_need": "unknown"}, "ask", False, False),
        ({"kind": "bug", "where": "runtime", "cause_clear": "unknown", "size": "small", "others_need": "no"}, "investigate-local", False, False),
        ({"kind": "docs", "where": "business", "others_need": "no"}, "local-only", False, False),
        ({"kind": "docs", "where": "docs", "others_need": "yes"}, "upstream-pr", False, True),
        ({"kind": "bug", "where": "protocol", "cause_clear": "yes", "size": "small"}, "local-fix", False, False),
        ({"kind": "bug", "where": "protocol", "cause_clear": "yes", "size": "large", "upstream_has": "unknown", "others_need": "yes"}, "check-upstream", False, False),
        ({"kind": "bug", "where": "protocol", "cause_clear": "yes", "size": "large", "upstream_has": "no", "others_need": "yes"}, "upstream-pr", True, True),
        ({"kind": "bug", "where": "runtime", "cause_clear": "yes", "size": "large", "others_need": "yes", "upstream_has": "no"}, "upstream-pr", True, True),
        ({"kind": "feat", "where": "desktop", "others_need": "no"}, "local-only", False, False),
        ({"kind": "缺陷", "where": "运行时", "cause_clear": "明确", "size": "小", "others_need": "需要"}, "local-fix", False, False),
        ({"kind": "bug", "where": "desktop", "cause_clear": "yes", "size": "small", "can_fix": "no"}, "upstream-issue", True, False),
        ({"kind": "bug", "where": "enterprise", "size": "small", "cause_clear": "yes"}, "upstream-issue", True, False),
    ]
    failures: List[str] = []
    for raw, action, allow_issue, allow_pr in cases:
        got = classify(raw)
        if got["action"] != action or got["allow_submit_issue"] != allow_issue or got["allow_submit_pr"] != allow_pr:
            failures.append(
                f"{raw} 期望 {action}/issue={allow_issue}/pr={allow_pr}，"
                f"实际 {got['action']}/issue={got['allow_submit_issue']}/pr={got['allow_submit_pr']}"
            )
        rendered = render(got)
        if not rendered.startswith("结论："):
            failures.append(f"{raw} 的说明没有以「结论」开头")
        if "业务交付：可以继续" not in rendered:
            failures.append(f"{raw} 没有说明业务可以继续")

    sample = "pass" + "word=example\n"
    blocked = scan_secrets(sample)
    if not blocked:
        failures.append("密钥赋值没有被拦住")
    if scan_secrets("Token 按次计量，没有赋值。\n" + "pass" + "word=\n"):
        failures.append("普通说明被误判成密钥")
    leaked = "请连接 192.168.1.20 并提到示例客户甲"
    hidden = redact_private(leaked, ["示例客户甲"])
    if "192.168.1.20" in hidden or "示例客户甲" in hidden:
        failures.append("内网地址或指定名称没有隐藏")
    report = secret_report(blocked)
    if "example" in report:
        failures.append("报错把密钥本身打印出来了")

    draft = build_draft(
        kind="issue",
        title="保存会话后列表仍显示旧标题",
        summary="切换会话再回来，标题变成了数字。",
        expected="显示原来的中文标题。",
        actual="显示 session id。",
        steps="1. 用合成账号登录。",
        version=PIN_EXAMPLE,
        os_name="Windows 11",
        python_version="3.12",
        upstream_note="",
        tests="",
        hide_words=(),
    )
    if "尚未提交" not in draft or "尚未对照最新上游" not in draft:
        failures.append("Issue 草稿缺少未提交或未核对声明")
    if scan_secrets(draft):
        failures.append("空白草稿被自己的模板误伤")

    blockers = submission_blockers(
        classify({"kind": "feat", "where": "runtime", "others_need": "yes", "upstream_has": "unknown"}),
        "pr",
        [],
    )
    if not blockers:
        failures.append("还没核对上游时，PR 不应该被放行")
    issue_ok = submission_blockers(
        classify({"kind": "bug", "where": "enterprise"}),
        "issue",
        [],
    )
    if issue_ok:
        failures.append("enterprise 的 Issue 不应该被拦住")
    try:
        gh_argv("pr", UPSTREAM_REPO, "fix(runtime): 小修", Path("PR.md"))
    except InputError as exc:
        failures.append(f"合法仓库名被拒绝：{exc}")
    try:
        gh_argv("pr", "https://evil.example/repo", "标题", Path("PR.md"))
        failures.append("非法仓库名没有被拒绝")
    except InputError:
        pass

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        dest = project_dest(root, "my-agent")
        write_plan("depend", "python", dest)
        required = ["README.md", "AGENTS.md", ".gitignore", "requirements.txt", "main.py", ".env.example"]
        for name in required:
            if not (dest / name).is_file():
                failures.append(f"骨架缺少 {name}")
        if "OPENAI_API_KEY=\n" not in (dest / ".env.example").read_text(encoding="utf-8"):
            failures.append("示例环境文件不应该写入真实密钥")
        marker = dest / "README.md"
        marker.write_text(marker.read_text(encoding="utf-8") + "\n保留\n", encoding="utf-8")
        try:
            write_plan("depend", "python", dest)
            failures.append("第二次写入覆盖了已有目录")
        except InputError:
            if "保留" not in marker.read_text(encoding="utf-8"):
                failures.append("拒绝覆盖时改动了原文件")
        fork_dest = root / "fork-me"
        write_plan("fork", "python", project_dest(root, "fork-me"))
        if fork_dest.exists():
            failures.append("分叉模式不应该创建或克隆目录")
        node_dest = project_dest(root, "my-node")
        write_plan("depend", "node", node_dest)
        if not (node_dest / "package.json").is_file():
            failures.append("Node 骨架缺少 package.json")

    if failures:
        return "自检失败：\n" + "\n".join(f"- {item}" for item in failures), 1
    return f"自检通过：{len(cases)} 条判断，外加脱敏、草稿门禁和项目骨架。没有联网，也没有提交。", 0


def _print_error(exc: BaseException) -> int:
    print(f"参数不对：{exc}", file=sys.stderr)
    print("下一步：按提示改参数后重跑。不确定改动类型时，先运行 doctor，再运行 classify --help。", file=sys.stderr)
    return 2


def _cmd_classify(args: argparse.Namespace) -> int:
    result = classify(
        {
            "kind": args.kind,
            "where": args.where,
            "cause_clear": args.cause_clear,
            "size": args.size,
            "others_need": args.others_need,
            "upstream_has": args.upstream_has,
            "maintainer_agreed": args.maintainer_agreed,
            "can_fix": args.can_fix,
        }
    )
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(render(result))
    return 0


def _cmd_plan(args: argparse.Namespace) -> int:
    text = render_plan(args.mode, args.stack, args.name)
    if args.write:
        dest = project_dest(Path(args.dir), args.name)
        text = write_plan(args.mode, args.stack, dest)
    print(text)
    return 0


def _cmd_draft(args: argparse.Namespace) -> int:
    body = build_draft(
        kind=args.kind,
        title=args.title,
        summary=args.summary,
        expected=args.expected,
        actual=args.actual,
        steps=args.steps,
        version=args.version,
        os_name=args.os_name,
        python_version=args.python_version,
        upstream_note=args.upstream_note,
        tests=args.tests,
        hide_words=args.hide,
    )
    hits = scan_secrets(body)
    if hits:
        print(secret_report(hits), file=sys.stderr)
        return 3
    path = draft_path(Path(args.dir), args.kind)
    if path.exists() and not args.force:
        print(f"文件已存在：{path}", file=sys.stderr)
        print("没有覆盖。你若是改过这份草稿，请继续编辑它；确定要重写时再加上 --force。", file=sys.stderr)
        return 2
    path.write_text(body, encoding="utf-8")
    print(f"草稿已写到 {path}")
    print("状态：尚未提交。这个目录应保持在 .gitignore 里，不要把它推进公开仓库。")
    return 0


def _cmd_submit(args: argparse.Namespace) -> int:
    result = classify(
        {
            "kind": args.kind,
            "where": args.where,
            "cause_clear": args.cause_clear,
            "size": args.size,
            "others_need": args.others_need,
            "upstream_has": args.upstream_has,
            "maintainer_agreed": args.maintainer_agreed,
            "can_fix": args.can_fix,
        }
    )
    body_file = Path(args.body_file)
    if not body_file.is_file():
        print(f"找不到草稿：{body_file}", file=sys.stderr)
        print("下一步：先运行 draft。尚未提交。", file=sys.stderr)
        return 2
    text = body_file.read_text(encoding="utf-8")
    hits = scan_secrets(text)
    blockers = submission_blockers(result, args.want, hits)
    if blockers:
        print("尚未提交。")
        print("\n".join(blockers))
        if hits:
            print(secret_report(hits))
        return 2
    argv = gh_argv(args.want, args.repo, args.title, body_file)
    print("将要执行的是 GitHub CLI 创建 Issue 或 PR，不是 git push：")
    print(" ".join(argv))
    if not args.execute:
        print("还没有提交。确认草稿后，在同一条命令末尾加上 --execute。")
        return 0
    code, output = execute_gh(argv)
    print(output)
    if code != 0:
        print("尚未提交。")
        return 2
    print("GitHub CLI 已创建。请把返回的链接交给用户。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="custom_project.py",
        description="基于 AgenticX 做自己的项目：判断留在本仓，还是给官方写 Issue / PR。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "常见例子：\n"
            "  python3 scripts/custom_project.py doctor\n"
            "  python3 scripts/custom_project.py plan --mode depend --stack python --name my-agent\n"
            "  python3 scripts/custom_project.py classify --kind bug --where runtime --cause-clear yes --size small\n"
            "Windows 把 python3 换成 py -3，斜杠换成反斜杠。\n"
            "脚本打印的命令会按当前系统给出，优先复制那一行。"
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    doctor_cmd = sub.add_parser("doctor", help="检查 Python、Git、agx、网络，并给出下一步")
    doctor_cmd.set_defaults(func=lambda _args: _emit_doctor())

    plan = sub.add_parser("plan", help="给出初始化步骤；--write 只写业务骨架，不克隆官方仓库")
    plan.add_argument("--mode", required=True, choices=("depend", "fork", "vendor"))
    plan.add_argument("--stack", default="python", choices=("python", "node", "desktop"))
    plan.add_argument("--name", required=True)
    plan.add_argument("--dir", default=".")
    plan.add_argument("--write", action="store_true")
    plan.set_defaults(func=_cmd_plan)

    classify_cmd = sub.add_parser("classify", help="判断这次 bug 或新功能该留在本仓还是回报官方")
    _add_decision_flags(classify_cmd)
    classify_cmd.add_argument("--json", action="store_true")
    classify_cmd.set_defaults(func=_cmd_classify)

    draft = sub.add_parser("draft", help="把 Issue 或 PR 草稿写到 .agenticx-upstream/，不提交")
    draft.add_argument("--kind", required=True, choices=("issue", "pr"))
    draft.add_argument("--title", required=True)
    draft.add_argument("--summary", default="")
    draft.add_argument("--expected", default="")
    draft.add_argument("--actual", default="")
    draft.add_argument("--steps", default="")
    draft.add_argument("--version", default="")
    draft.add_argument("--os-name", default="")
    draft.add_argument("--python-version", default="")
    draft.add_argument("--upstream-note", default="")
    draft.add_argument("--tests", default="")
    draft.add_argument("--hide", action="append", default=[])
    draft.add_argument("--dir", default=".")
    draft.add_argument("--force", action="store_true")
    draft.set_defaults(func=_cmd_draft)

    submit = sub.add_parser("submit", help="检查门禁后给出 gh 命令；只有 --execute 才会真正创建")
    submit.add_argument("--want", required=True, choices=("issue", "pr"))
    submit.add_argument("--title", required=True)
    submit.add_argument("--body-file", required=True)
    submit.add_argument("--repo", default=UPSTREAM_REPO)
    submit.add_argument("--execute", action="store_true")
    _add_decision_flags(submit)
    submit.set_defaults(func=_cmd_submit)

    test_cmd = sub.add_parser("self-test", help="离线跑判断表、脱敏和骨架测试")
    test_cmd.set_defaults(func=lambda _args: _emit_self_test())
    return parser


def _add_decision_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--kind", required=True)
    parser.add_argument("--where", required=True)
    parser.add_argument("--cause-clear", default="unknown")
    parser.add_argument("--size", default="small")
    parser.add_argument("--others-need", default="unknown")
    parser.add_argument("--upstream-has", default="unknown")
    parser.add_argument("--maintainer-agreed", default="no")
    parser.add_argument("--can-fix", default="yes")


def _emit_doctor() -> int:
    text, code = doctor()
    print(text)
    return code


def _emit_self_test() -> int:
    text, code = self_test()
    print(text)
    return code


def main(argv: Optional[Sequence[str]] = None) -> int:
    configure_stdio_or_note()
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
        return int(args.func(args))
    except InputError as exc:
        return _print_error(exc)


if __name__ == "__main__":
    sys.exit(main())
