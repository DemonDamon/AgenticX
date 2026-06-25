"""Smoke tests for RegistryHub default ClawHub registry injection."""

from __future__ import annotations

from agenticx.extensions.registry_hub import RegistryHub, SearchResult


def test_registry_hub_injects_default_clawhub_when_empty() -> None:
    hub = RegistryHub(registries=[])
    assert hub.using_default_clawhub is True
    assert any(r.get("name") == "clawhub" for r in hub._registries)


def test_registry_hub_keeps_configured_clawhub() -> None:
    hub = RegistryHub(
        registries=[
            {"name": "my-claw", "url": "https://example.com/api", "type": "clawhub"},
        ]
    )
    assert hub.using_default_clawhub is False
    assert len(hub._registries) == 1
    assert hub._registries[0]["name"] == "my-claw"


def test_registry_hub_injects_clawhub_when_only_agx_configured() -> None:
    hub = RegistryHub(
        registries=[
            {"name": "official", "url": "https://registry.agxbuilder.com", "type": "agx"},
        ]
    )
    assert hub.using_default_clawhub is True
    assert len(hub._registries) == 2
    assert any(r.get("type") == "clawhub" for r in hub._registries)


def test_registry_hub_search_uses_injected_clawhub(monkeypatch) -> None:
    hub = RegistryHub(registries=[])

    def _fake_clawhub(url: str, source_name: str, query: str) -> list[SearchResult]:
        assert source_name == "clawhub"
        assert url.endswith("/api")
        return [
            SearchResult(
                name="ui-design",
                description="UI Design skill",
                source="clawhub",
                source_type="clawhub",
            )
        ]

    monkeypatch.setattr(hub, "_search_clawhub", _fake_clawhub)
    results = hub.search("ui-design")
    assert len(results) == 1
    assert results[0].name == "ui-design"
