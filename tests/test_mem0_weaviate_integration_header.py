import pytest

# weaviate-client 与 mem0ai 都是可选依赖，没装时跳过整个模块。
try:
    from weaviate import WeaviateClient
    from weaviate.connect import ConnectionParams

    from agenticx._version import __version__
    from agenticx.integrations.mem0.vector_stores.weaviate import _register_integration_header
except Exception as exc:
    pytest.skip(f"weaviate-client / mem0ai 未安装：{exc}", allow_module_level=True)

HEADER = "X-Weaviate-Client-Integration"


def _client(headers=None):
    # skip_init_checks + 不调用 connect()：只构造客户端，不访问网络
    return WeaviateClient(
        connection_params=ConnectionParams.from_url("http://localhost:8080", 50051),
        additional_headers=headers,
        skip_init_checks=True,
    )


def test_registers_agenticx_header():
    client = _client()
    _register_integration_header(client)
    assert client._connection.additional_headers[HEADER] == f"agenticx/{__version__}"


def test_user_supplied_header_wins():
    headers = {"x-weaviate-client-integration": "my-app/1.0"}
    client = _client(headers)
    _register_integration_header(client, headers)
    sent = client._connection.additional_headers
    assert sent["x-weaviate-client-integration"] == "my-app/1.0"
    assert HEADER not in sent


def test_registration_failure_is_swallowed():
    class Broken:
        @property
        def integrations(self):
            raise RuntimeError("boom")

    _register_integration_header(Broken())
