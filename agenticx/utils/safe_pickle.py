"""Restricted pickle deserialization with class whitelisting.

Provides RestrictedUnpickler that only allows a predefined set of safe
module.class pairs, blocking arbitrary code execution via __reduce__.

Optional HMAC-signed pickle helpers (``signed_pickle_dump`` /
``signed_pickle_load``) verify integrity before calling ``safe_pickle_load``.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import hmac
import io
import pickle
from pathlib import Path
from typing import Any, BinaryIO, FrozenSet, Optional, Set, Tuple, Union

_SIG_LEN_BYTES = 4

_DEFAULT_ALLOWED: FrozenSet[Tuple[str, str]] = frozenset(
    {
        ("builtins", "dict"),
        ("builtins", "list"),
        ("builtins", "set"),
        ("builtins", "tuple"),
        ("builtins", "str"),
        ("builtins", "int"),
        ("builtins", "float"),
        ("builtins", "bool"),
        ("builtins", "bytes"),
        ("builtins", "complex"),
        ("builtins", "frozenset"),
        ("builtins", "slice"),
        ("builtins", "range"),
        ("collections", "OrderedDict"),
        ("collections", "defaultdict"),
        ("numpy", "ndarray"),
        ("numpy", "dtype"),
        ("numpy", "float64"),
        ("numpy", "float32"),
        ("numpy", "int64"),
        ("numpy", "int32"),
        ("numpy.core.multiarray", "_reconstruct"),
        ("numpy.core.multiarray", "scalar"),
        ("numpy", "core"),
        ("agenticx.storage.vectordb_storages.base", "VectorRecord"),
    }
)


class RestrictedUnpickler(pickle.Unpickler):
    """Unpickler that rejects classes not in an explicit allowlist.

    Any attempt to unpickle an object whose (module, qualname) pair is not
    in ``allowed_classes`` raises ``pickle.UnpicklingError``, preventing
    RCE payloads that rely on ``__reduce__`` / ``__reduce_ex__``.
    """

    def __init__(
        self,
        file: Any,
        *,
        allowed_classes: Optional[Set[Tuple[str, str]]] = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(file, **kwargs)
        self._allowed = (
            frozenset(allowed_classes) if allowed_classes else _DEFAULT_ALLOWED
        )

    def find_class(self, module: str, name: str) -> Any:
        if (module, name) not in self._allowed:
            raise pickle.UnpicklingError(
                f"Restricted: {module}.{name} is not in the deserialization allowlist"
            )
        return super().find_class(module, name)


def safe_pickle_load(
    file: Any,
    *,
    allowed_classes: Optional[Set[Tuple[str, str]]] = None,
) -> Any:
    """Drop-in replacement for ``pickle.load`` with class whitelisting.

    Args:
        file: A readable binary file object.
        allowed_classes: Optional override for the class allowlist.

    Returns:
        The deserialized object.

    Raises:
        pickle.UnpicklingError: If an unlisted class is encountered.
    """
    return RestrictedUnpickler(file, allowed_classes=allowed_classes).load()


def safe_pickle_loads(
    data: bytes,
    *,
    allowed_classes: Optional[Set[Tuple[str, str]]] = None,
) -> Any:
    """Drop-in replacement for ``pickle.loads`` with class whitelisting."""
    return RestrictedUnpickler(
        io.BytesIO(data), allowed_classes=allowed_classes
    ).load()


def signed_pickle_dumps(
    obj: Any,
    key: bytes,
    *,
    digestmod: Any = hashlib.sha256,
) -> bytes:
    """Serialize ``obj`` to pickle bytes prefixed with HMAC-SHA256 signature."""
    payload = pickle.dumps(obj, protocol=pickle.HIGHEST_PROTOCOL)
    mac = hmac.new(key, payload, digestmod).digest()
    return len(mac).to_bytes(_SIG_LEN_BYTES, "big") + mac + payload


def signed_pickle_dump(
    obj: Any,
    path: Union[str, Path],
    key: bytes,
    *,
    digestmod: Any = hashlib.sha256,
) -> None:
    """Write HMAC-signed pickle to ``path``."""
    data = signed_pickle_dumps(obj, key, digestmod=digestmod)
    Path(path).write_bytes(data)


def signed_pickle_loads(
    data: bytes,
    key: bytes,
    *,
    digestmod: Any = hashlib.sha256,
    allowed_classes: Optional[Set[Tuple[str, str]]] = None,
) -> Any:
    """Verify HMAC then deserialize with ``RestrictedUnpickler``."""
    if len(data) < _SIG_LEN_BYTES + 1:
        raise ValueError("Signed pickle payload too short")
    sig_len = int.from_bytes(data[:_SIG_LEN_BYTES], "big")
    if sig_len <= 0 or _SIG_LEN_BYTES + sig_len > len(data):
        raise ValueError("Invalid signed pickle header")
    sig = data[_SIG_LEN_BYTES : _SIG_LEN_BYTES + sig_len]
    payload = data[_SIG_LEN_BYTES + sig_len :]
    expected = hmac.new(key, payload, digestmod).digest()
    if not hmac.compare_digest(sig, expected):
        raise ValueError("HMAC verification failed (tampered or wrong key)")
    return safe_pickle_loads(payload, allowed_classes=allowed_classes)


def signed_pickle_load(
    file: BinaryIO,
    key: bytes,
    *,
    digestmod: Any = hashlib.sha256,
    allowed_classes: Optional[Set[Tuple[str, str]]] = None,
) -> Any:
    """Read file contents and pass to ``signed_pickle_loads``."""
    return signed_pickle_loads(file.read(), key, digestmod=digestmod, allowed_classes=allowed_classes)


def signed_pickle_load_path(
    path: Union[str, Path],
    key: bytes,
    *,
    digestmod: Any = hashlib.sha256,
    allowed_classes: Optional[Set[Tuple[str, str]]] = None,
) -> Any:
    """Load signed pickle from filesystem path."""
    return signed_pickle_loads(
        Path(path).read_bytes(),
        key,
        digestmod=digestmod,
        allowed_classes=allowed_classes,
    )
