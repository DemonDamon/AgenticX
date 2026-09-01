#!/usr/bin/env python3
"""OS-enforced filesystem isolation for Studio shell commands.

Author: Damon Li

The command approval UI is intentionally not the security boundary. In the
default mode every child process is started under an operating-system sandbox
that can write only to the session's workspace roots and a private temporary
directory. Unrestricted execution is a separate, explicit permission level
and is approved by the caller before this module is invoked.

On macOS and Linux both reads and writes are confined. Readable paths are
the workspace roots, session read-only mounts, this invocation's private
temp directory, and the system/toolchain prefixes from
:func:`_toolchain_read_roots`. The home directory is not among them:
``cat ~/.ssh/id_rsa`` is refused. Deny entries from
``permissions.path_rules`` apply to reads and writes together: when a user
writes ``**/.env`` they mean "do not touch this file". A rule that blocks
``rm`` but not ``cat`` is protecting the wrong half.

Windows has no read isolation yet. ProcessContainer is read-deny-by-default,
but :func:`_windows_readonly_paths` puts the whole ``USERPROFILE`` on
readonlyPaths so common toolchains can run, which means the home directory
is still readable. :func:`shell_read_isolation_for_host` reports that gap
honestly so the UI can word it -- one sentence across three platforms
would over-promise on at least one of them.

Do not merge the two host fields::

    shell_read_isolation_for_host()   can we read outside the workspace?  full / none
    path_deny_enforcement_for_host()  how strictly are deny rules enforced?  full / partial / none

Windows is currently read=none and deny=partial. Combining them into one
field would make one of those statements false.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Optional, Sequence

_log = logging.getLogger(__name__)

#: Read-only: refuse every file write. The shell still gets discard devices
#: and one private temp directory. Research-style work runs at this tier so
#: commands cannot change anything and file-write confirmations can disappear.
#:
#: "Read-only" means no writes, not "read anything". On macOS/Linux the
#: readable set is the same as workspace-write: outside the workspace is
#: still unreachable. If this tier were the widest read, isolation would
#: be theatre.
#:
#: This is not a network sandbox. File effects only; network and process
#: actions still need a human decision.
READ_ONLY = "read-only"
#: Workspace-write: only workspace roots and the private temp directory are
#: writable. On macOS/Linux reads are also limited to the workspace, read-only
#: mounts, the temp directory, and toolchain prefixes.
WORKSPACE_WRITE = "workspace-write"
#: Unrestricted: no OS backend is applied.
DANGER_FULL_ACCESS = "danger-full-access"

COMMAND_SANDBOX_PERMISSIONS = frozenset(
    {READ_ONLY, WORKSPACE_WRITE, DANGER_FULL_ACCESS}
)
#: Tiers that are actually enforced by an OS backend.
CONFINED_PERMISSIONS = frozenset({READ_ONLY, WORKSPACE_WRITE})
WINDOWS_MXC_SCHEMA_VERSION = "0.7.0-alpha"
WINDOWS_MXC_EXECUTABLE_ENV = "AGX_WINDOWS_SANDBOX_EXECUTABLE"
# Windows CreateProcess command lines are limited to 32,767 UTF-16 code units.
# Leave room for the runner path and the ``--config-base64`` argument itself.
WINDOWS_MXC_MAX_CONFIG_BASE64_CHARS = 30_000


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
    #: Extra readable directories beyond writable roots: session read-only
    #: mounts plus system/toolchain prefixes. The home directory is not here
    #: -- that is the whole of read isolation.
    #:
    #: Complete only when ``read_isolation == "full"``. On Windows the real
    #: readable set is wider (``USERPROFILE`` is granted). Do not treat this
    #: field as an inventory there; ``read_isolation`` already says so.
    readable_roots: tuple[Path, ...] = ()
    temp_dir: Optional[Path] = None
    #: Deny patterns from ``permissions.path_rules`` that reached the OS backend.
    deny_patterns: tuple[str, ...] = ()
    #: Concrete paths remounted read-only on Linux/Windows (macOS uses regex).
    denied_write_paths: tuple[Path, ...] = ()
    #: Whether this backend isolates reads. ``"full"`` = nothing outside the
    #: workspace, mounts, temp, and toolchain is readable; ``"none"`` = write
    #: isolation only.
    #:
    #: Separate from ``deny_enforcement``. One is "can we read outside the
    #: workspace"; the other is "how strictly are deny rules enforced".
    #: Windows is read=none and deny=partial -- both true; one merged field
    #: would lie on one platform.
    read_isolation: str = "none"
    #: ``"none"`` no deny rules; ``"full"`` the backend can express them;
    #: ``"partial"`` only paths that already existed at launch are blocked.
    #:
    #: This field exists so we cannot over-promise. macOS seatbelt takes
    #: regex, so a glob applies even to files created later. bubblewrap and
    #: Windows ProcessContainer take concrete paths enumerated once. The UI
    #: must see that difference.
    deny_enforcement: str = "none"


def normalize_command_permissions(value: object) -> str:
    """Return a supported permission value, defaulting to workspace isolation."""

    if value is None:
        return WORKSPACE_WRITE
    text = str(value).strip().lower()
    if not text:
        return WORKSPACE_WRITE
    if text not in COMMAND_SANDBOX_PERMISSIONS:
        return WORKSPACE_WRITE
    return text


def path_deny_enforcement_for_host(platform_name: Optional[str] = None) -> str:
    """How completely this host can enforce ``path_rules`` deny entries.

    The UI uses this to choose wording. One hardcoded sentence on three
    platforms over-promises on two of them.

    Returns:
        ``"full"``    macOS: seatbelt takes regex; globs cover later files.
        ``"partial"`` Linux/Windows: concrete paths only, enumerated at launch.
        ``"none"``    no backend, so no enforcement.
    """
    host = (platform_name or sys.platform).strip().lower()
    if host == "darwin":
        return "full"
    if host.startswith("linux") or host == "win32" or host.startswith("win"):
        return "partial"
    return "none"


def shell_read_isolation_for_host(platform_name: Optional[str] = None) -> str:
    """Whether shell reads on this host are confined to the workspace.

    Kept separate from :func:`path_deny_enforcement_for_host` because they
    diverge: Windows can still enforce deny writes (partial) while reads stay
    wide -- :func:`_windows_readonly_paths` grants ``USERPROFILE`` so
    toolchains run. One merged field would be false on one platform.

    Returns:
        ``"full"``  macOS/Linux: nothing outside workspace, mounts, temp,
        system, and toolchain is readable.
        ``"none"``  everyone else (including Windows): write isolation only.
    """
    host = (platform_name or sys.platform).strip().lower()
    if host == "darwin" or host.startswith("linux"):
        return "full"
    return "none"


def build_command_sandbox_plan(
    argv: Sequence[str],
    *,
    permissions: object = WORKSPACE_WRITE,
    writable_roots: Iterable[Path] = (),
    readable_roots: Iterable[Path] = (),
    scope_id: str = "default",
    cwd: Optional[Path] = None,
    environ: Optional[Mapping[str, str]] = None,
    platform_name: Optional[str] = None,
    denied_path_patterns: Iterable[str] = (),
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
        # This tier wraps nothing, so ``denied_path_patterns`` do not apply.
        # That is the definition, not a gap: the name means a one-shot break
        # of every file isolation.
        #
        # A fourth "almost full access but keep path rules" tier would make
        # it harder to know what was granted. Two other constraints hold:
        #   1. The confirm dialog says path rules will be bypassed.
        #   2. It is never persisted -- ``host_full_access`` is in
        #      NEVER_AUTO_APPROVED_CATEGORIES, and reuse is only offered
        #      for workspace-write. Every time needs a new click.
        return CommandSandboxPlan(
            argv=raw_argv,
            env=base_env,
            permissions=resolved_permissions,
            backend="none",
        )

    if resolved_permissions == READ_ONLY:
        # Read-only needs no writable workspace roots. The only writable
        # place is this invocation's temp dir: shells and tools (git, python)
        # break without a writable temp, and that tree lives outside the
        # workspace and is discarded.
        roots: tuple[Path, ...] = ()
        # The workspace must still be readable. "Read-only" means no writes,
        # not "you cannot even see the directory under study". After read
        # isolation this matters: drop it and getcwd fails, and research
        # work runs entirely at this tier.
        readable_roots = (*readable_roots, *writable_roots)
    else:
        roots = _normalize_writable_roots(writable_roots)
        if not roots:
            raise CommandSandboxUnavailable(
                "workspace-write requires at least one existing writable workspace root"
            )

    deny_patterns = tuple(
        text for raw in denied_path_patterns if (text := str(raw or "").strip())
    )

    temp_dir = _private_temp_dir(scope_id)
    allowed_roots = _normalize_writable_roots((*roots, temp_dir))
    base_env["TMPDIR"] = str(temp_dir)

    host = (platform_name or sys.platform).strip().lower()
    # Readable set = session read mounts + toolchain/system dirs. Workspace
    # roots are not listed here because they are writable; each backend
    # expresses "writable implies readable". Home is not included -- that
    # is the whole of read isolation.
    #
    # Read-only uses the same set: the tier refuses writes, it does not
    # grant reading other repos or ~/.ssh.
    allowed_read_roots = _normalize_writable_roots(readable_roots)
    toolchain_read_roots = _toolchain_read_roots(base_env, raw_argv, host=host)
    toolchain_read_files = _toolchain_read_files(base_env)
    confined_read_roots = _normalize_writable_roots(
        (*allowed_read_roots, *toolchain_read_roots)
    )
    # Roots walked when enumerating deny paths.
    #
    # Using only ``allowed_roots`` (workspace + temp) misses read-only
    # mounts: they are ro-bound so they are readable, but matching files
    # inside them would never be overlaid, and ``cat reference/.env`` would
    # succeed on Linux. macOS does not have this gap because it sinks
    # regex. Path-only backends must widen the walk themselves.
    #
    # Do not include toolchain/system prefixes. Walking ``/usr`` on every
    # command is too slow and immediately hits the 512-path cap, crowding
    # out workspace matches -- the protected surface would shrink.
    deny_scan_roots = _normalize_writable_roots((*allowed_roots, *allowed_read_roots))
    if host == "darwin":
        executable = Path("/usr/bin/sandbox-exec")
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise CommandSandboxUnavailable("macOS sandbox-exec is not available")
        profile = _macos_profile(
            allowed_roots,
            deny_patterns,
            readable_roots=confined_read_roots,
            readable_files=toolchain_read_files,
        )
        wrapped = (str(executable), "-p", profile, *raw_argv)
        backend = "macos-sandbox-exec"
        # seatbelt takes regex, so a glob also covers files created later.
        deny_enforcement = "full" if deny_patterns else "none"
        denied_paths: tuple[Path, ...] = ()
    elif host.startswith("linux"):
        executable_text = shutil.which("bwrap")
        if not executable_text:
            raise CommandSandboxUnavailable(
                "bubblewrap (bwrap) is required for workspace-write on Linux"
            )
        denied_paths, complete = (
            _enumerate_denied_paths(deny_scan_roots, deny_patterns)
            if deny_patterns
            else ((), True)
        )
        wrapped = _bubblewrap_argv(
            executable_text,
            raw_argv,
            allowed_roots,
            cwd=cwd,
            denied_paths=denied_paths,
            readable_roots=confined_read_roots,
            readable_files=toolchain_read_files,
        )
        backend = "linux-bubblewrap"
        # bubblewrap takes concrete paths, not globs. Files created after
        # launch are not blocked -- report partial, do not claim macOS parity.
        deny_enforcement = "none" if not deny_patterns else "partial"
        if deny_patterns and not complete:
            # Hit the enumeration cap: even paths that already existed are
            # not fully covered. Still partial, but worse -- log it so the
            # downgrade is not silent.
            _log.warning(
                "path_rules deny enumeration hit the %d-path cap in %s; "
                "some existing matches are still writable",
                MAX_ENUMERATED_DENY_PATHS,
                ", ".join(str(root) for root in deny_scan_roots),
            )
    elif host == "win32" or host.startswith("win"):
        executable = _windows_mxc_executable(base_env)
        base_env["TEMP"] = str(temp_dir)
        base_env["TMP"] = str(temp_dir)
        denied_paths, complete = (
            _enumerate_denied_paths(deny_scan_roots, deny_patterns)
            if deny_patterns
            else ((), True)
        )
        if deny_patterns and not complete:
            _log.warning(
                "path_rules deny enumeration hit the %d-path cap in %s; "
                "some existing matches are still writable",
                MAX_ENUMERATED_DENY_PATHS,
                ", ".join(str(root) for root in deny_scan_roots),
            )
        wrapped = _windows_mxc_argv(
            executable,
            raw_argv,
            allowed_roots,
            readable_roots=allowed_read_roots,
            cwd=cwd,
            scope_id=scope_id,
            environ=base_env,
            denied_paths=denied_paths,
        )
        backend = "windows-mxc-process-container"
        # Same as Linux: ProcessContainer readonlyPaths are concrete paths.
        deny_enforcement = "none" if not deny_patterns else "partial"
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
        readable_roots=confined_read_roots,
        temp_dir=temp_dir,
        deny_patterns=deny_patterns,
        denied_write_paths=denied_paths,
        deny_enforcement=deny_enforcement,
        read_isolation=shell_read_isolation_for_host(host),
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
    # Unique per invocation: the same scope_id must never reuse a temp tree.
    target = root / digest / uuid.uuid4().hex
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        target.chmod(0o700)
    except OSError:
        pass
    return target.resolve(strict=False)


def _scheme_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


#: Cap on enumerated deny paths. Workspaces can be huge (node_modules) and
#: this runs on every command launch. Hitting the cap is not a hard failure:
#: deny_enforcement becomes "partial" and is reported. Silently skipping
#: matches is the actual problem.
MAX_ENUMERATED_DENY_PATHS = 512


def _scheme_regex_literal(regex: str) -> str:
    """Quote a regex for SBPL's ``#"…"`` literal.

    Do not reuse :func:`_scheme_string`. It doubles backslashes as Scheme
    strings do, and in a regex literal ``\\.`` then means "backslash plus
    any character" -- the intended literal dot is gone. Measured: after
    doubling, ``deny */.env`` matched nothing and ``rm .env`` still deleted.
    """
    return '"' + regex.replace('"', '\\"') + '"'


def _glob_to_posix_regex(pattern: str) -> str:
    """Translate one ``path_rules`` glob into a seatbelt-compatible regex.

    Must match the same paths as
    :func:`agenticx.runtime.path_policy.match_path_rules`, otherwise the
    settings UI and the sandbox would disagree. That helper uses
    :func:`fnmatch.fnmatch`, so ``*`` crosses ``/`` -- not the shell ``*``
    that stops at a directory. Keep that semantics.

    Do not use ``fnmatch.translate``: it emits Python regex
    (``(?s:...)\\Z``); seatbelt wants POSIX ERE.
    """
    text = pattern.replace("\\", "/")
    out = ["^"]
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        index += 1
        if char == "*":
            out.append(".*")
        elif char == "?":
            out.append(".")
        elif char == "[":
            # Keep fnmatch character classes. Escaping every [ would make
            # ``secret[0-9].key`` a class in the UI and a literal in the
            # sandbox.
            close = text.find("]", index + 1 if index < length and text[index] in "!]" else index)
            if close < 0:
                out.append("\\[")  # unclosed: fnmatch treats [ as literal
                continue
            body = text[index:close]
            index = close + 1
            if body.startswith("!"):
                body = "^" + body[1:]
            out.append("[" + body.replace("\\", "\\\\") + "]")
        elif char in ".^$+(){}]|\\":
            out.append("\\" + char)
        else:
            out.append(char)
    out.append("$")
    return "".join(out)


def _enumerate_denied_paths(
    writable_roots: Sequence[Path],
    patterns: Sequence[str],
) -> tuple[tuple[Path, ...], bool]:
    """Concrete paths under ``writable_roots`` that a deny rule matches.

    Search only under writable roots. Outside the workspace writes already
    fail, so ``deny /etc/*`` needs no work here. That shrinks "walk the
    disk" to "walk the workspace", which is why this can run on the
    command launch path.

    Returns:
        ``(paths, complete)``. ``complete`` is False when the cap was hit;
        the caller must downgrade deny_enforcement.
    """
    from agenticx.runtime.path_policy import match_path_rules

    rules = [(pattern, False) for pattern in patterns]
    found: list[Path] = []
    seen: set[str] = set()
    complete = True
    for root in writable_roots:
        for current, dirnames, filenames in os.walk(root, followlinks=False):
            if len(found) >= MAX_ENUMERATED_DENY_PATHS:
                complete = False
                break
            base = Path(current)
            # A denied directory needs no walk: remounted read-only, children cannot be written.
            kept: list[str] = []
            for name in dirnames:
                child = base / name
                decision, _ = match_path_rules(child, rules)
                if decision is False:
                    key = os.path.normcase(str(child))
                    if key not in seen:
                        seen.add(key)
                        found.append(child)
                else:
                    kept.append(name)
            dirnames[:] = kept
            for name in filenames:
                child = base / name
                decision, _ = match_path_rules(child, rules)
                if decision is False:
                    key = os.path.normcase(str(child))
                    if key not in seen:
                        seen.add(key)
                        found.append(child)
                if len(found) >= MAX_ENUMERATED_DENY_PATHS:
                    complete = False
                    break
        if not complete:
            break
    return tuple(found), complete


#: System directories that must stay readable under read isolation (POSIX).
#:
#: Isolation means "outside the workspace is unread", not "read nothing".
#: The latter kills python/node/git at dynlink time and users disable the
#: whole feature. System and toolchain dirs are therefore an explicit
#: allow-list, written once instead of once per backend.
_POSIX_SYSTEM_READ_ROOTS: tuple[str, ...] = (
    "/bin",
    "/sbin",
    "/usr",
    "/etc",
    "/opt",
    "/lib",
    "/lib64",
    "/var/lib",
    "/var/db",
    "/var/select",
)
#: macOS-only: system libraries, developer tools, dyld cache. Without them
#: even /bin/sh cannot start.
_MACOS_SYSTEM_READ_ROOTS: tuple[str, ...] = (
    # Linux omits /dev: bwrap mounts a private devtmpfs with ``--dev /dev``.
    # Ro-binding the host /dev would overwrite that. seatbelt has no such
    # layer, so /dev is listed only on this side.
    "/dev",
    "/System",
    "/Library",
    "/private/etc",
    "/private/var/db",
    "/private/var/select",
    "/private/var/run",
    "/Applications/Xcode.app",
)
#: Linux-only prefixes (Nix, Flatpak, etc.); bound only when present.
_LINUX_SYSTEM_READ_ROOTS: tuple[str, ...] = (
    "/nix",
    "/snap",
    "/run/current-system",
)

#: Env keys that point at toolchain installs. Same table as
#: :func:`_windows_readonly_paths` -- "where is the toolchain" must not
#: have three platform-specific answers.
_TOOLCHAIN_PATH_ENV_KEYS: tuple[str, ...] = (
    "PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "VIRTUAL_ENV",
    "CONDA_PREFIX",
    "NODE_PATH",
    "NVM_DIR",
    "PNPM_HOME",
    "BUN_INSTALL",
    "DENO_DIR",
    "GOPATH",
    "GOROOT",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "JAVA_HOME",
    "SDKMAN_DIR",
    "GEM_HOME",
    "RBENV_ROOT",
    "PYENV_ROOT",
    "ASDF_DIR",
    "ASDF_DATA_DIR",
)

#: Named home-dir tool configs that may be read. Every entry needs a reason.
#:
#: This is the easiest place to silently hollow out read isolation. Only
#: add names that clearly break without them and are not credentials: git
#: without ``~/.gitconfig`` has no user.name and commits fail.
#:
#: Do not add because "some command errored": ``~/.ssh``, ``~/.aws``,
#: ``~/.netrc``, ``~/.npmrc``, ``~/.config/gh``, ``~/.kube``, ``~/.docker``
#: hold exactly what this isolation is for. Need them: mount as a read-only
#: reference, or use ``danger-full-access``. Both leave a trail.
_HOME_TOOL_CONFIG_NAMES: tuple[str, ...] = (
    ".gitconfig",
    ".gitignore_global",
    ".config/git",
)


def _existing_dirs(candidates: Iterable[Path]) -> tuple[Path, ...]:
    """Resolve, de-duplicate, and drop anything that is not an existing directory.

    Both backends need this: bwrap fails on a missing bind source; a
    seatbelt subpath to a missing directory is just noise.
    """
    out: list[Path] = []
    seen: set[str] = set()
    for raw in candidates:
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


def _over_broad_read_roots(environ: Mapping[str, str]) -> frozenset[str]:
    """Paths that, if granted as readable, void read isolation entirely.

    Not defensive coding: ``/bin/sh`` prefix walk (parent.name == "bin")
    produced ``/``, so the allow-list gained
    ``(allow file-read-data (subpath "/"))``. The other thirty rules were
    correct and writes still worked, so the sandbox looked healthy.

    That failure has no symptom -- no error, no downgrade, no log -- until
    an outside read is tried. Block it here instead of relying on memory.
    """
    blocked = {"/", "/Users", "/home", "/root", "/private", "/Volumes"}
    for key in ("HOME", "USERPROFILE"):
        value = str(environ.get(key, "") or "").strip()
        if value:
            try:
                blocked.add(str(Path(value).expanduser().resolve(strict=False)))
            except (OSError, RuntimeError, ValueError):
                continue
    return frozenset(os.path.normcase(text) for text in blocked)


def _toolchain_read_roots(
    environ: Mapping[str, str],
    argv: Sequence[str],
    *,
    host: str,
) -> tuple[Path, ...]:
    """Directories a confined command must still be able to read from.

    Three sources, all "will not start without them", not convenience:

    1. System dirs -- ``/usr``, ``/etc``, macOS ``/System``.
    2. Prefixes from ``PATH`` and toolchain env vars. venv/pyenv/nvm/cargo
       locations are user-specific; a hard-coded guess will miss them.
    3. The prefix of the executable itself. ``/some/venv/bin/python`` must
       read ``/some/venv/lib``, so a trailing ``bin/`` also grants parent.

    Home is not included. That is the point: ``~/.ssh``, ``~/.aws``, other
    repos, documents. A few named tool configs are granted separately; see
    :data:`_HOME_TOOL_CONFIG_NAMES`.
    """
    candidates: list[Path] = [Path(text) for text in _POSIX_SYSTEM_READ_ROOTS]
    if host == "darwin":
        candidates.extend(Path(text) for text in _MACOS_SYSTEM_READ_ROOTS)
    elif host.startswith("linux"):
        candidates.extend(Path(text) for text in _LINUX_SYSTEM_READ_ROOTS)

    for key in _TOOLCHAIN_PATH_ENV_KEYS:
        value = str(environ.get(key, "") or "").strip()
        if not value:
            continue
        for part in value.split(os.pathsep):
            text = part.strip()
            if text:
                candidates.append(Path(text))

    # Interpreter prefix. Sub-agents often reuse this python, which may live
    # somewhere the lists above miss (uv, pyenv, out-of-tree frameworks).
    for prefix in (sys.prefix, sys.base_prefix, sys.exec_prefix):
        text = str(prefix or "").strip()
        if text:
            candidates.append(Path(text))

    if argv:
        first = str(argv[0] or "").strip()
        resolved = shutil.which(first, path=str(environ.get("PATH", "") or "")) or (
            first if first and Path(first).is_absolute() else ""
        )
        if resolved:
            binary = Path(resolved)
            candidates.append(binary.parent)
            # ``/some/venv/bin/python`` must read ``/some/venv/lib``. The
            # parent of ``/bin/sh`` is ``/`` -- that would void isolation;
            # :func:`_over_broad_read_roots` catches it.
            if binary.parent.name == "bin":
                candidates.append(binary.parent.parent)

    home_text = str(environ.get("HOME", "") or "").strip()
    if home_text:
        home = Path(home_text)
        for name in _HOME_TOOL_CONFIG_NAMES:
            candidates.append(home / name)

    blocked = _over_broad_read_roots(environ)
    return tuple(
        path
        for path in _existing_dirs(candidates)
        if os.path.normcase(str(path)) not in blocked
    )


def _toolchain_read_files(environ: Mapping[str, str]) -> tuple[Path, ...]:
    """Named home-dir tool configs that are files.

    Returned separately because seatbelt writes files as ``literal`` and
    directories as ``subpath``. Writing a file as a subpath would also
    grant siblings -- ``~/.gitconfig`` as a subpath of ``~`` would undo
    this isolation.
    """
    home_text = str(environ.get("HOME", "") or "").strip()
    if not home_text:
        return ()
    out: list[Path] = []
    seen: set[str] = set()
    for name in _HOME_TOOL_CONFIG_NAMES:
        try:
            path = (Path(home_text) / name).expanduser().resolve(strict=False)
        except (OSError, RuntimeError, ValueError):
            continue
        if not path.is_file():
            continue
        key = os.path.normcase(str(path))
        if key not in seen:
            seen.add(key)
            out.append(path)
    return tuple(out)


def _macos_profile(
    writable_roots: Sequence[Path],
    deny_patterns: Sequence[str] = (),
    readable_roots: Sequence[Path] = (),
    readable_files: Sequence[Path] = (),
) -> str:
    """Build the seatbelt profile: reads and writes are both confined.

    The read boundary is a different shape from the write boundary.

    Deny ``file-read-data``, not ``file-read*``. The latter also denies
    metadata, and reaching ``/Users/me/proj/x`` must stat every ancestor
    -- ``/``, ``/Users``, ``/Users/me`` -- none of which are on the
    allow-list, so even allowed paths fail. Granting metadata leaks
    existence/size/mtime, not content. Write that trade-off here or the
    next editor will delete the unexplained ``file-read-metadata``.

    ``/dev`` is fully allowed. The shell needs ``/dev/null``, ``/dev/tty``,
    ``/dev/urandom``; missing one is an un-attributable failure.

    Rule order: later seatbelt rules override earlier ones, so deny comes
    after allow. Deny-first was tried once and the workspace subpath
    overwrote it.
    """
    lines = [
        "(version 1)",
        "(allow default)",
        "(deny file-read-data file-write*)",
        # See docstring: ancestor stats must be allowed or allowed paths fail.
        "(allow file-read-metadata)",
        '(allow file-read-data file-write* (literal "/dev/null"))',
        '(allow file-read-data (subpath "/dev"))',
        # The root itself. Without this line nothing starts -- dyld reads
        # "/" and aborts with exit 134 and empty stdout/stderr. Found by
        # bisection; leave the comment.
        '(allow file-read-data (literal "/"))',
    ]
    lines.extend(
        f"(allow file-read-data (subpath {_scheme_string(str(root))}))"
        for root in readable_roots
    )
    lines.extend(
        f"(allow file-read-data (literal {_scheme_string(str(path))}))"
        for path in readable_files
    )
    # Writable implies readable: grant both here, not twice above.
    for root in writable_roots:
        quoted = _scheme_string(str(root))
        lines.append(f"(allow file-read-data (subpath {quoted}))")
        lines.append(f"(allow file-write* (subpath {quoted}))")
    # Deny after allow: later seatbelt rules win. Deny-first is overwritten
    # by the workspace (allow … subpath).
    #
    # Deny reads and writes together. ``**/.env`` means "do not touch",
    # not "do not write". Blocking rm but not cat protects the wrong half.
    lines.extend(
        f"(deny file-read-data file-write* "
        f"(regex #{_scheme_regex_literal(_glob_to_posix_regex(pattern))}))"
        for pattern in deny_patterns
    )
    # Later rules win. These binaries hand work to an unsandboxed host
    # process (AppleEvents / launchd). File allows above must not reopen
    # process-exec. Do not switch the profile to (deny default).
    lines.append(
        "(deny process-exec process-exec-interpreter "
        '(regex #"/(osascript|osacompile|launchctl|crontab)$"))'
    )
    return "\n".join(lines)


def _bubblewrap_argv(
    executable: str,
    argv: tuple[str, ...],
    writable_roots: Sequence[Path],
    *,
    cwd: Optional[Path],
    denied_paths: Sequence[Path] = (),
    readable_roots: Sequence[Path] = (),
    readable_files: Sequence[Path] = (),
) -> tuple[str, ...]:
    """Build the bubblewrap argv: nothing is visible unless it is bound in.

    The first revision used ``--ro-bind / /``, which copied the whole host
    root in, so there was no read boundary: ``cat ~/.ssh/id_rsa`` still
    worked. Bindings are now enumerated; home is not among them, so paths
    outside the workspace do not exist in the namespace (ENOENT, not EACCES).

    Use ``--ro-bind-try``, not ``--ro-bind``: half the list is missing on
    any given machine (``/nix``, ``/snap``, unused toolchain prefixes), and
    ``--ro-bind`` of a missing source fails the whole launch -- "rust is
    not installed" would become "no command can run".

    Two order constraints:
    - Writable binds after read-only. Later binds win; reverse that and
      the workspace becomes read-only.
    - Deny overlays last, for the same reason.

    PID namespace isolation makes ``/proc`` show only processes inside
    the sandbox. This function is still not a network sandbox.
    """
    wrapped: list[str] = [
        executable,
        "--die-with-parent",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
        "--new-session",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
    ]
    for root in readable_roots:
        path = str(root)
        wrapped.extend(("--ro-bind-try", path, path))
    for path_obj in readable_files:
        path = str(path_obj)
        wrapped.extend(("--ro-bind-try", path, path))
    for root in writable_roots:
        path = str(root)
        wrapped.extend(("--bind", path, path))
    # After writable binds: later bwrap binds win, so reverse order would
    # leave these paths writable.
    #
    # Reads must be blocked too, so remounting read-only is not enough.
    # Files are covered with /dev/null (empty read, write denied); dirs
    # with a read-only tmpfs (empty listing). Neither is "an error"; both
    # are "nothing is here", which is the intended effect.
    for denied in denied_paths:
        path = str(denied)
        if denied.is_dir():
            wrapped.extend(("--tmpfs", path, "--remount-ro", path))
        else:
            wrapped.extend(("--ro-bind", "/dev/null", path))
    # Last: remount the namespace root read-only.
    #
    # bwrap's new root is a tmpfs and parent dirs of bind targets are
    # created automatically, so unbound paths stay writable --
    # ``/work/outside.txt`` succeeds on the throwaway tmpfs and the host
    # is fine. Security holds; the model sees a false success (rc=0, no
    # output) and later steps rest on that lie. Found on Linux.
    #
    # After remount the same command gets "Read-only file system". The
    # workspace bind is a separate mount and stays writable.
    wrapped.append("--remount-ro")
    wrapped.append("/")
    if cwd is not None:
        wrapped.extend(("--chdir", str(cwd.resolve(strict=False))))
    wrapped.extend(("--", *argv))
    return tuple(wrapped)


def _windows_mxc_executable(environ: Mapping[str, str]) -> str:
    """Resolve the bundled Microsoft MXC runner without unsafe fallback."""

    configured = str(environ.get(WINDOWS_MXC_EXECUTABLE_ENV, "") or "").strip()
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_file():
            return str(candidate.resolve(strict=False))
        raise CommandSandboxUnavailable(
            f"configured Windows sandbox runner does not exist: {candidate}"
        )

    discovered = shutil.which("wxc-exec.exe") or shutil.which("wxc-exec")
    if discovered and Path(discovered).is_file():
        return str(Path(discovered).resolve(strict=False))
    raise CommandSandboxUnavailable(
        "Microsoft MXC wxc-exec.exe is required for workspace-write on Windows; "
        f"install the bundled desktop runtime or set {WINDOWS_MXC_EXECUTABLE_ENV}"
    )


def _path_is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _windows_readonly_paths(
    writable_roots: Sequence[Path],
    *,
    readable_roots: Sequence[Path],
    argv: Sequence[str],
    cwd: Optional[Path],
    environ: Mapping[str, str],
) -> tuple[Path, ...]:
    """Grant compatibility reads without granting another writable tree.

    Windows ProcessContainer is read-deny-by-default. Session read mounts, the
    user's existing profile, and discovered toolchain directories keep normal
    development commands working while the deeper workspace grants remain the
    only writable host paths. Windows/system program directories normally
    already carry ``ALL APPLICATION PACKAGES`` read ACLs and are deliberately
    not mutated here.
    """

    candidates: list[Path] = list(readable_roots)
    for key in ("USERPROFILE",):
        value = str(environ.get(key, "") or "").strip()
        if value:
            candidates.append(Path(value))
    for key in (
        "PYTHONPATH",
        "PYTHONHOME",
        "VCINSTALLDIR",
        "VSINSTALLDIR",
        "PSModulePath",
        "VCPKG_ROOT",
        "GOPATH",
        "GOROOT",
        "CARGO_HOME",
        "RUSTUP_HOME",
        "JAVA_HOME",
        "NVM_HOME",
        "NVM_SYMLINK",
        "NODE_PATH",
        "DOTNET_ROOT",
        "CONDA_PREFIX",
        "VIRTUAL_ENV",
    ):
        value = str(environ.get(key, "") or "").strip()
        if not value:
            continue
        candidates.extend(Path(part) for part in value.split(os.pathsep) if part.strip())
    for value in str(environ.get("PATH", "") or "").split(os.pathsep):
        if value.strip():
            candidates.append(Path(value.strip()))
    if cwd is not None:
        candidates.append(cwd)
    if argv and Path(argv[0]).is_absolute():
        candidates.append(Path(argv[0]).parent)

    normalized = _normalize_writable_roots(candidates)
    implicit_system_reads = _normalize_writable_roots(
        Path(value)
        for key in ("SystemRoot", "WINDIR", "ProgramFiles", "ProgramFiles(x86)")
        if (value := str(environ.get(key, "") or "").strip())
    )
    return tuple(
        path
        for path in normalized
        if not any(_path_is_within(path, writable) for writable in writable_roots)
        and not any(_path_is_within(path, system) for system in implicit_system_reads)
    )


def _windows_mxc_argv(
    executable: str,
    argv: tuple[str, ...],
    writable_roots: Sequence[Path],
    *,
    readable_roots: Sequence[Path],
    cwd: Optional[Path],
    scope_id: str,
    environ: Mapping[str, str],
    denied_paths: Sequence[Path] = (),
) -> tuple[str, ...]:
    """Encode a one-shot ProcessContainer request for the native MXC runner."""

    readonly_paths = _windows_readonly_paths(
        writable_roots,
        readable_roots=readable_roots,
        argv=argv,
        cwd=cwd,
        environ=environ,
    )
    scope_digest = hashlib.sha256(
        str(scope_id or "default").encode("utf-8", errors="replace")
    ).hexdigest()[:12]
    config: dict[str, object] = {
        "version": WINDOWS_MXC_SCHEMA_VERSION,
        "containerId": f"agenticx-{scope_digest}-{uuid.uuid4().hex}",
        "containment": "processcontainer",
        "lifecycle": {"destroyOnExit": True, "preservePolicy": False},
        "process": {
            "commandLine": subprocess.list2cmdline(list(argv)),
            **({"cwd": str(cwd.resolve(strict=False))} if cwd is not None else {}),
        },
        "filesystem": {
            "readwritePaths": [str(path) for path in writable_roots],
            # Denied workspace paths and compatibility reads share one
            # readonly table. They are more specific than readwritePaths;
            # ProcessContainer matches longest prefix, so the workspace
            # stays writable while these entries stay read-only.
            "readonlyPaths": [
                *(str(path) for path in readonly_paths),
                *(str(path) for path in denied_paths),
            ],
        },
        # This change is write isolation only. Explicitly preserve the current
        # unrestricted network and UI behavior instead of accepting MXC's
        # default-deny settings for those independent capabilities.
        "network": {"defaultPolicy": "allow", "allowLocalNetwork": True},
        "ui": {"disable": False, "clipboard": "all", "injection": True},
        "processContainer": {
            "ui": {
                "isolation": "desktop",
                "desktopSystemControl": True,
                "systemSettings": "all",
                "ime": True,
            }
        },
        "fallback": {"allowDaclMutation": True},
    }
    payload = json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded = base64.b64encode(payload).decode("ascii")
    if len(encoded) > WINDOWS_MXC_MAX_CONFIG_BASE64_CHARS:
        raise CommandSandboxUnavailable(
            "Windows sandbox request is too long for CreateProcess; split the command "
            "into a script inside the workspace and run that script instead"
        )
    return (executable, "--config-base64", encoded)
