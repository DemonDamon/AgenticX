#!/usr/bin/env python3
"""Legacy (v1) skill guard — inline regex patterns.

Author: Damon Li
"""

from __future__ import annotations

import re
from pathlib import Path

from agenticx.skills.guard_types import (
    SCANNABLE_EXTENSIONS,
    SUSPICIOUS_BINARY_EXTENSIONS,
    MAX_FILE_COUNT,
    MAX_SINGLE_FILE_KB,
    MAX_TOTAL_SIZE_KB,
    ScanFinding,
    ScanResult,
    ScanVerdict,
    merge_verdict,
)

_PATTERN_DEFS: list[tuple[str, ScanVerdict, re.Pattern[str]]] = [
    ("exfiltration_curl", "dangerous", re.compile(r"curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)", re.IGNORECASE)),
    ("exfiltration_wget", "dangerous", re.compile(r"wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)", re.IGNORECASE)),
    ("exfiltration_curl_generic", "caution", re.compile(r"curl\s+.*\$\{?\w", re.IGNORECASE)),
    ("exfiltration_wget_generic", "caution", re.compile(r"wget\s+.*\$\{?\w", re.IGNORECASE)),
    ("exfiltration_fetch_env", "dangerous", re.compile(r"fetch\s*\(.*(?:process\.env|os\.environ)", re.IGNORECASE)),
    ("exfiltration_httpx", "dangerous", re.compile(r"httpx?\.(get|post|put|patch)\s*\([^\n]*(KEY|TOKEN|SECRET|PASSWORD)", re.IGNORECASE)),
    ("exfiltration_requests", "dangerous", re.compile(r"requests\.(get|post|put|patch)\s*\([^\n]*(KEY|TOKEN|SECRET|PASSWORD)", re.IGNORECASE)),
    ("encoded_exfil", "dangerous", re.compile(r"base64[^\n]*env", re.IGNORECASE)),
    ("dump_all_env", "dangerous", re.compile(r"printenv|env\s*\|")),
    ("python_os_environ", "dangerous", re.compile(r"os\.environ\b(?!\s*\.get\s*\(\s*[\"']PATH)")),
    ("python_getenv_secret", "dangerous", re.compile(r"os\.getenv\s*\(\s*[^\)]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", re.IGNORECASE)),
    ("dns_exfil", "dangerous", re.compile(r"\b(dig|nslookup|host)\s+[^\n]*\$")),
    ("md_image_exfil", "dangerous", re.compile(r"!\[.*\]\(https?://[^\)]*\$\{?")),
    ("context_exfil", "dangerous", re.compile(r"(include|output|print|send|share)\s+(?:\w+\s+)*(conversation|chat\s+history|previous\s+messages|context)", re.IGNORECASE)),
    ("send_to_url", "dangerous", re.compile(r"(send|post|upload|transmit)\s+.*\s+(to|at)\s+https?://", re.IGNORECASE)),
    ("credential_ssh", "dangerous", re.compile(r"[~$]HOME/\.ssh|~/\.ssh")),
    ("credential_aws", "dangerous", re.compile(r"[~$]HOME/\.aws|~/\.aws")),
    ("credential_dotenv", "caution", re.compile(r"\.env\b")),
    ("read_secrets_file", "dangerous", re.compile(r"cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)", re.IGNORECASE)),
    ("hardcoded_secret", "dangerous", re.compile(r"(?:api[_-]?key|token|secret|password)\s*[=:]\s*[\"'][A-Za-z0-9+/=_-]{20,}")),
    ("embedded_private_key", "dangerous", re.compile(r"-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----")),
    ("github_token", "dangerous", re.compile(r"ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{80,}")),
    ("openai_key", "dangerous", re.compile(r"sk-[A-Za-z0-9]{20,}")),
    ("aws_access_key", "dangerous", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("prompt_ignore_previous", "dangerous", re.compile(r"ignore\s+(?:\w+\s+)*(previous|all|above|prior)\s+instructions", re.IGNORECASE)),
    ("prompt_system", "dangerous", re.compile(r"system\s+prompt\s+override", re.IGNORECASE)),
    ("prompt_system_tag", "dangerous", re.compile(r"<system>", re.IGNORECASE)),
    ("role_hijack", "dangerous", re.compile(r"you\s+are\s+(?:\w+\s+)*now\s+", re.IGNORECASE)),
    ("deception_hide", "dangerous", re.compile(r"do\s+not\s+(?:\w+\s+)*tell\s+(?:\w+\s+)*the\s+user", re.IGNORECASE)),
    ("disregard_rules", "dangerous", re.compile(r"disregard\s+(?:\w+\s+)*(your|all|any)\s+(?:\w+\s+)*(instructions|rules|guidelines)", re.IGNORECASE)),
    ("jailbreak_dan", "dangerous", re.compile(r"\bDAN\s+mode\b|Do\s+Anything\s+Now", re.IGNORECASE)),
    ("jailbreak_dev_mode", "dangerous", re.compile(r"\bdeveloper\s+mode\b.*\benabled?\b", re.IGNORECASE)),
    ("remove_filters", "dangerous", re.compile(r"(respond|answer|reply)\s+without\s+(?:\w+\s+)*(restrictions|limitations|filters|safety)", re.IGNORECASE)),
    ("html_comment_injection", "caution", re.compile(r"<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->")),
    ("destructive_rm", "dangerous", re.compile(r"rm\s+-rf\s+/")),
    ("destructive_home_rm", "dangerous", re.compile(r"rm\s+(-[^\s]*)?r.*\$HOME|\brmdir\s+.*\$HOME")),
    ("destructive_chmod", "dangerous", re.compile(r"chmod\s+777")),
    ("destructive_sql", "dangerous", re.compile(r"DROP\s+TABLE", re.IGNORECASE)),
    ("system_overwrite", "dangerous", re.compile(r">\s*/etc/")),
    ("format_filesystem", "dangerous", re.compile(r"\bmkfs\b")),
    ("python_rmtree", "caution", re.compile(r"shutil\.rmtree\s*\(\s*[\"\'/]")),
    ("persistence_cron", "caution", re.compile(r"\bcrontab\b")),
    ("shell_rc_mod", "caution", re.compile(r"\.(bashrc|zshrc|profile|bash_profile)\b")),
    ("ssh_backdoor", "dangerous", re.compile(r"authorized_keys")),
    ("sudoers_mod", "dangerous", re.compile(r"/etc/sudoers|visudo")),
    ("agent_config_mod", "dangerous", re.compile(r"AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules")),
    ("agenticx_config_mod", "dangerous", re.compile(r"\.agenticx/config\.yaml|\.agenticx/SOUL\.md")),
    ("reverse_shell", "dangerous", re.compile(r"\bnc\s+-[lp]|ncat\s+-[lp]|\bsocat\b")),
    ("tunnel_service", "caution", re.compile(r"\bngrok\b|\blocaltunnel\b|\bserveo\b|\bcloudflared\b")),
    ("bash_reverse_shell", "dangerous", re.compile(r"/bin/(ba)?sh\s+-i\s+.*>/dev/tcp/")),
    ("exfil_service", "caution", re.compile(r"webhook\.site|requestbin\.com|pipedream\.net|hookbin\.com")),
    ("base64_decode_pipe", "dangerous", re.compile(r"base64\s+(-d|--decode)\s*\|")),
    ("eval_string", "caution", re.compile(r"\beval\s*\(\s*[\"']")),
    ("exec_string", "caution", re.compile(r"\bexec\s*\(\s*[\"']")),
    ("echo_pipe_exec", "dangerous", re.compile(r"echo\s+[^\n]*\|\s*(bash|sh|python|perl|ruby|node)")),
    ("curl_pipe_shell", "dangerous", re.compile(r"curl\s+[^\n]*\|\s*(ba)?sh")),
    ("wget_pipe_shell", "dangerous", re.compile(r"wget\s+[^\n]*-O\s*-\s*\|\s*(ba)?sh")),
    ("curl_pipe_python", "dangerous", re.compile(r"curl\s+[^\n]*\|\s*python")),
    ("unpinned_pip", "caution", re.compile(r"pip\s+install\s+(?!-r\s)(?!.*==)")),
    ("unpinned_npm", "caution", re.compile(r"npm\s+install\s+(?!.*@\d)")),
    ("sudo_usage", "caution", re.compile(r"\bsudo\b")),
    ("nopasswd_sudo", "dangerous", re.compile(r"NOPASSWD")),
    ("suid_bit", "dangerous", re.compile(r"chmod\s+[u+]?s")),
]

_INVISIBLE_CHARS: frozenset[str] = frozenset({
    "\u200b", "\u200c", "\u200d", "\u2060", "\u2062", "\u2063", "\u2064",
    "\ufeff", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e",
    "\u2066", "\u2067", "\u2068", "\u2069",
})

_INVISIBLE_NAMES: dict[str, str] = {
    "\u200b": "zero-width space",
    "\u200c": "zero-width non-joiner",
    "\u200d": "zero-width joiner",
    "\u2060": "word joiner",
    "\ufeff": "BOM/zero-width no-break space",
    "\u202e": "RTL override",
}


def _scan_text(text: str, rel_path: str) -> list[ScanFinding]:
    findings: list[ScanFinding] = []
    seen: set[tuple[str, int]] = set()
    for line_no, line in enumerate(text.splitlines(), start=1):
        for pname, severity, rx in _PATTERN_DEFS:
            key = (pname, line_no)
            if key in seen:
                continue
            m = rx.search(line)
            if m:
                seen.add(key)
                findings.append(
                    ScanFinding(
                        severity=severity,
                        pattern_name=pname,
                        matched_text=m.group(0)[:200],
                        file_path=rel_path,
                        line_number=line_no,
                    )
                )
        for char in _INVISIBLE_CHARS:
            if char in line:
                name = _INVISIBLE_NAMES.get(char, f"U+{ord(char):04X}")
                findings.append(
                    ScanFinding(
                        severity="dangerous",
                        pattern_name="invisible_unicode",
                        matched_text=f"U+{ord(char):04X} ({name})",
                        file_path=rel_path,
                        line_number=line_no,
                    )
                )
                break
    return findings


def _check_structure(skill_dir: Path) -> list[ScanFinding]:
    findings: list[ScanFinding] = []
    file_count = 0
    total_size = 0
    for f in skill_dir.rglob("*"):
        if not f.is_file() and not f.is_symlink():
            continue
        rel = str(f.relative_to(skill_dir))
        file_count += 1
        if f.is_symlink():
            try:
                resolved = f.resolve()
                if not resolved.is_relative_to(skill_dir.resolve()):
                    findings.append(ScanFinding(
                        severity="dangerous",
                        pattern_name="symlink_escape",
                        matched_text=f"symlink -> {resolved}",
                        file_path=rel,
                        line_number=0,
                    ))
            except OSError:
                findings.append(ScanFinding(
                    severity="caution",
                    pattern_name="broken_symlink",
                    matched_text="broken symlink",
                    file_path=rel,
                    line_number=0,
                ))
            continue
        try:
            size = f.stat().st_size
            total_size += size
        except OSError:
            continue
        if size > MAX_SINGLE_FILE_KB * 1024:
            findings.append(ScanFinding(
                severity="caution",
                pattern_name="oversized_file",
                matched_text=f"{size // 1024}KB",
                file_path=rel,
                line_number=0,
            ))
        ext = f.suffix.lower()
        if ext in SUSPICIOUS_BINARY_EXTENSIONS:
            findings.append(ScanFinding(
                severity="dangerous",
                pattern_name="binary_file",
                matched_text=f"binary: {ext}",
                file_path=rel,
                line_number=0,
            ))
    if file_count > MAX_FILE_COUNT:
        findings.append(ScanFinding(
            severity="caution",
            pattern_name="too_many_files",
            matched_text=f"{file_count} files",
            file_path="(directory)",
            line_number=0,
        ))
    if total_size > MAX_TOTAL_SIZE_KB * 1024:
        findings.append(ScanFinding(
            severity="caution",
            pattern_name="oversized_skill",
            matched_text=f"{total_size // 1024}KB total",
            file_path="(directory)",
            line_number=0,
        ))
    return findings


def scan_skill_v1(skill_dir: Path, *, source: str = "agent-created") -> ScanResult:
    """Run legacy inline-pattern scan."""
    skill_dir = Path(skill_dir).expanduser().resolve(strict=False)
    all_findings: list[ScanFinding] = []
    if skill_dir.is_dir():
        all_findings.extend(_check_structure(skill_dir))
        for f in skill_dir.rglob("*"):
            if not f.is_file():
                continue
            ext = f.suffix.lower()
            if ext not in SCANNABLE_EXTENSIONS and f.name != "SKILL.md":
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="replace")
            except (UnicodeDecodeError, OSError):
                continue
            rel = str(f.relative_to(skill_dir))
            all_findings.extend(_scan_text(text, rel))
    elif skill_dir.is_file():
        try:
            text = skill_dir.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ScanResult(verdict="safe", findings=[], source=source)
        all_findings.extend(_scan_text(text, skill_dir.name))
    else:
        return ScanResult(verdict="safe", findings=[], source=source)
    return ScanResult(
        verdict=merge_verdict(all_findings),
        findings=all_findings,
        source=source,
    )
