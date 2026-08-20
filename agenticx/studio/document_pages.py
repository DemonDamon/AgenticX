#!/usr/bin/env python3
"""把 PDF 渲染成页图，交给多模态模型看。

为什么不是抽文本
----------------
原来的路径是 ``context_file_hydration`` 把文档抽成文本，而且截断在
``MAX_HYDRATED_CHARS = 8000`` —— 一份 50 页的 PDF 到模型手里只剩开头几页。附件自动
路由把会话锁到私有部署的多模态模型之后，就没必要再走这条有损通路了：直接给它看页面。

多模态模型吃的是图，不是 PDF 容器，所以"不解析"实际是"渲染成页图"。依赖不用新增：
``PyMuPDF`` 已随产品发货（pyproject 两个 extras、requirements.lock 钉 1.27.2.3、
PyInstaller spec 的 hiddenimports 里显式列了 ``fitz``），``tools/document_text.py``
早就在用它开 PDF 抽文本，这里多调一个 ``get_pixmap`` 而已。

它仍然是**可选**依赖：装不上时返回"渲染不可用"，调用方回落到抽文本。回落是安全的
——此时会话已经锁在私有模型上，文本同样不会离开这台部署。
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

#: 单次渲染的默认页数上限。超出部分截断，并告诉用户可以接着读。
DEFAULT_MAX_PAGES = 20

#: 页图长边像素上限。
#:
#: 视觉模型按图块计费，一页 A4 在 150dpi 下是 1275×1650，一次 20 页就能把上下文吃光。
#: 1600 长边在中文正文上肉眼可读，同时把单页控制在可接受的图块数内。
DEFAULT_MAX_EDGE_PX = 1600

#: 单页 PNG 字节上限，超了就降一档分辨率重来。防止满页图表的一页把请求撑爆。
MAX_PAGE_BYTES = 1_500_000

#: PDF 每单位 72dpi，这是换算 zoom 用的基准。
_PDF_BASE_DPI = 72.0


@dataclass(frozen=True)
class RenderedPage:
    """一页的渲染结果。``page_number`` 从 1 开始，与用户口径一致。"""

    page_number: int
    data_url: str


@dataclass(frozen=True)
class PageRenderResult:
    pages: Tuple[RenderedPage, ...]
    total_pages: int
    #: 还有没渲染完的页。
    truncated: bool
    #: 渲染不可用或失败时的原因；成功时为空。
    error: str = ""

    @property
    def available(self) -> bool:
        return not self.error

    @property
    def next_page(self) -> Optional[int]:
        """接着读应该从第几页开始；没有更多页时为 ``None``。"""
        if not self.truncated or not self.pages:
            return None
        return self.pages[-1].page_number + 1


def pdf_rendering_available() -> bool:
    try:
        import fitz  # type: ignore  # noqa: F401
    except ImportError:
        return False
    return True


def _zoom_for(width_pt: float, height_pt: float, max_edge_px: int) -> float:
    """按长边算缩放，避免横版页被拉得过大。"""
    longest_pt = max(float(width_pt or 0.0), float(height_pt or 0.0))
    if longest_pt <= 0:
        return 1.0
    return max(0.2, min(4.0, float(max_edge_px) / longest_pt))


def render_pdf_pages(
    path: str | Path,
    *,
    first_page: int = 1,
    max_pages: int = DEFAULT_MAX_PAGES,
    max_edge_px: int = DEFAULT_MAX_EDGE_PX,
) -> PageRenderResult:
    """渲染 ``[first_page, first_page + max_pages)`` 这一段，页码从 1 开始。

    越界的 ``first_page`` 会被夹回合法范围而不是报错：模型接着读时很容易把页码算过
    头一页，为此让整轮失败不划算。
    """
    try:
        import fitz  # type: ignore
    except ImportError:
        return PageRenderResult(
            pages=(),
            total_pages=0,
            truncated=False,
            error="PDF 渲染不可用：缺少 PyMuPDF。",
        )

    target = Path(path)
    if not target.is_file():
        return PageRenderResult(pages=(), total_pages=0, truncated=False, error="文件不存在。")

    try:
        document = fitz.open(str(target))
    except Exception as exc:  # 加密、损坏、不是 PDF……都归到这里
        return PageRenderResult(pages=(), total_pages=0, truncated=False, error=f"无法打开：{exc}")

    try:
        if getattr(document, "needs_pass", False):
            return PageRenderResult(
                pages=(), total_pages=0, truncated=False, error="PDF 有密码保护，无法渲染。"
            )
        total = int(len(document))
        if total <= 0:
            return PageRenderResult(pages=(), total_pages=0, truncated=False, error="PDF 没有页面。")

        start = max(1, min(int(first_page or 1), total))
        limit = max(1, int(max_pages or DEFAULT_MAX_PAGES))
        end = min(total, start + limit - 1)

        rendered: list[RenderedPage] = []
        for number in range(start, end + 1):
            page = document[number - 1]
            rect = getattr(page, "rect", None)
            zoom = _zoom_for(
                getattr(rect, "width", 0.0) or 0.0,
                getattr(rect, "height", 0.0) or 0.0,
                max_edge_px,
            )
            png = _render_one(fitz, page, zoom)
            if png is None:
                continue
            rendered.append(
                RenderedPage(
                    page_number=number,
                    data_url="data:image/png;base64," + base64.b64encode(png).decode("ascii"),
                )
            )
        if not rendered:
            return PageRenderResult(
                pages=(), total_pages=total, truncated=False, error="所有页面渲染失败。"
            )
        return PageRenderResult(
            pages=tuple(rendered),
            total_pages=total,
            truncated=end < total,
        )
    finally:
        try:
            document.close()
        except Exception:
            pass


def _render_one(fitz_module, page, zoom: float) -> Optional[bytes]:
    """渲一页；超过字节上限就降一档再来一次，仍然超就放弃这一页。"""
    for scale in (zoom, zoom * 0.6):
        try:
            matrix = fitz_module.Matrix(scale, scale)
            png = page.get_pixmap(matrix=matrix).tobytes("png")
        except Exception:
            return None
        if len(png) <= MAX_PAGE_BYTES:
            return png
    return None


def truncation_notice(result: PageRenderResult, *, display_name: str, path: str) -> str:
    """截断时给模型的提示。没截断返回空串。

    明确写出接着读的调用方式：模型看不到工具签名以外的东西，只说"还有更多"它多半会
    去猜页码，或者干脆当作已经读完。
    """
    if not result.truncated or result.next_page is None:
        return ""
    first = result.pages[0].page_number
    last = result.pages[-1].page_number
    return (
        f"[{display_name}] 共 {result.total_pages} 页，本轮只渲染了第 {first}–{last} 页。"
        f"需要后面的内容时调用 "
        f"`document_read_pages(path=\"{path}\", start_page={result.next_page})` 继续读；"
        f"不要凭前 {last} 页推测未读部分的内容。"
    )


#: 渲染成页图之后写回 context_files 的正文。
#:
#: 必须是"非占位符"形态，``context_file_hydration._already_hydrated`` 才会认为这条已
#: 经处理过、不再去抽一遍文本——否则同一份 PDF 会既有页图又有 8000 字符的截断文本，
#: 白花一倍 token 讲同一件事。
PAGES_PROVIDED_PREFIX = "[已作为页图提供]"


def stage_pdf_pages(
    session,
    *,
    filenames,
    max_pages: int = DEFAULT_MAX_PAGES,
) -> list[str]:
    """把这一轮的 PDF 渲染成页图挂到会话上，返回给模型看的说明。

    页图走 ``PENDING_VISUAL_ATTACHMENTS_KEY``——``view_image`` / 历史图片复现用的是同
    一条通路，运行时会在下一次请求里把它们转成原生 image block。复用它而不是另起一
    条，省得多一处"图片怎么进上下文"的逻辑。

    渲染不了就什么都不做，让原来的抽文本路径接着跑。此时会话已经锁在私有模型上，文
    本同样不出这台部署。
    """
    notices: list[str] = []
    context_files = getattr(session, "context_files", None)
    if not isinstance(context_files, dict):
        return notices
    try:
        from agenticx.cli.agent_tools import PENDING_VISUAL_ATTACHMENTS_KEY
    except Exception:
        return notices
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict):
        return notices
    pending = scratchpad.setdefault(PENDING_VISUAL_ATTACHMENTS_KEY, [])
    if not isinstance(pending, list):
        return notices

    for raw_key in list(filenames):
        key = str(raw_key or "").strip()
        if not key or not key.lower().endswith(".pdf"):
            continue
        if str(context_files.get(key, "")).startswith(PAGES_PROVIDED_PREFIX):
            continue  # 同一份 PDF 不重复渲染
        target = Path(key).expanduser()
        if not target.is_file():
            continue
        result = render_pdf_pages(target, max_pages=max_pages)
        if not result.available:
            continue
        display = target.name
        for page in result.pages:
            pending.append(
                {
                    "data_url": page.data_url,
                    "name": f"{display} · 第 {page.page_number} 页",
                    "source": "document_pages",
                }
            )
        first = result.pages[0].page_number
        last = result.pages[-1].page_number
        notice = truncation_notice(result, display_name=display, path=str(target))
        # 续读说明直接写进 context_files 的正文，而不是另找地方注入：模型就是在这里
        # 看"这个附件是什么"的，说明放在别处它未必读得到，也省一处新的注入通路。
        context_files[key] = (
            f"{PAGES_PROVIDED_PREFIX} {display}："
            f"共 {result.total_pages} 页，第 {first}–{last} 页已作为图片附在本轮消息中。"
            + (f"\n{notice}" if notice else "")
        )
        if notice:
            notices.append(notice)
    return notices
