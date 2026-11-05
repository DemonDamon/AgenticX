"""Exercise real crypto callers before widening an optional dependency bound."""

import base64
import json
import struct

import pytest

pytest.importorskip("cryptography")

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from agenticx.gateway.crypto_utils import decrypt_feishu_event, decrypt_wecom_message
from agenticx.tools.credentials import CredentialStore


def test_encrypted_credential_store_round_trips_across_reload(tmp_path):
    path = tmp_path / "credentials.json"
    store = CredentialStore(storage_path=str(path))
    store.set_credential("tenant-test", "test-tool", {"token": "synthetic-value"})
    assert "synthetic-value" not in path.read_text()
    restored = CredentialStore(storage_path=str(path))
    assert restored.get_credential("tenant-test", "test-tool") == {"token": "synthetic-value"}


@pytest.mark.parametrize("kind,payload", [("json", {"event": "synthetic"}), ("xml", "<xml>synthetic</xml>")])
def test_webhook_aes_decryption_still_uses_supported_interfaces(kind, payload):
    key = bytes(range(32))
    iv = bytes(range(16))
    body = (json.dumps(payload) if kind == "json" else payload).encode()
    plain = b"0" * 16 + struct.pack(">I", len(body)) + body
    padder = padding.PKCS7(algorithms.AES.block_size).padder()
    padded = padder.update(plain) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    encrypted = base64.b64encode(iv + encryptor.update(padded) + encryptor.finalize()).decode()
    encoded_key = base64.b64encode(key).decode().rstrip("=")
    decrypt = decrypt_feishu_event if kind == "json" else decrypt_wecom_message
    assert decrypt(encoded_key, encrypted) == payload
