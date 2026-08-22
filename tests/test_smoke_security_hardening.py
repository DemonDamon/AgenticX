"""Smoke tests for security hardening (audit 2026-04-07 v2).

Covers:
- RestrictedUnpickler (safe_pickle)
- calculator safe_eval
- confirmation timeout safety

Author: Damon Li
"""

from __future__ import annotations

import io
import os
import pickle
import pytest


# ---------------------------------------------------------------------------
# 1. RestrictedUnpickler
# ---------------------------------------------------------------------------

class TestSafePickle:
    """Verify RestrictedUnpickler blocks malicious payloads."""

    def test_safe_dict_roundtrip(self) -> None:
        from agenticx.utils.safe_pickle import safe_pickle_load

        data = {"key": "value", "numbers": [1, 2, 3]}
        buf = io.BytesIO()
        pickle.dump(data, buf)
        buf.seek(0)
        result = safe_pickle_load(buf)
        assert result == data

    def test_safe_list_roundtrip(self) -> None:
        from agenticx.utils.safe_pickle import safe_pickle_load

        data = [1, 2.0, "three", True, None]
        buf = io.BytesIO()
        pickle.dump(data, buf)
        buf.seek(0)
        result = safe_pickle_load(buf)
        assert result == data

    def test_blocks_os_system(self) -> None:
        """A pickle payload using os.system must be rejected."""
        from agenticx.utils.safe_pickle import safe_pickle_load

        class Exploit:
            def __reduce__(self):
                return (os.system, ("echo pwned",))

        buf = io.BytesIO()
        pickle.dump(Exploit(), buf)
        buf.seek(0)

        with pytest.raises(pickle.UnpicklingError, match="Restricted"):
            safe_pickle_load(buf)

    def test_blocks_subprocess(self) -> None:
        """A pickle payload using subprocess must be rejected."""
        from agenticx.utils.safe_pickle import safe_pickle_load

        import subprocess

        class Exploit:
            def __reduce__(self):
                return (subprocess.check_output, (["id"],))

        buf = io.BytesIO()
        pickle.dump(Exploit(), buf)
        buf.seek(0)

        with pytest.raises(pickle.UnpicklingError, match="Restricted"):
            safe_pickle_load(buf)

    def test_blocks_eval(self) -> None:
        """A pickle payload using eval must be rejected."""
        from agenticx.utils.safe_pickle import safe_pickle_load

        class Exploit:
            def __reduce__(self):
                return (eval, ("__import__('os').system('id')",))

        buf = io.BytesIO()
        pickle.dump(Exploit(), buf)
        buf.seek(0)

        with pytest.raises(pickle.UnpicklingError, match="Restricted"):
            safe_pickle_load(buf)

    def test_custom_allowlist(self) -> None:
        from agenticx.utils.safe_pickle import safe_pickle_load

        data = {"a": 1}
        buf = io.BytesIO()
        pickle.dump(data, buf)
        buf.seek(0)

        result = safe_pickle_load(
            buf,
            allowed_classes={("builtins", "dict"), ("builtins", "int"), ("builtins", "str")},
        )
        assert result == data

    def test_safe_pickle_loads(self) -> None:
        from agenticx.utils.safe_pickle import safe_pickle_loads

        data = [1, 2, 3]
        raw = pickle.dumps(data)
        result = safe_pickle_loads(raw)
        assert result == data

    def test_vector_record_list_roundtrip(self) -> None:
        from agenticx.storage.vectordb_storages.base import VectorRecord
        from agenticx.utils.safe_pickle import safe_pickle_load

        records = [
            VectorRecord(vector=[0.1, 0.2], id="a", payload={"k": 1}),
        ]
        buf = io.BytesIO()
        pickle.dump(records, buf)
        buf.seek(0)
        out = safe_pickle_load(buf)
        assert len(out) == 1
        assert out[0].id == "a"
        assert out[0].vector == [0.1, 0.2]

    def test_signed_pickle_roundtrip(self) -> None:
        from agenticx.utils.safe_pickle import signed_pickle_dumps, signed_pickle_loads

        key = b"test-secret-key-at-least-32-bytes-long!!"
        obj = {"x": 1, "y": [2, 3]}
        blob = signed_pickle_dumps(obj, key)
        assert signed_pickle_loads(blob, key) == obj

    def test_signed_pickle_rejects_wrong_key(self) -> None:
        from agenticx.utils.safe_pickle import signed_pickle_dumps, signed_pickle_loads

        blob = signed_pickle_dumps({"a": 1}, b"key-one-is-long-enough-for-hmac-sha256")
        with pytest.raises(ValueError, match="HMAC verification failed"):
            signed_pickle_loads(blob, b"key-two-is-long-enough-for-hmac-sha256")

    def test_signed_pickle_rejects_tampered_payload(self) -> None:
        from agenticx.utils.safe_pickle import signed_pickle_dumps, signed_pickle_loads

        key = b"tamper-test-key-must-be-long-for-hmac!!"
        blob = bytearray(signed_pickle_dumps([1, 2, 3], key))
        blob[-1] ^= 0xFF
        with pytest.raises(ValueError, match="HMAC verification failed"):
            signed_pickle_loads(bytes(blob), key)


# ---------------------------------------------------------------------------
# 2. Calculator safe eval
# ---------------------------------------------------------------------------

class TestCalculatorSafeEval:

    def test_basic_arithmetic(self) -> None:
        from agenticx.cli.templates.volcengine.mcp.agent import safe_math_eval

        assert safe_math_eval("2 + 3") == "5"
        assert safe_math_eval("10 * 5") == "50"
        assert safe_math_eval("100 / 4") == "25.0"

    def test_complex_expression(self) -> None:
        from agenticx.cli.templates.volcengine.mcp.agent import safe_math_eval

        assert safe_math_eval("2 + 3 * 4") == "14"

    def test_power(self) -> None:
        from agenticx.cli.templates.volcengine.mcp.agent import safe_math_eval

        assert safe_math_eval("2 ** 10") == "1024"

    def test_negative(self) -> None:
        from agenticx.cli.templates.volcengine.mcp.agent import safe_math_eval

        assert safe_math_eval("-5 + 3") == "-2"

    def test_blocks_import(self) -> None:
        from agenticx.cli.templates.volcengine.mcp.agent import safe_math_eval

        result = safe_math_eval("__import__('os').system('id')")
        assert "Error" in result

    def test_blocks_function_call(self) -> None:
        from agenticx.cli.templates.volcengine.mcp.agent import safe_math_eval

        result = safe_math_eval("print('hello')")
        assert "Error" in result

    def test_blocks_attribute_access(self) -> None:
        from agenticx.cli.templates.volcengine.mcp.agent import safe_math_eval

        result = safe_math_eval("''.__class__.__mro__")
        assert "Error" in result


# ---------------------------------------------------------------------------
# 6. Confirm gate timeout defaults
# ---------------------------------------------------------------------------

class TestConfirmGateTimeout:
    @pytest.mark.asyncio
    async def test_async_confirm_gate_timeout_defaults_to_reject(self) -> None:
        from agenticx.runtime.confirm import AsyncConfirmGate

        gate = AsyncConfirmGate(timeout_seconds=0.01)
        approved = await gate.request_confirm("confirm?", {"tool": "bash_exec"})
        assert approved is False
