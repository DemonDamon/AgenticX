"""
Utility for importing optional dependencies with clear error messages.

When a user hasn't installed the required extras group, they will see a
friendly message telling them exactly which ``pip install`` command to run.
"""

import importlib
from typing import Optional


def import_optional(
    module_name: str,
    extras_group: str,
    package_name: Optional[str] = None,
) -> "module":
    """Import an optional dependency, raising a helpful error if missing.

    Parameters
    ----------
    module_name : str
        Fully-qualified Python module name, e.g. ``"networkx"`` or
        ``"chromadb.config"``.
    extras_group : str
        The pip extras group that provides this dependency, e.g.
        ``"memory"``, ``"graph"``.  Used in the error message.
    package_name : str, optional
        Human-readable package name shown in the error message.  Defaults
        to *module_name* if not provided.

    Returns
    -------
    module
        The imported module object.

    Raises
    ------
    ImportError
        If the module cannot be imported.
    """
    try:
        return importlib.import_module(module_name)
    except ImportError:
        pkg = package_name or module_name
        raise ImportError(
            f"'{pkg}' is required for this feature but is not installed. "
            f"Install it with:\n\n"
            f"    pip install \"agenticx[{extras_group}]\"\n"
        ) from None


def is_module_available(module_name: str) -> bool:
    """Check whether a module is importable without raising."""
    try:
        importlib.import_module(module_name)
        return True
    except ImportError:
        return False
