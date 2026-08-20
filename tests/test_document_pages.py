#!/usr/bin/env python3
"""PDF 页图渲染。

fitz（PyMuPDF）是可选依赖，产品打包时才装（pyproject 的 document/all extras、
requirements.lock、PyInstaller hiddenimports）。所以这里两轨：纯逻辑用假 fitz 钉住，
真渲染在装了的环境里才跑。
"""

from __future__ import annotations

import base64
import sys
import types

import pytest

from agenticx.studio import document_pages as dp


class _Rect:
    def __init__(self, width: float, height: float) -> None:
        self.width = width
        self.height = height


class _Pixmap:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def tobytes(self, _fmt: str) -> bytes:
        return self._payload


class _Page:
    def __init__(self, index: int, *, size: int = 32, width=595.0, height=842.0) -> None:
        self.rect = _Rect(width, height)
        self._index = index
        self._size = size
        self.zooms: list[float] = []

    def get_pixmap(self, *, matrix):
        self.zooms.append(matrix.scale)
        return _Pixmap(bytes([self._index % 256]) * self._size)


class _Doc:
    def __init__(self, pages: list[_Page], *, needs_pass: bool = False) -> None:
        self._pages = pages
        self.needs_pass = needs_pass
        self.closed = False

    def __len__(self) -> int:
        return len(self._pages)

    def __getitem__(self, index: int) -> _Page:
        return self._pages[index]

    def close(self) -> None:
        self.closed = True


class _Matrix:
    def __init__(self, x: float, _y: float) -> None:
        self.scale = x


def _install_fake_fitz(monkeypatch, doc: _Doc, *, open_error: Exception | None = None):
    module = types.ModuleType("fitz")
    module.Matrix = _Matrix

    def _open(_path):
        if open_error is not None:
            raise open_error
        return doc

    module.open = _open
    monkeypatch.setitem(sys.modules, "fitz", module)
    return module


@pytest.fixture
def pdf_file(tmp_path):
    path = tmp_path / "报告.pdf"
    path.write_bytes(b"%PDF-1.4\n")
    return path


def _hide_fitz(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def _no_fitz(name, *args, **kwargs):
        if name == "fitz":
            raise ImportError("no fitz")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _no_fitz)


def test_reports_unavailable_without_pymupdf(monkeypatch, pdf_file):
    """装不上时报"不可用"，调用方回落到抽文本。

    回落是安全的：此时会话已经锁在私有模型上，文本同样不会离开这台部署。
    """
    _hide_fitz(monkeypatch)
    assert dp.pdf_rendering_available() is False
    result = dp.render_pdf_pages(pdf_file)
    assert not result.available
    assert "PyMuPDF" in result.error


def test_missing_file_is_reported_not_raised(monkeypatch, tmp_path):
    _install_fake_fitz(monkeypatch, _Doc([_Page(1)]))
    result = dp.render_pdf_pages(tmp_path / "nope.pdf")
    assert not result.available and "不存在" in result.error


def test_renders_every_page_within_the_cap(monkeypatch, pdf_file):
    doc = _Doc([_Page(i) for i in range(1, 6)])
    _install_fake_fitz(monkeypatch, doc)
    result = dp.render_pdf_pages(pdf_file, max_pages=20)
    assert result.available
    assert result.total_pages == 5
    assert [p.page_number for p in result.pages] == [1, 2, 3, 4, 5]
    assert result.truncated is False
    assert result.next_page is None
    assert result.pages[0].data_url.startswith("data:image/png;base64,")
    assert doc.closed is True


def test_truncates_at_the_cap_and_points_at_the_next_page(monkeypatch, pdf_file):
    _install_fake_fitz(monkeypatch, _Doc([_Page(i) for i in range(1, 51)]))
    result = dp.render_pdf_pages(pdf_file, max_pages=20)
    assert [p.page_number for p in result.pages] == list(range(1, 21))
    assert result.truncated is True
    assert result.next_page == 21


def test_continues_from_an_arbitrary_page(monkeypatch, pdf_file):
    _install_fake_fitz(monkeypatch, _Doc([_Page(i) for i in range(1, 51)]))
    result = dp.render_pdf_pages(pdf_file, first_page=21, max_pages=20)
    assert [p.page_number for p in result.pages] == list(range(21, 41))
    assert result.next_page == 41


def test_out_of_range_start_is_clamped_not_rejected(monkeypatch, pdf_file):
    """模型接着读时很容易把页码算过头一页，为此让整轮失败不划算。"""
    _install_fake_fitz(monkeypatch, _Doc([_Page(i) for i in range(1, 4)]))
    result = dp.render_pdf_pages(pdf_file, first_page=99, max_pages=5)
    assert result.available
    assert [p.page_number for p in result.pages] == [3]
    assert result.truncated is False
    result_zero = dp.render_pdf_pages(pdf_file, first_page=0, max_pages=1)
    assert [p.page_number for p in result_zero.pages] == [1]


def test_password_protected_pdf_is_reported(monkeypatch, pdf_file):
    _install_fake_fitz(monkeypatch, _Doc([_Page(1)], needs_pass=True))
    result = dp.render_pdf_pages(pdf_file)
    assert not result.available and "密码" in result.error


def test_broken_pdf_is_reported_not_raised(monkeypatch, pdf_file):
    _install_fake_fitz(monkeypatch, _Doc([]), open_error=RuntimeError("corrupt"))
    result = dp.render_pdf_pages(pdf_file)
    assert not result.available and "corrupt" in result.error


def test_oversized_page_retries_at_lower_resolution(monkeypatch, pdf_file):
    """一页满版图表不该把整个请求撑爆；降一档还超就跳过这一页。"""
    big = _Page(1, size=dp.MAX_PAGE_BYTES + 1)
    ok = _Page(2, size=16)
    _install_fake_fitz(monkeypatch, _Doc([big, ok]))
    result = dp.render_pdf_pages(pdf_file)
    assert [p.page_number for p in result.pages] == [2]
    # 大页试了两档才放弃。
    assert len(big.zooms) == 2
    assert big.zooms[1] < big.zooms[0]


def test_zoom_targets_the_long_edge(monkeypatch, pdf_file):
    """横版页不该被按短边拉大——视觉模型按图块计费。"""
    landscape = _Page(1, width=842.0, height=595.0)
    _install_fake_fitz(monkeypatch, _Doc([landscape]))
    dp.render_pdf_pages(pdf_file, max_edge_px=1600)
    assert landscape.zooms[0] == pytest.approx(1600 / 842.0)


def test_all_pages_failing_is_an_error_not_an_empty_success(monkeypatch, pdf_file):
    huge = _Page(1, size=dp.MAX_PAGE_BYTES + 1)
    _install_fake_fitz(monkeypatch, _Doc([huge]))
    result = dp.render_pdf_pages(pdf_file)
    assert not result.available and "渲染失败" in result.error


def test_truncation_notice_tells_the_model_how_to_continue(monkeypatch, pdf_file):
    _install_fake_fitz(monkeypatch, _Doc([_Page(i) for i in range(1, 51)]))
    result = dp.render_pdf_pages(pdf_file, max_pages=20)
    notice = dp.truncation_notice(result, display_name="报告.pdf", path="/abs/报告.pdf")
    assert "共 50 页" in notice
    assert "第 1–20 页" in notice
    # 只说"还有更多"的话，模型多半会去猜页码或当作已经读完。
    assert "document_read_pages" in notice and "start_page=21" in notice
    assert "/abs/报告.pdf" in notice


def test_no_notice_when_nothing_was_truncated(monkeypatch, pdf_file):
    _install_fake_fitz(monkeypatch, _Doc([_Page(1)]))
    result = dp.render_pdf_pages(pdf_file, max_pages=20)
    assert dp.truncation_notice(result, display_name="a.pdf", path="/a.pdf") == ""


def test_real_pymupdf_round_trip(tmp_path):
    """装了 PyMuPDF 的环境里跑一遍真渲染，确认假 fitz 没把接口测歪。"""
    fitz = pytest.importorskip("fitz", reason="PyMuPDF 是可选依赖，产品打包时才装")
    path = tmp_path / "real.pdf"
    document = fitz.open()
    for _ in range(3):
        document.new_page()
    document.save(str(path))
    document.close()

    result = dp.render_pdf_pages(path, max_pages=2)
    assert result.available
    assert result.total_pages == 3
    assert [p.page_number for p in result.pages] == [1, 2]
    assert result.truncated is True and result.next_page == 3
    head, _, payload = result.pages[0].data_url.partition(",")
    assert head == "data:image/png;base64"
    assert base64.b64decode(payload)[:8] == b"\x89PNG\r\n\x1a\n"


class _Session:
    def __init__(self, context_files=None):
        self.context_files = dict(context_files or {})
        self.scratchpad = {}


def _pending(session):
    from agenticx.cli.agent_tools import PENDING_VISUAL_ATTACHMENTS_KEY

    return session.scratchpad.get(PENDING_VISUAL_ATTACHMENTS_KEY, [])


def test_staging_pushes_pages_onto_the_visual_queue(monkeypatch, pdf_file):
    _install_fake_fitz(monkeypatch, _Doc([_Page(i) for i in range(1, 4)]))
    session = _Session({str(pdf_file): "[附件] 报告.pdf"})
    notices = dp.stage_pdf_pages(session, filenames=[str(pdf_file)], max_pages=20)

    pending = _pending(session)
    assert len(pending) == 3
    assert all(item["data_url"].startswith("data:image/png;base64,") for item in pending)
    assert "第 1 页" in pending[0]["name"]
    assert notices == []


def test_staging_marks_the_file_so_hydration_skips_it(monkeypatch, pdf_file):
    """否则同一份 PDF 会既有页图又有 8000 字符截断文本，白花一倍 token。"""
    from agenticx.studio.context_file_hydration import _already_hydrated, _is_placeholder

    _install_fake_fitz(monkeypatch, _Doc([_Page(1)]))
    session = _Session({str(pdf_file): "[附件] 报告.pdf"})
    dp.stage_pdf_pages(session, filenames=[str(pdf_file)], max_pages=20)

    body = session.context_files[str(pdf_file)]
    assert body.startswith(dp.PAGES_PROVIDED_PREFIX)
    assert _is_placeholder(body) is False
    assert _already_hydrated(body) is True


def test_staging_returns_a_continue_notice_when_truncated(monkeypatch, pdf_file):
    _install_fake_fitz(monkeypatch, _Doc([_Page(i) for i in range(1, 51)]))
    session = _Session({str(pdf_file): "[附件] 报告.pdf"})
    notices = dp.stage_pdf_pages(session, filenames=[str(pdf_file)], max_pages=20)
    assert len(notices) == 1
    assert "document_read_pages" in notices[0] and "start_page=21" in notices[0]
    assert len(_pending(session)) == 20


def test_staging_does_not_render_the_same_pdf_twice(monkeypatch, pdf_file):
    _install_fake_fitz(monkeypatch, _Doc([_Page(1)]))
    session = _Session({str(pdf_file): "[附件] 报告.pdf"})
    dp.stage_pdf_pages(session, filenames=[str(pdf_file)], max_pages=20)
    dp.stage_pdf_pages(session, filenames=[str(pdf_file)], max_pages=20)
    assert len(_pending(session)) == 1


def test_staging_ignores_non_pdf_and_missing_files(monkeypatch, tmp_path):
    _install_fake_fitz(monkeypatch, _Doc([_Page(1)]))
    session = _Session()
    notices = dp.stage_pdf_pages(
        session,
        filenames=[str(tmp_path / "a.docx"), str(tmp_path / "gone.pdf"), ""],
        max_pages=20,
    )
    assert notices == [] and _pending(session) == []


def test_staging_leaves_the_text_path_alone_when_rendering_is_unavailable(
    monkeypatch, pdf_file
):
    """回落是安全的：会话已经锁在私有模型上，文本同样不出这台部署。"""
    _hide_fitz(monkeypatch)
    session = _Session({str(pdf_file): "[附件] 报告.pdf"})
    notices = dp.stage_pdf_pages(session, filenames=[str(pdf_file)], max_pages=20)
    assert notices == [] and _pending(session) == []
    assert session.context_files[str(pdf_file)] == "[附件] 报告.pdf"


def test_continue_instruction_lands_in_the_context_file_body(monkeypatch, pdf_file):
    """模型就是在 context_files 里看"这个附件是什么"的，说明放别处它未必读得到。"""
    _install_fake_fitz(monkeypatch, _Doc([_Page(i) for i in range(1, 51)]))
    session = _Session({str(pdf_file): "[附件] 报告.pdf"})
    dp.stage_pdf_pages(session, filenames=[str(pdf_file)], max_pages=20)
    body = session.context_files[str(pdf_file)]
    assert "共 50 页" in body
    assert "document_read_pages" in body and "start_page=21" in body


# --------------------------------------------------------------------------
# document_read_pages 工具
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_read_pages_tool_refuses_files_outside_the_conversation(monkeypatch, pdf_file):
    """不限制范围就等于给模型开了一个读本机任意 PDF 的口子。"""
    from agenticx.cli.agent_tools import _tool_document_read_pages

    _install_fake_fitz(monkeypatch, _Doc([_Page(1)]))
    session = _Session()  # 没有任何附件
    out = await _tool_document_read_pages(
        {"path": str(pdf_file), "start_page": 1}, session
    )
    assert out.startswith("ERROR:") and "not an attachment" in out


@pytest.mark.asyncio
async def test_read_pages_tool_renders_the_requested_range(monkeypatch, pdf_file):
    from agenticx.cli.agent_tools import _tool_document_read_pages

    _install_fake_fitz(monkeypatch, _Doc([_Page(i) for i in range(1, 51)]))
    session = _Session({str(pdf_file): "[已作为页图提供] 报告.pdf"})
    out = await _tool_document_read_pages(
        {"path": str(pdf_file), "start_page": 21, "max_pages": 10}, session
    )
    assert "第 21–30 页" in out and "共 50 页" in out
    assert "start_page=31" in out
    pending = _pending(session)
    assert [item["name"] for item in pending][0].endswith("第 21 页")
    assert len(pending) == 10


@pytest.mark.asyncio
async def test_read_pages_tool_reports_missing_renderer(monkeypatch, pdf_file):
    from agenticx.cli.agent_tools import _tool_document_read_pages

    _hide_fitz(monkeypatch)
    session = _Session({str(pdf_file): "[附件] 报告.pdf"})
    out = await _tool_document_read_pages({"path": str(pdf_file), "start_page": 1}, session)
    assert out.startswith("ERROR:") and "PyMuPDF" in out


@pytest.mark.asyncio
async def test_read_pages_tool_validates_arguments(monkeypatch, pdf_file):
    from agenticx.cli.agent_tools import _tool_document_read_pages

    _install_fake_fitz(monkeypatch, _Doc([_Page(1)]))
    session = _Session({str(pdf_file): "[附件] a.pdf"})
    assert (await _tool_document_read_pages({"start_page": 1}, session)).startswith("ERROR:")
    assert (await _tool_document_read_pages({"path": str(pdf_file)}, None)).startswith("ERROR:")
    # start_page 给了非法值时按第 1 页处理，而不是整轮失败。
    out = await _tool_document_read_pages(
        {"path": str(pdf_file), "start_page": "abc"}, session
    )
    assert out.startswith("ERROR: start_page")


def test_read_pages_is_deferrable_and_announced():
    """它不是常驻工具，但名字必须出现在延迟清单里，否则模型不知道能续读。"""
    from agenticx.runtime.tool_search import is_deferred_builtin

    assert is_deferred_builtin("document_read_pages")
