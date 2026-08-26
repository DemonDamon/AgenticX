#!/usr/bin/env python3
"""Decide whether a shell command is already contained by the workspace sandbox.

The old check was "is the command name on a coarse allow-list" plus "does
the line contain a shell metacharacter". Both were too coarse, so the
product was noisy and leaky at once:

- ``sed -n '1,50p' a.py``, ``sort``, ``jq``, ``rg``, ``diff``, ``date``,
  ``stat`` all asked for approval even though they write nothing
- ``ls | head`` was high-risk ``shell_composition`` even though both
  segments are read-only
- ``find . -delete`` and ``find . -exec rm {} +`` asked nothing --
  ``find`` was on the list and parameters were never inspected

Noise and leaks are the same bug: a coarse list cannot say which part of
a command is dangerous. Noise is not just annoying -- it trains people to
click Approve, and then the one that mattered is also clicked through.
Over-prompting is itself a security failure.

Confirmations are for two cases: effects that escape the sandbox, or
irreversible effects inside it. Work already contained by workspace-write
must not be asked again -- redirect targets are checked earlier by
``_ensure_bash_write_targets_allowed``.

Method: split a compound command into simple commands, classify each
segment, and treat the whole as safe only if every segment is safe.
Unparseable or opaque forms (command substitution, process substitution,
background ``&``) return undecidable. Prefer one extra prompt over
pretending to understand.

Author: Damon Li
"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Sequence

#: Read-only names: no disk writes, no network, no env changes. A command made only of these needs no confirmation.
READ_ONLY_COMMANDS: frozenset[str] = frozenset({
    # list and read
    "ls", "dir", "tree", "cat", "head", "tail", "nl", "od", "xxd", "strings",
    # search
    "grep", "egrep", "fgrep", "rg", "ag", "ack",
    # text processing (read direction)
    "sort", "uniq", "cut", "tr", "column", "paste", "join", "comm", "fold",
    "expand", "unexpand", "rev", "tac", "wc", "diff", "cmp", "jq", "yq",
    # path and metadata
    "basename", "dirname", "realpath", "readlink", "stat", "file", "du", "df",
    "pwd", "which", "type", "command", "hostname", "uname", "id", "whoami",
    "groups", "date", "cal", "env", "printenv", "locale",
    # checksums
    "cksum", "md5sum", "sha1sum", "sha256sum", "sha512sum", "shasum", "b2sum",
    # simple output and predicates
    "echo", "printf", "seq", "test", "true", "false", "expr", "yes",
})

#: Dual-use names: safety depends on arguments. Listing a name does not approve every use.
GUARDED_COMMANDS: frozenset[str] = frozenset({
    "find", "sed", "awk", "gawk", "mawk", "git", "xargs", "env", "tar",
})

#: Known, not-read-only names. They have dedicated risk rules (``pip install``, ``python -c``, ``rm -rf``).
#: Do not also report them as unrecognized -- two reasons for one fact make the card harder to read.
#: This set is recognition only; callers decide how dangerous a recognized name is.
KNOWN_NON_READONLY_COMMANDS: frozenset[str] = frozenset({
    "python", "python3", "pip", "pip3", "node", "npm", "yarn", "pnpm", "npx",
    "brew", "apt", "apt-get", "yum", "dnf", "choco", "snap", "cargo", "go",
    "make", "cmake", "docker", "kubectl",
    "rm", "rmdir", "mv", "cp", "ln", "mkdir", "touch", "chmod", "chown",
    "dd", "mkfs", "shutdown", "reboot", "poweroff", "kill", "pkill",
    "curl", "wget", "ssh", "scp", "rsync", "sudo", "su",
})

#: 命令名 → 风险类别。归入 NEVER_AUTO_APPROVED_CATEGORIES 的名字必须在此列出，
#: 否则「永不放行」只是文案：分类器发不出该类别，集合就永远匹配不上。
#:
#: ``cp`` / ``ln`` / ``mkdir`` / ``touch`` 故意不列入。它们的写入边界由 OS
#: 沙箱的 writable roots 保证，落在 unrecognized_command 即可；列入
#: destructive_filesystem 会让工作区内的正常拷贝永远无法自动放行。
COMMAND_RISK_CATEGORIES: dict[str, str] = {
    # 删除 / 覆盖：不可逆
    "rm": "destructive_filesystem",
    "rmdir": "destructive_filesystem",
    "mv": "destructive_filesystem",
    "dd": "destructive_filesystem",
    "mkfs": "destructive_filesystem",
    # 主机 / 系统级
    "shutdown": "system_disruption",
    "reboot": "system_disruption",
    "poweroff": "system_disruption",
    "kill": "system_disruption",
    "pkill": "system_disruption",
    "chmod": "system_disruption",
    "chown": "system_disruption",
    "sudo": "host_full_access",
    "su": "host_full_access",
    # 效果离开本机
    "curl": "external_publish",
    "wget": "external_publish",
    "ssh": "external_publish",
    "scp": "external_publish",
    "rsync": "external_publish",
    # 装依赖：磁盘写 + 取远端代码
    "pip": "dependency_change",
    "pip3": "dependency_change",
    "npm": "dependency_change",
    "yarn": "dependency_change",
    "pnpm": "dependency_change",
    "brew": "dependency_change",
    "apt": "dependency_change",
    "apt-get": "dependency_change",
    "cargo": "dependency_change",
    # 解释器：可开 socket、可写盘
    "python": "arbitrary_code_execution",
    "python3": "arbitrary_code_execution",
    "node": "arbitrary_code_execution",
    "npx": "arbitrary_code_execution",
}

#: Wrappers that run the rest as another command. Must look inside, otherwise
#: ``timeout 5 rm -rf /`` would be allowed because ``timeout`` looks harmless.
DELEGATING_COMMANDS: frozenset[str] = frozenset({
    "xargs", "timeout", "time", "nice", "ionice", "nohup", "stdbuf", "env",
    "setsid", "watch",
})

#: ``find`` actions that write or execute. Without these checks, listing ``find`` is listing ``rm``.
FIND_UNSAFE_ACTIONS: frozenset[str] = frozenset({
    "-delete", "-exec", "-execdir", "-ok", "-okdir",
    "-fls", "-fprint", "-fprint0", "-fprintf",
})

#: Read-only ``git`` subcommands. Everything else changes repository state.
GIT_READ_ONLY_SUBCOMMANDS: frozenset[str] = frozenset({
    "status", "log", "diff", "show", "branch", "remote", "config",
    "rev-parse", "describe", "blame", "shortlog", "ls-files", "ls-tree",
    "cat-file", "check-ignore", "for-each-ref",
})

#: Discard devices. Shells depend on them (``2>/dev/null``) and writes there have no persisted effect.
#: Sandbox backends usually punch a hole for these sinks as well.
DISCARD_SINKS: frozenset[str] = frozenset({
    "/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty", "/dev/fd/1", "/dev/fd/2",
    "NUL", "nul",
})

#: Connectors recognized while splitting. They only sequence segments; they do not change a segment's meaning.
_SPLIT_TOKENS = ("&&", "||", ";", "|", "\n")

#: Null sinks the shell itself needs. Writes here create no recoverable landing.
_NULL_SINKS: frozenset[str] = frozenset({
    "/dev/null", "/dev/stdout", "/dev/stderr", "NUL", "nul",
})

#: Forms that can hide another command. Seeing one makes the verdict undecidable.
_OPAQUE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("$(", "命令替换 $(...) 可以在此处执行另一条命令"),
    ("`", "反引号命令替换可以在此处执行另一条命令"),
    ("<(", "进程替换 <(...) 会执行另一条命令"),
    (">(", "进程替换 >(...) 会执行另一条命令"),
)


@dataclass(frozen=True)
class RiskFinding:
    """One reason this command needs a human decision."""

    code: str
    evidence: str

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "evidence": self.evidence}


@dataclass(frozen=True)
class SafetyVerdict:
    """Whether the sandbox already contains this command's effects.

    Attributes:
        contained: sandbox already covers the effects; do not prompt.
        findings: structured reasons when unsafe; empty when contained.
        undecidable: unparseable; callers treat as protected (fail closed).
    """

    contained: bool
    findings: List[RiskFinding] = field(default_factory=list)
    undecidable: bool = False

    @property
    def is_contained(self) -> bool:
        """True when the sandbox already covers this command's effects."""
        return self.contained


def _tokenize(segment: str) -> Optional[List[str]]:
    """Tokenize with shlex; return None when quotes are unbalanced."""
    try:
        return shlex.split(segment)
    except ValueError:
        return None


def split_simple_commands(command: str) -> Optional[List[List[str]]]:
    """Split a compound command into its simple commands.

    Split only on ``&&`` / ``||`` / ``;`` / ``|`` / newline, honouring quotes
    -- ``echo "a && b"`` is one command. Redirections (``> f``, ``2>&1``,
    ``>> f``) are stripped: their landing is checked earlier by
    ``_ensure_bash_write_targets_allowed``.

    Returns:
        Each item is one simple-command argv; ``None`` when semantics are unclear.
    """
    if not command or not command.strip():
        return None
    for marker, _reason in _OPAQUE_PATTERNS:
        if marker in command:
            return None
    # Background ``&`` is semantically fine in some cases, but it is also half
    # of ``&&`` and part of ``2>&1``. Character-level disambiguation is not
    # worth it -- treat as undecidable.
    if re.search(r"(?<![&>0-9])&(?!&)", command):
        return None

    segments: List[str] = []
    buffer: List[str] = []
    quote: Optional[str] = None
    index = 0
    while index < len(command):
        char = command[index]
        if quote:
            buffer.append(char)
            if char == quote:
                quote = None
            elif char == "\\" and quote == '"' and index + 1 < len(command):
                index += 1
                buffer.append(command[index])
            index += 1
            continue
        if char in "'\"":
            quote = char
            buffer.append(char)
            index += 1
            continue
        matched = next(
            (token for token in _SPLIT_TOKENS if command.startswith(token, index)),
            None,
        )
        if matched:
            segments.append("".join(buffer))
            buffer = []
            index += len(matched)
            continue
        buffer.append(char)
        index += 1
    if quote:
        return None
    segments.append("".join(buffer))

    commands: List[List[str]] = []
    for segment in segments:
        stripped = _strip_redirections(segment)
        if stripped is None:
            return None
        if not stripped.strip():
            continue
        parts = _tokenize(stripped)
        if parts is None:
            return None
        if parts:
            commands.append(parts)
    return commands or None


def _strip_redirections(segment: str) -> Optional[str]:
    """Remove redirection clauses, honouring quotes. ``None`` when unsure."""
    out: List[str] = []
    quote: Optional[str] = None
    index = 0
    while index < len(segment):
        char = segment[index]
        if quote:
            out.append(char)
            if char == quote:
                quote = None
            index += 1
            continue
        if char in "'\"":
            quote = char
            out.append(char)
            index += 1
            continue
        if char in "<>":
            # consume >, >>, 2>, &> and the following target
            while index < len(segment) and segment[index] in "<>&":
                index += 1
            while index < len(segment) and segment[index].isspace():
                index += 1
            while index < len(segment) and not segment[index].isspace():
                index += 1
            continue
        out.append(char)
        index += 1
    if quote:
        return None
    return "".join(out)


def _strip_env_assignments(parts: Sequence[str]) -> List[str]:
    """``FOO=1 BAR=2 cmd …`` → ``cmd …``. Prefix assignments execute nothing."""
    index = 0
    while index < len(parts) and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", parts[index]):
        index += 1
    return list(parts[index:])


def _first_positional(parts: Sequence[str], *, start: int = 1) -> Optional[str]:
    for token in parts[start:]:
        if not token.startswith("-"):
            return token
    return None


def _risk_evidence(name: str, category: str, parts: Sequence[str]) -> str:
    """Human-readable reason for a named risk category. Never empty."""
    del parts  # argv is reserved for future per-flag evidence
    special = {
        "rm": "rm 会删除文件，删除不可撤销",
        "curl": "curl 会把数据发往本机之外",
    }
    if name in special:
        return special[name]
    by_category = {
        "destructive_filesystem": f"{name} 会删除或覆盖文件，删除不可撤销",
        "system_disruption": f"{name} 会中断或改变本机系统状态",
        "host_full_access": f"{name} 会突破当前隔离，拿到主机级权限",
        "external_publish": f"{name} 会把数据发往本机之外",
        "dependency_change": f"{name} 会安装或改动依赖",
        "arbitrary_code_execution": f"{name} 会执行任意代码（可写盘、可开网络）",
    }
    text = by_category.get(category, f"{name} 属于风险类别 {category}")
    return text or f"{name} 需要你判断这次的用途"


def classify_simple_command(parts: Sequence[str]) -> SafetyVerdict:
    """Classify one simple command (no pipes, no redirects)."""
    parts = _strip_env_assignments(parts)
    if not parts:
        return SafetyVerdict(contained=True)
    name = parts[0].rsplit("/", 1)[-1]

    if name in DELEGATING_COMMANDS:
        return _classify_delegating(name, parts)
    if name in GUARDED_COMMANDS:
        return _classify_guarded(name, parts)
    if name in READ_ONLY_COMMANDS:
        return SafetyVerdict(contained=True)
    category = COMMAND_RISK_CATEGORIES.get(name)
    if category is not None:
        return SafetyVerdict(
            contained=False,
            findings=[RiskFinding(category, _risk_evidence(name, category, parts))],
        )
    if name in KNOWN_NON_READONLY_COMMANDS:
        # 仍在识别集合里但没有专门规则：保持泛化理由，不要静默放行。
        return SafetyVerdict(
            contained=False,
            findings=[
                RiskFinding(
                    "unrecognized_command",
                    f"{name} 不是只读命令，需要你判断这次的用途",
                )
            ],
        )
    return SafetyVerdict(
        contained=False,
        findings=[
            RiskFinding("unrecognized_command", f"{name} 不在已知只读命令集合中")
        ],
    )


def _classify_delegating(name: str, parts: Sequence[str]) -> SafetyVerdict:
    """Skip the wrapper's own options and classify the delegated command.

    In ``timeout 5 rm -rf /`` the danger is ``rm``, not ``timeout``.
    Not looking inside is an allow.
    """
    index = 1
    if name == "timeout":
        # timeout [options] DURATION COMMAND …
        while index < len(parts) and parts[index].startswith("-"):
            index += 1
        index += 1  # DURATION
    elif name == "env":
        while index < len(parts) and (
            parts[index].startswith("-") or "=" in parts[index]
        ):
            index += 1
    elif name == "xargs":
        while index < len(parts) and parts[index].startswith("-"):
            # valued options such as -I{} / -n 3
            if parts[index] in {"-I", "-n", "-P", "-L", "-d", "-s", "-E", "-a"}:
                index += 1
            index += 1
    else:
        while index < len(parts) and parts[index].startswith("-"):
            index += 1

    delegated = list(parts[index:])
    if not delegated:
        # xargs with no command defaults to echo; other wrappers without a command are meaningless.
        return SafetyVerdict(contained=True) if name == "xargs" else SafetyVerdict(
            contained=False,
            findings=[RiskFinding("unrecognized_command", f"{name} 后面没有可判定的命令")],
        )
    inner = classify_simple_command(delegated)
    if inner.contained:
        return inner
    return SafetyVerdict(
        contained=False,
        findings=[
            RiskFinding(
                item.code,
                f"{name} 会执行：{item.evidence}",
            )
            for item in inner.findings
        ],
        undecidable=inner.undecidable,
    )


def _classify_guarded(name: str, parts: Sequence[str]) -> SafetyVerdict:
    if name == "find":
        hits = [token for token in parts[1:] if token in FIND_UNSAFE_ACTIONS]
        if hits:
            code = (
                "destructive_filesystem"
                if "-delete" in hits
                else "arbitrary_code_execution"
            )
            return SafetyVerdict(
                contained=False,
                findings=[
                    RiskFinding(code, f"find {' '.join(hits)} 会删除文件或执行命令")
                ],
            )
        return SafetyVerdict(contained=True)

    if name == "sed":
        inplace = [
            token for token in parts[1:]
            if token == "--in-place" or token.startswith("--in-place=")
            or (token.startswith("-") and not token.startswith("--") and "i" in token[1:])
        ]
        if inplace:
            return SafetyVerdict(
                contained=False,
                findings=[
                    RiskFinding(
                        "destructive_filesystem",
                        "sed -i 会就地覆盖文件内容",
                    )
                ],
            )
        return SafetyVerdict(contained=True)

    if name in {"awk", "gawk", "mawk"}:
        program = " ".join(parts[1:])
        if "system(" in program or re.search(r'\|\s*["\']', program) or ">" in program:
            return SafetyVerdict(
                contained=False,
                findings=[
                    RiskFinding(
                        "arbitrary_code_execution",
                        "awk 程序里含 system()、管道或重定向，可执行额外命令或写文件",
                    )
                ],
            )
        return SafetyVerdict(contained=True)

    if name == "git":
        subcommand = _first_positional(
            parts, start=1
        )
        if subcommand is None:
            return SafetyVerdict(contained=True)
        if subcommand in GIT_READ_ONLY_SUBCOMMANDS:
            return SafetyVerdict(contained=True)
        return SafetyVerdict(
            contained=False,
            findings=[
                RiskFinding("version_control_change", f"git {subcommand} 会变更版本库状态")
            ],
        )

    if name == "tar":
        # tar actions may be -x / --extract or old clustered "xzf". Only
        # listing (-t/--list) is read-only; extract writes files and create
        # (-c) produces a new archive.
        listing = False
        writing = False
        for token in parts[1:]:
            if token in {"-t", "--list"}:
                listing = True
            elif token in {"-x", "--extract", "--get", "-c", "--create", "-u", "-r"}:
                writing = True
            elif token.startswith("--"):
                continue
            elif token.startswith("-"):
                flags = token[1:]
                if "t" in flags:
                    listing = True
                if any(flag in flags for flag in "xcur"):
                    writing = True
            elif not listing and not writing and re.fullmatch(r"[a-zA-Z]+", token):
                # old clustered form: tar xzf a.tgz
                if "t" in token:
                    listing = True
                if any(flag in token for flag in "xcur"):
                    writing = True
        if writing or not listing:
            return SafetyVerdict(
                contained=False,
                findings=[
                    RiskFinding(
                        "destructive_filesystem",
                        "tar 会写出或覆盖文件（只有 -t 列出内容是只读的）",
                    )
                ],
            )
        return SafetyVerdict(contained=True)

    return SafetyVerdict(
        contained=False,
        findings=[RiskFinding("unrecognized_command", f"{name} 需要人工判断用途")],
    )


def assess_command(command: str) -> SafetyVerdict:
    """Whether ``command`` as a whole is already contained by the sandbox.

    Unparseable commands return ``undecidable=True``; callers treat them as
    protected -- the fail-closed side.
    """
    simple_commands = split_simple_commands(command)
    if simple_commands is None:
        reason = next(
            (why for marker, why in _OPAQUE_PATTERNS if marker in command),
            "命令结构无法确定地拆解，可能藏有额外命令",
        )
        return SafetyVerdict(
            contained=False,
            findings=[RiskFinding("shell_composition", reason)],
            undecidable=True,
        )

    findings: List[RiskFinding] = []
    for parts in simple_commands:
        verdict = classify_simple_command(parts)
        if verdict.contained:
            continue
        for item in verdict.findings:
            if item not in findings:
                findings.append(item)
    return SafetyVerdict(contained=not findings, findings=findings)


def absolute_redirect_targets(command: str) -> List[str]:
    """Redirection targets written as absolute paths.

    Relative redirect targets land under cwd, which is inside the workspace
    and is checked again by ``_ensure_bash_write_targets_allowed``. Absolute
    targets are different: this module cannot see the workspace boundary and
    cannot prove they land inside (``cat secrets.env > /tmp/leak.txt``).
    Those go back to the human.
    """
    targets: List[str] = []
    quote: Optional[str] = None
    # Null devices are discard sinks the shell itself needs, not landing
    # problems. Read-only sandboxes typically allow /dev/null as well.
    index = 0
    while index < len(command):
        char = command[index]
        if quote:
            if char == quote:
                quote = None
            index += 1
            continue
        if char in "'\"":
            quote = char
            index += 1
            continue
        if char == ">":
            while index < len(command) and command[index] in "<>&":
                index += 1
            while index < len(command) and command[index].isspace():
                index += 1
            start = index
            while index < len(command) and not command[index].isspace():
                index += 1
            target = command[start:index].strip("'\"")
            if target in DISCARD_SINKS:
                continue
            absolute = target.startswith("/") or re.match(r"^[A-Za-z]:[\\/]", target)
            if absolute and target not in _NULL_SINKS and target not in targets:
                targets.append(target)
            continue
        index += 1
    return targets


# --------------------------------------------------------------------------
# How tiers relate to confirmation
# --------------------------------------------------------------------------

#: Risk codes already contained by the read-only tier -- their harm is
#: entirely a file write, and that tier refuses every write.
#:
#: Codes not listed are omitted on purpose: a file sandbox does not cover
#: the network. ``git push``, ``shutdown``, ``python -c`` (can open a
#: socket), and unrecognized names (might be curl) still need a prompt
#: at the read-only tier.
#:
#: Read-only is not network isolation. It guarantees "this session cannot
#: change anything", not "this session cannot send anything".
CONTAINED_BY_READ_ONLY: frozenset[str] = frozenset({
    "destructive_filesystem",   # delete/overwrite: refused writes make it void
    "dependency_change",        # installing is a disk write
    "version_control_change",   # index/commit/worktree are writes
})


#: Categories that must never become "stop asking".
#:
#: Shared trait: irreversible, or effects leave this machine / this task
#: -- deleted data, a remote push, host/system changes, leaving workspace
#: isolation. A standing rule must not waive them; the user agreed to one
#: context, not every later one. Frontend ``neverReusableCategories`` must
#: stay in sync (desktop/src/utils/confirm-scope.ts).
#:
#: ``destructive_filesystem`` was added 2026-08-24. The UI said deletions
#: would still be asked, but the code set did not include it -- then
#: ``allowed_tools: ["bash_exec"]`` let ``rm -rf`` skip confirmation.
#: Copy that promises more than the code is worse than neither.
#:
#: Standing rules that auto-allow publish/delete are intentionally not
#: offered. Persistence of approvals does not relax this.
NEVER_AUTO_APPROVED_CATEGORIES: frozenset[str] = frozenset({
    "destructive_filesystem",
    "external_publish",
    "host_full_access",
    "system_disruption",
})


def categories_requiring_approval(
    permissions: str,
    codes: Iterable[str],
) -> List[str]:
    """Which risk categories still need a human decision at this tier.

    Tier and confirmation are two knobs. The sandbox owns the execution
    boundary; the confirm dialog covers only what the sandbox cannot.

    - ``read-only``: writes are refused, so file-risk codes need no prompt;
      network and process codes still do.
    - ``danger-full-access``: returned as-is. Asking once for the tier
      would be enough in theory; that needs session-level state and drops
      an intercept, which is a product call this function will not make.
      Today each command still asks with ``host_full_access``.
    - ``workspace-write``: writes outside the workspace fail, but deletes
      and overwrites inside it are irreversible and still asked.

    Args:
        permissions: ``read-only`` / ``workspace-write`` / ``danger-full-access``.
        codes: classified risk codes.

    Returns:
        Codes that still need a human, de-duplicated and sorted.
    """
    tier = str(permissions or "").strip().lower()
    unique = sorted({str(code).strip() for code in codes if str(code).strip()})
    if tier == "read-only":
        return [code for code in unique if code not in CONTAINED_BY_READ_ONLY]
    return unique
