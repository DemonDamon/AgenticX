#!/usr/bin/env python3
"""当前模型看不见图片时，先替它看一遍。

原来的做法是往用户消息后面追加一句"请调用 analyze_image"，指望模型自己去调。它大多
数时候会调，但**不保证**——而用户丢一张截图进来，本来就是要它看的。漏一次的表现是
"我看不到图片"或者干脆绕开图片作答，两种都很难解释。

所以改成：本轮真的带了新图、而当前模型是瞎的时候，直接用视觉兜底模型跑一遍，把描述
作为文本注入。模型不需要决定要不要看，它拿到的就是已经看过的结果。

代价是首 token 之前多一次视觉调用。之所以可接受：

* 只对**本轮新附的图**跑，历史图片不会每轮重跑；
* 兜底模型就是私有部署的那台，同机房、小模型，这一跳很短；
* 换来的是原图不出私有部署——只有描述回到云端模型，比切整个会话的模型省得多，也不
  会废掉 prefix cache。

跑不通就退回原来那句提示，不让一次视觉调用失败挡住整轮对话。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

#: 单轮最多自动解读几张。与 view_image 的每轮 4 张上限保持一致。
MAX_AUTO_DESCRIBED_IMAGES = 4

_PROMPT = (
    "请详细描述这张图片的关键内容（其中的文字、标识/Logo、界面元素、图表数据、报错信息等），"
    "以便后续据此检索与推理。只描述你确实看到的内容，不要推测。"
)


def _image_rows(attachments: Sequence[Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in attachments or ():
        if not isinstance(item, dict):
            continue
        data_url = str(item.get("data_url", "") or "")
        if not data_url.startswith("data:image/"):
            continue
        rows.append(item)
    return rows


async def describe_turn_images(
    session: Any,
    attachments: Sequence[Any],
    *,
    max_images: int = MAX_AUTO_DESCRIBED_IMAGES,
) -> str:
    """把本轮新附的图片解读成文本。跑不通返回空串。

    Args:
        attachments: 本轮的附件行（``history_user_attachments``），只处理带
            ``data:image/`` 的那些。
    """
    rows = _image_rows(attachments)[: max(1, int(max_images))]
    if not rows:
        return ""

    from agenticx.llms.vision_fallback import resolve_vision_fallback

    info = resolve_vision_fallback(session=session)
    if not info.get("available"):
        return ""

    try:
        from agenticx.llms.provider_resolver import ProviderResolver

        llm = ProviderResolver.resolve(
            provider_name=str(info["provider"]), model=str(info["model"])
        )
    except Exception:
        logger.debug("vision fallback provider unavailable", exc_info=True)
        return ""

    async def _one(row: Dict[str, Any]) -> Optional[str]:
        name = str(row.get("name", "") or "image")
        try:
            resp = await llm.ainvoke(
                [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _PROMPT},
                            {"type": "image_url", "image_url": {"url": row["data_url"]}},
                        ],
                    }
                ]
            )
        except Exception:
            logger.debug("vision fallback call failed for %s", name, exc_info=True)
            return None
        text = str(getattr(resp, "content", "") or "").strip()
        return f"— {name}：{text}" if text else None

    # 并发跑：多图时串行会把首 token 前的等待直接乘上张数。
    results = await asyncio.gather(*(_one(row) for row in rows), return_exceptions=True)
    parts = [r for r in results if isinstance(r, str) and r]
    if not parts:
        return ""

    label = str(info.get("label") or f"{info.get('provider')}/{info.get('model')}")
    body = "\n".join(parts)
    return (
        f"\n[图片解读] 当前模型不支持视觉输入，以下是由 {label} 代为解读的本轮图片内容："
        f"\n{body}\n"
        "请基于以上解读继续完成用户请求；原图未离开私有部署，"
        "不要回复用户「我看不到图片」。"
    )
