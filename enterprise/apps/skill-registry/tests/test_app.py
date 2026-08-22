"""窄服务的接口契约测试。不联网、不碰真注册表。"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from skill_registry.app import create_app
from skill_registry.bundle import UnsafeBundleError, materialize
from skill_registry.config import Settings

SETTINGS = Settings(internal_token="t0ken", max_bundle_bytes=1024, fetch_timeout_seconds=5.0)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(SETTINGS))


def test_healthz_needs_no_token(client: TestClient) -> None:
    # 编排器探活不该持有凭据。
    assert client.get("/healthz").status_code == 200


def test_every_registry_route_requires_the_internal_token(client: TestClient) -> None:
    assert client.get("/registry/search?q=x").status_code == 401
    assert client.post("/registry/scan", json={"name": "x"}).status_code == 401


def test_a_wrong_token_is_rejected(client: TestClient) -> None:
    res = client.get("/registry/search?q=x", headers={"x-agx-internal-token": "t0keN"})
    assert res.status_code == 401


def test_scan_rejects_an_empty_name(client: TestClient) -> None:
    res = client.post(
        "/registry/scan", json={"name": "  "}, headers={"x-agx-internal-token": "t0ken"}
    )
    assert res.status_code == 400


def test_settings_refuse_to_start_without_a_token(monkeypatch: pytest.MonkeyPatch) -> None:
    # 这个服务能出公网、能解包，是这套部署里最不该匿名可达的一个。
    monkeypatch.delenv("SKILL_REGISTRY_INTERNAL_TOKEN", raising=False)
    monkeypatch.delenv("SKILL_REGISTRY_INTERNAL_TOKEN_FILE", raising=False)
    with pytest.raises(RuntimeError, match="refusing to start unauthenticated"):
        Settings.from_env()


def test_settings_read_the_token_from_a_file(monkeypatch: pytest.MonkeyPatch) -> None:
    # 长随机串塞不进 .env，Docker/K8s 也习惯挂 secret 文件。
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "token"
        path.write_text("from-file\n", encoding="utf-8")
        monkeypatch.delenv("SKILL_REGISTRY_INTERNAL_TOKEN", raising=False)
        monkeypatch.setenv("SKILL_REGISTRY_INTERNAL_TOKEN_FILE", str(path))
        assert Settings.from_env().internal_token == "from-file"


@pytest.mark.parametrize("name", ["../evil.md", "/etc/passwd", "a/../../evil", "", "  "])
def test_materialize_refuses_entries_that_escape_the_root(name: str) -> None:
    # 包内文件名来自公网，直接 join 就能写到目录外面去。
    with tempfile.TemporaryDirectory() as tmp:
        with pytest.raises(UnsafeBundleError):
            materialize({name: b"x"}, Path(tmp), max_total_bytes=1024)


def test_materialize_stops_before_filling_the_disk() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        with pytest.raises(UnsafeBundleError, match="exceeds"):
            materialize({"a": b"x" * 600, "b": b"y" * 600}, Path(tmp), max_total_bytes=1024)


def test_materialize_writes_nested_files_inside_the_root() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        bundle = materialize(
            {"SKILL.md": b"# hi", "lib/util.py": b"print(1)"}, root, max_total_bytes=1024
        )
        assert bundle.file_count == 2
        assert (root / "lib" / "util.py").read_bytes() == b"print(1)"
