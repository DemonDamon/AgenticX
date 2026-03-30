#!/usr/bin/env python3
"""Optional AES helpers for Feishu / WeCom encrypted callbacks.

Author: Damon Li
"""

from __future__ import annotations

import base64
import json
import struct
from typing import Any


def _require_cryptography():
    try:
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import padding
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    except ImportError as exc:
        raise RuntimeError(
            "Decrypting IM webhooks requires the cryptography package. "
            "Install with: pip install cryptography"
        ) from exc
    return padding, Cipher, algorithms, modes, default_backend


def decrypt_feishu_event(encrypt_key_b64: str, ciphertext_b64: str) -> dict[str, Any]:
    """Decrypt Feishu event body (encrypt field) to a JSON object."""
    padding, Cipher, algorithms, modes, default_backend = _require_cryptography()
    key = base64.b64decode(encrypt_key_b64 + "=")
    raw = base64.b64decode(ciphertext_b64)
    if len(raw) < 16:
        raise ValueError("ciphertext too short")
    iv = raw[:16]
    body = raw[16:]
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    plain = decryptor.update(body) + decryptor.finalize()
    unpadder = padding.PKCS7(algorithms.AES.block_size).unpadder()
    plain = unpadder.update(plain) + unpadder.finalize()
    if len(plain) < 20:
        raise ValueError("decrypted payload too short")
    _random = plain[:16]
    del _random
    length = struct.unpack(">I", plain[16:20])[0]
    payload = plain[20 : 20 + length]
    text = payload.decode("utf-8")
    return json.loads(text)


def decrypt_wecom_message(encoding_aes_key_b64: str, ciphertext_b64: str) -> str:
    """Decrypt WeCom callback message body; returns XML string."""
    padding, Cipher, algorithms, modes, default_backend = _require_cryptography()
    key = base64.b64decode(encoding_aes_key_b64 + "=")
    raw = base64.b64decode(ciphertext_b64)
    if len(raw) < 16:
        raise ValueError("ciphertext too short")
    iv = raw[:16]
    body = raw[16:]
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    plain = decryptor.update(body) + decryptor.finalize()
    unpadder = padding.PKCS7(algorithms.AES.block_size).unpadder()
    plain = unpadder.update(plain) + unpadder.finalize()
    if len(plain) < 20:
        raise ValueError("decrypted payload too short")
    msg_len = struct.unpack(">I", plain[16:20])[0]
    msg = plain[20 : 20 + msg_len]
    return msg.decode("utf-8")
