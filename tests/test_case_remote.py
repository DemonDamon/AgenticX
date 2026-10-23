#!/usr/bin/env python3
"""SP-F2 remote client tests: config, request assembly, CLI --remote/--push branches.

No real service is started: httpx.Client is swapped (monkeypatch) for one
riding an httpx.MockTransport — the same injection pattern as
tests/test_gateway_device_rpc.py's fake studio.

Author: Damon Li
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import pytest
from typer.testing import CliRunner

from agenticx.cases import remote

TOKEN = "test-token"
BASE = "http://localhost:8420"
# Contract document-name rule (SP-F): names are joined into server file paths.
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


# --------------------------------------------------------------------------
# fake context-service（httpx.MockTransport 注入，替换所有 httpx.Client 传输）
# --------------------------------------------------------------------------


class FakeContextService:
    """Programmable stand-in for the enterprise context-service."""

    def __init__(self) -> None:
        self.requests: List[Dict[str, Any]] = []
        self.wiki_push: Dict[str, Any] = {}
        self.wiki_push_result: Optional[Dict[str, Any]] = None
        self.ingested: List[Dict[str, Any]] = []
        self.compiled: List[Dict[str, Any]] = []
        self.search_payload: Dict[str, Any] = {}
        self.search_cases: List[Dict[str, Any]] = []
        self.get_content: Dict[str, str] = {}
        self.error_status: Optional[int] = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        body: Dict[str, Any] = {}
        if request.content:
            import json

            body = json.loads(request.content.decode("utf-8"))
        self.requests.append(
            {
                "method": request.method,
                "path": request.url.path,
                "host": request.url.host,
                "token": request.headers.get("x-agx-internal-token"),
                "body": body,
                "params": dict(request.url.params),
            }
        )
        if self.error_status is not None:
            return httpx.Response(self.error_status, json={"detail": "boom"})
        path = request.url.path
        if request.method == "POST" and path == "/context/wiki/push":
            self.wiki_push = body
            if self.wiki_push_result is not None:
                return httpx.Response(200, json=self.wiki_push_result)
            pages = body.get("pages") or []
            return httpx.Response(
                200,
                json={
                    "ok": True,
                    "ingested": len(pages),
                    "compiled": len(pages) if body.get("compile") else 0,
                    "errors": [],
                },
            )
        if request.method == "POST" and path == "/context/ingest":
            self.ingested.append(body)
            return httpx.Response(
                200,
                json={"ok": True, "name": body.get("name"), "success": 1, "failed": 0},
            )
        if request.method == "POST" and path == "/context/compile":
            self.compiled.append(body)
            return httpx.Response(
                200,
                json={"ok": True, "written": 1, "skipped": False, "skipped_reason": "", "error": ""},
            )
        if request.method == "POST" and path == "/context/cases/search":
            self.search_payload = body
            return httpx.Response(200, json={"ok": True, "cases": self.search_cases})
        if request.method == "GET" and path == "/context/cases/get":
            case_id = request.url.params.get("case_id") or ""
            content = self.get_content.get(case_id)
            if content is None:
                return httpx.Response(404, json={"detail": f"case not found: {case_id}"})
            return httpx.Response(200, json={"ok": True, "case_id": case_id, "content": content})
        return httpx.Response(404, json={"detail": f"no fake for {path}"})


@pytest.fixture()
def fake_service(monkeypatch: pytest.MonkeyPatch) -> FakeContextService:
    fake = FakeContextService()
    transport = httpx.MockTransport(fake.handler)
    real_client = httpx.Client

    def _factory(*args: Any, **kwargs: Any) -> httpx.Client:
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", _factory)
    return fake


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_CONTEXT_SERVICE_URL", raising=False)
    monkeypatch.delenv("AGX_CONTEXT_SERVICE_TOKEN", raising=False)


def _invoke(*args: str) -> Any:
    from agenticx.cli.main import app

    return CliRunner().invoke(app, list(args))


def _completed_plan_path(tmp_path: Path) -> Path:
    from agenticx.delivery.plan_mdc import default_plan, update_stage, write_plan

    plan = default_plan(
        task_id="task0001",
        project_name="Demo Portal POC",
        target="POC",
        worktree_path=str(tmp_path / "worktree"),
        output_dir=str(tmp_path / "worktree" / "output" / "task0001"),
        input_files=["input/sample-rfp.md"],
    )
    update_stage(plan, "requirements", status="completed", artifacts=["output/task0001/requirement-breakdown.md"])
    update_stage(plan, "design", status="completed", artifacts=["output/task0001/design/design-system.md"])
    update_stage(plan, "development", status="completed", artifacts=["output/task0001/frontend/README.md"])
    update_stage(plan, "testing", status="completed", artifacts=["output/task0001/qa/playwright-report"])
    update_stage(plan, "audit", status="completed", artifacts=["output/task0001/delivery-summary.md"])
    plan_path = tmp_path / "worktree" / "plan.mdc"
    write_plan(plan_path, plan)
    return plan_path


def _cloud_case_md() -> str:
    from agenticx.cases.model import CaseEntry, render_case_md

    return render_case_md(
        CaseEntry(
            case_id="case-cloud-001",
            title="Cloud Retail Case",
            summary="云端零售案例",
            problem="连锁零售需要经营看板",
            solution="五阶段流水线 + 看板模板",
            scope={"domain": "retail"},
        )
    )


# ---------- config ----------


def test_service_config_args_env_and_default(monkeypatch: pytest.MonkeyPatch) -> None:
    # 显式参数最优先
    assert remote._service_config("http://arg:9000/", "arg-token") == ("http://arg:9000", "arg-token")

    # 无环境变量时用默认地址
    assert remote._service_config(token="t") == (remote.DEFAULT_SERVICE_URL, "t")

    # 环境变量兜底；URL 尾部斜杠被剥掉
    monkeypatch.setenv("AGX_CONTEXT_SERVICE_URL", "http://env-host:9000/")
    monkeypatch.setenv("AGX_CONTEXT_SERVICE_TOKEN", "env-token")
    assert remote._service_config() == ("http://env-host:9000", "env-token")


def test_service_config_missing_token_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_CONTEXT_SERVICE_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="AGX_CONTEXT_SERVICE_TOKEN"):
        remote._service_config()


# ---------- push_wiki / name 清洗 ----------


def test_push_wiki_sanitizes_names_and_sends_token(fake_service: FakeContextService, tmp_path: Path) -> None:
    wiki = tmp_path / "wiki"
    (wiki / "synthesis").mkdir(parents=True)
    (wiki / "synthesis" / "portal-guide.md").write_text("# guide\n", encoding="utf-8")
    (wiki / "配置指南.md").write_text("# 指南\n", encoding="utf-8")

    result = remote.push_wiki(wiki, token=TOKEN)

    assert result["ingested"] == 2
    assert result["compiled"] == 2
    assert fake_service.requests[0]["token"] == TOKEN  # x-agx-internal-token 头
    assert fake_service.wiki_push["compile"] is True

    by_name = {page["name"]: page["text"] for page in fake_service.wiki_push["pages"]}
    # / → __，.md 后缀去掉（服务端存 {name}.md）
    assert by_name["synthesis__portal-guide"] == "# guide\n"
    # 非 ASCII 名清洗后仍满足契约正则，且哈希后缀保证不同源文件不同名
    hashed = [name for name in by_name if name != "synthesis__portal-guide"]
    assert len(hashed) == 1
    assert _SAFE_NAME_RE.fullmatch(hashed[0])
    assert by_name[hashed[0]] == "# 指南\n"


def test_push_wiki_empty_dir_errors(fake_service: FakeContextService, tmp_path: Path) -> None:
    empty = tmp_path / "empty-wiki"
    empty.mkdir()
    with pytest.raises(RuntimeError, match="没有 .md 页面"):
        remote.push_wiki(empty, token=TOKEN)
    assert fake_service.requests == []


def test_page_name_ascii_paths_unchanged() -> None:
    assert remote._page_name("synthesis/portal-guide.md") == "synthesis__portal-guide"
    assert remote._page_name("root.md") == "root"
    assert remote._page_name("a/b/c.md") == "a__b__c"


# ---------- push_case / get_case_remote / search_cases_remote ----------


def test_push_case_ingests_and_compiles_by_case_id(fake_service: FakeContextService, tmp_path: Path) -> None:
    from agenticx.cases.model import CaseEntry, render_case_md

    md_path = tmp_path / "case.md"
    md_path.write_text(
        render_case_md(CaseEntry(case_id="case-task0001", title="Demo", summary="s")),
        encoding="utf-8",
    )

    result = remote.push_case(md_path, token=TOKEN)

    assert result["ingest"]["ok"] is True
    assert fake_service.ingested == [
        {"name": "case-task0001", "text": md_path.read_text(encoding="utf-8")}
    ]
    assert fake_service.compiled == [{"name": "case-task0001"}]


def test_get_case_remote_returns_content(fake_service: FakeContextService) -> None:
    fake_service.get_content["case-1"] = "---\ncase_id: case-1\n---\n\n# x\n"
    content = remote.get_case_remote("case-1", token=TOKEN)
    assert content == fake_service.get_content["case-1"]
    assert fake_service.requests[0]["method"] == "GET"
    assert fake_service.requests[0]["path"] == "/context/cases/get"
    assert fake_service.requests[0]["params"]["case_id"] == "case-1"

    # 云端不存在 → RuntimeError 带响应摘要
    with pytest.raises(RuntimeError, match="HTTP 404"):
        remote.get_case_remote("no-such-case", token=TOKEN)


def test_search_cases_remote_payload_and_extraction(fake_service: FakeContextService) -> None:
    fake_service.search_cases = [
        {"case_id": "case-a", "title": "A", "score": 3.0, "matched_on": ["summary"]}
    ]
    hits = remote.search_cases_remote("看板", scope_filter={"domain": "retail"}, top_k=3, token=TOKEN)
    assert hits == fake_service.search_cases
    assert fake_service.search_payload == {
        "query": "看板",
        "scope_filter": {"domain": "retail"},
        "top_k": 3,
    }

    # 无 filter 时 scope_filter 为空 dict（服务端硬过滤语义：无键放行）
    remote.search_cases_remote("任意", token=TOKEN)
    assert fake_service.search_payload["scope_filter"] == {}


def test_non_2xx_raises_with_response_summary(fake_service: FakeContextService) -> None:
    fake_service.error_status = 500
    with pytest.raises(RuntimeError) as excinfo:
        remote.search_cases_remote("任意", token=TOKEN)
    assert "HTTP 500" in str(excinfo.value)
    assert "boom" in str(excinfo.value)


def test_connection_error_message(monkeypatch: pytest.MonkeyPatch) -> None:
    def _refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Connection refused")

    real_client = httpx.Client

    def _factory(*args: Any, **kwargs: Any) -> httpx.Client:
        kwargs["transport"] = httpx.MockTransport(_refused)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", _factory)
    with pytest.raises(RuntimeError) as excinfo:
        remote.get_case_remote("case-x", token=TOKEN)
    message = str(excinfo.value)
    assert "无法连接 context-service" in message
    assert "AGX_CONTEXT_SERVICE_URL" in message


# ---------- CLI: wiki push ----------


def test_cli_wiki_push(fake_service: FakeContextService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    wiki = tmp_path / "wiki"
    (wiki / "sub").mkdir(parents=True)
    (wiki / "sub" / "guide.md").write_text("# guide\n", encoding="utf-8")

    result = _invoke("wiki", "push", "--dir", str(wiki), "--url", BASE, "--token", TOKEN)
    assert result.exit_code == 0, result.output
    assert "ingested: 1" in result.output
    assert "compiled: 1" in result.output
    assert "errors: 0" in result.output
    assert [p["name"] for p in fake_service.wiki_push["pages"]] == ["sub__guide"]

    # 服务端记录了单页编译错误（200 响应 errors 非空）→ CLI 逐条展示
    fake_service.wiki_push_result = {
        "ok": True,
        "ingested": 1,
        "compiled": 0,
        "errors": ["page-b: compile failed"],
    }
    result = _invoke("wiki", "push", "--dir", str(wiki), "--url", BASE, "--token", TOKEN)
    assert result.exit_code == 0, result.output
    assert "errors: 1" in result.output
    assert "page-b: compile failed" in result.output


def test_cli_wiki_push_no_compile_flag(fake_service: FakeContextService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    wiki = tmp_path / "wiki"
    wiki.mkdir()
    (wiki / "a.md").write_text("# a\n", encoding="utf-8")

    result = _invoke("wiki", "push", "--dir", str(wiki), "--no-compile", "--url", BASE, "--token", TOKEN)
    assert result.exit_code == 0, result.output
    assert fake_service.wiki_push["compile"] is False


def test_cli_wiki_push_missing_token(fake_service: FakeContextService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    wiki = tmp_path / "wiki"
    wiki.mkdir()
    (wiki / "a.md").write_text("# a\n", encoding="utf-8")

    result = _invoke("wiki", "push", "--dir", str(wiki))
    assert result.exit_code == 1
    assert "AGX_CONTEXT_SERVICE_TOKEN" in result.output
    assert fake_service.requests == []


# ---------- CLI: case compile --push ----------


def test_cli_case_compile_push(
    fake_service: FakeContextService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agenticx.cases.model import parse_case_md

    monkeypatch.chdir(tmp_path)
    plan_path = _completed_plan_path(tmp_path)
    cases_root = tmp_path / "cases"

    result = _invoke(
        "case", "compile", "--plan", str(plan_path),
        "--output-root", str(cases_root),
        "--push", "--url", BASE, "--token", TOKEN,
    )
    assert result.exit_code == 0, result.output
    assert "已推送至云端案例库" in result.output

    # 本地落盘不受影响（--push 是加法）
    saved = cases_root / "default" / "default" / "demo-portal-poc.md"
    assert saved.is_file()
    assert parse_case_md(saved).case_id == "case-task0001"

    # 云端收到 ingest(name=case_id, 原文) + compile(name)
    assert fake_service.ingested == [
        {"name": "case-task0001", "text": saved.read_text(encoding="utf-8")}
    ]
    assert fake_service.compiled == [{"name": "case-task0001"}]
    assert fake_service.requests[0]["token"] == TOKEN


def test_cli_case_compile_push_failure_keeps_local(
    fake_service: FakeContextService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    plan_path = _completed_plan_path(tmp_path)
    cases_root = tmp_path / "cases"
    fake_service.error_status = 401

    result = _invoke(
        "case", "compile", "--plan", str(plan_path),
        "--output-root", str(cases_root),
        "--push", "--url", BASE, "--token", TOKEN,
    )
    assert result.exit_code == 1
    assert "HTTP 401" in result.output
    assert "本地 case-entry 已保留" in result.output
    # 推送失败不丢本地产物
    assert (cases_root / "default" / "default" / "demo-portal-poc.md").is_file()


# ---------- CLI: case search --remote ----------


def test_cli_case_search_remote(
    fake_service: FakeContextService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    fake_service.search_cases = [
        {
            "case_id": "case-auto-001",
            "title": "Automotive Configurator POC",
            "summary": "汽车配置器案例",
            "scope": {"domain": "automotive"},
            "lifecycle_status": "active",
            "matched_on": ["summary"],
            "score": 3.0,
        },
        {
            "case_id": "case-retail-001",
            "title": "Retail Dashboard POC",
            "summary": "零售看板案例",
            "scope": {"domain": "retail"},
            "lifecycle_status": "active",
            "matched_on": ["summary", "problem"],
            "score": 5.0,
        },
    ]

    result = _invoke("case", "search", "配置器", "--remote", "--url", BASE, "--token", TOKEN)
    assert result.exit_code == 0, result.output
    assert "case-auto-001" in result.output
    assert "云端" in result.output
    assert fake_service.search_payload == {"query": "配置器", "scope_filter": {}, "top_k": 5}

    # --domain → scope_filter 硬过滤
    result = _invoke(
        "case", "search", "看板", "--remote", "--domain", "retail", "--top-k", "2",
        "--url", BASE, "--token", TOKEN,
    )
    assert result.exit_code == 0, result.output
    assert fake_service.search_payload == {
        "query": "看板",
        "scope_filter": {"domain": "retail"},
        "top_k": 2,
    }

    # 云端无结果：正常退出，不给 --remote 提示
    fake_service.search_cases = []
    result = _invoke("case", "search", "不存在", "--remote", "--url", BASE, "--token", TOKEN)
    assert result.exit_code == 0, result.output
    assert "无匹配案例" in result.output


def test_cli_case_search_remote_reads_env_config(
    fake_service: FakeContextService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("AGX_CONTEXT_SERVICE_URL", "http://env-context:9999")
    monkeypatch.setenv("AGX_CONTEXT_SERVICE_TOKEN", "env-token")

    result = _invoke("case", "search", "看板", "--remote")
    assert result.exit_code == 0, result.output
    assert fake_service.requests[-1]["host"] == "env-context"
    assert fake_service.requests[-1]["token"] == "env-token"


def test_cli_case_search_local_miss_hints_remote(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)  # 空目录，无本地 cases/
    result = _invoke("case", "search", "任何词")
    assert result.exit_code == 0, result.output
    assert "无匹配案例" in result.output
    assert "可用 --remote 检索云端案例库" in result.output


def test_cli_case_search_remote_error(
    fake_service: FakeContextService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    fake_service.error_status = 500
    result = _invoke("case", "search", "任意", "--remote", "--url", BASE, "--token", TOKEN)
    assert result.exit_code == 1
    assert "HTTP 500" in result.output


# ---------- CLI: case init --remote ----------


def test_cli_case_init_remote(
    fake_service: FakeContextService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agenticx.delivery.plan_mdc import read_plan

    monkeypatch.chdir(tmp_path)
    fake_service.get_content["case-cloud-001"] = _cloud_case_md()
    target = tmp_path / "proj-new"

    result = _invoke(
        "case", "init", "--case", "case-cloud-001", "--target", str(target),
        "--remote", "--url", BASE, "--token", TOKEN,
    )
    assert result.exit_code == 0, result.output
    assert "case-cloud-001" in result.output

    plan = read_plan(target / "plan.mdc")
    assert plan is not None
    assert plan.case_refs == ["case-cloud-001"]
    # 未传 --intent → 回退 case.summary
    assert plan.intent == "云端零售案例"


def test_cli_case_init_remote_requires_empty_target(
    fake_service: FakeContextService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    target = tmp_path / "occupied"
    target.mkdir()
    (target / "keep.txt").write_text("x", encoding="utf-8")
    fake_service.get_content["case-cloud-001"] = _cloud_case_md()

    result = _invoke(
        "case", "init", "--case", "case-cloud-001", "--target", str(target),
        "--remote", "--url", BASE, "--token", TOKEN,
    )
    assert result.exit_code == 1
    assert "非空" in result.output
    assert fake_service.requests == []  # 未发任何请求


def test_cli_case_init_remote_not_found(
    fake_service: FakeContextService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    result = _invoke(
        "case", "init", "--case", "case-missing", "--target", str(tmp_path / "p"),
        "--remote", "--url", BASE, "--token", TOKEN,
    )
    assert result.exit_code == 1
    assert "HTTP 404" in result.output
