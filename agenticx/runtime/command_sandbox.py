"""OS-enforced filesystem isolation for Studio shell commands.

The command approval UI is intentionally not the security boundary. In the
default mode every child process is started under an operating-system sandbox
that can write only to the session's workspace roots and a private temporary
directory. Unrestricted execution is a separate, explicit permission level
and is approved by the caller before this module is invoked.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Optional, Sequence

WORKSPACE_WRITE = "workspace-write"
DANGER_FULL_ACCESS = "danger-full-access"
COMMAND_SANDBOX_PERMISSIONS = frozenset({WORKSPACE_WRITE, DANGER_FULL_ACCESS})


class CommandSandboxError(RuntimeError):
    """Base error for an invalid or unavailable command sandbox."""


class CommandSandboxUnavailable(CommandSandboxError):
    """Raised when the host cannot enforce the requested permission level."""


@dataclass(frozen=True)
class CommandSandboxPlan:
    """A fully resolved subprocess launch plan."""

    argv: tuple[str, ...]
    env: Mapping[str, str]
    permissions: str
    backend: str
    writable_roots: tuple[Path, ...] = ()
    temp_dir: Optional[Path] = None


def normalize_command_permissions(value: object) -> str:
    """Return a supported permission value, defaulting to workspace isolation."""

    if value is None:
        return WORKSPACE_WRITE
    text = str(value).strip().lower()
    if not text:
        return WORKSPACE_WRITE
    if text not in COMMAND_SANDBOX_PERMISSIONS:
        supported = ", ".join(sorted(COMMAND_SANDBOX_PERMISSIONS))
        raise CommandSandboxError(
            f"unsupported sandbox_permissions={text!r}; expected one of: {supported}"
        )
    return text


def build_command_sandbox_plan(
    argv: Sequence[str],
    *,
    permissions: object = WORKSPACE_WRITE,
    writable_roots: Iterable[Path] = (),
    scope_id: str = "default",
    cwd: Optional[Path] = None,
    environ: Optional[Mapping[str, str]] = None,
    platform_name: Optional[str] = None,
) -> CommandSandboxPlan:
    """Wrap ``argv`` in the host sandbox required by ``permissions``.

    ``workspace-write`` never degrades to unrestricted execution. A missing
    backend raises :class:`CommandSandboxUnavailable`; the caller may then ask
    the user to approve a new invocation with ``danger-full-access``.
    """

    raw_argv = tuple(str(part) for part in argv)
    if not raw_argv or not raw_argv[0]:
        raise CommandSandboxError("command argv must not be empty")

    resolved_permissions = normalize_command_permissions(permissions)
    base_env = dict(os.environ if environ is None else environ)
    if resolved_permissions == DANGER_FULL_ACCESS:
        return CommandSandboxPlan(
            argv=raw_argv,
            env=base_env,
            permissions=resolved_permissions,
            backend="none",
        )

    roots = _normalize_writable_roots(writable_roots)
    if not roots:
        raise CommandSandboxUnavailable(
            "workspace-write requires at least one existing writable workspace root"
        )

    temp_dir = _private_temp_dir(scope_id)
    allowed_roots = _normalize_writable_roots((*roots, temp_dir))
    base_env["TMPDIR"] = str(temp_dir)

    host = (platform_name or sys.platform).strip().lower()
    if host == "darwin":
        executable = Path("/usr/bin/sandbox-exec")
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise CommandSandboxUnavailable("macOS sandbox-exec is not available")
        profile = _macos_profile(allowed_roots)
        wrapped = (str(executable), "-p", profile, *raw_argv)
        backend = "macos-sandbox-exec"
    elif host.startswith("linux"):
        executable_text = shutil.which("bwrap")
        if not executable_text:
            raise CommandSandboxUnavailable(
                "bubblewrap (bwrap) is required for workspace-write on Linux"
            )
        wrapped = _bubblewrap_argv(
            executable_text,
            raw_argv,
            allowed_roots,
            cwd=cwd,
        )
        backend = "linux-bubblewrap"
    else:
        raise CommandSandboxUnavailable(
            f"workspace-write has no supported OS sandbox backend on {host or 'this host'}"
        )

    return CommandSandboxPlan(
        argv=wrapped,
        env=base_env,
        permissions=resolved_permissions,
        backend=backend,
        writable_roots=allowed_roots,
        temp_dir=temp_dir,
    )


def _normalize_writable_roots(roots: Iterable[Path]) -> tuple[Path, ...]:
    out: list[Path] = []
    seen: set[str] = set()
    for raw in roots:
        try:
            path = Path(raw).expanduser().resolve(strict=False)
        except (OSError, RuntimeError, TypeError, ValueError):
            continue
        if not path.is_dir():
            continue
        key = os.path.normcase(str(path))
        if key in seen:
            continue
        seen.add(key)
        out.append(path)
    return tuple(out)


def _private_temp_dir(scope_id: str) -> Path:
    raw_scope = str(scope_id or "default").encode("utf-8", errors="replace")
    digest = hashlib.sha256(raw_scope).hexdigest()[:20]
    root = Path(tempfile.gettempdir()).resolve(strict=False) / "agenticx-command-sandbox"
    target = root / digest
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        target.chmod(0o700)
    except OSError:
        pass
    return target.resolve(strict=False)


def _scheme_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _macos_profile(writable_roots: Sequence[Path]) -> str:
    lines = [
        "(version 1)",
        "(allow default)",
        "(deny file-write*)",
        '(allow file-write* (literal "/dev/null"))',
    ]
    lines.extend(
        f"(allow file-write* (subpath {_scheme_string(str(root))}))"
        for root in writable_roots
    )
    return "\n".join(lines)


def _bubblewrap_argv(
    executable: str,
    argv: tuple[str, ...],
    writable_roots: Sequence[Path],
    *,
    cwd: Optional[Path],
) -> tuple[str, ...]:
    wrapped: list[str] = [
        executable,
        "--die-with-parent",
        "--new-session",
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
    ]
    for root in writable_roots:
        path = str(root)
        wrapped.extend(("--bind", path, path))
    if cwd is not None:
        wrapped.extend(("--chdir", str(cwd.resolve(strict=False))))
    wrapped.extend(("--", *argv))
    return tuple(wrapped)
