#!/usr/bin/env python3
"""Camera frame to PNG encoding for bridge snapshots.

Author: Hongyi Zhao
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image


def encode_png(frame: np.ndarray, *, max_width: int = 640) -> tuple[bytes, int, int]:
    """RGB uint8 HxWx3 -> PNG bytes, downscaled (keep aspect) so width <= max_width."""
    if not isinstance(frame, np.ndarray) or frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3:
        shape = getattr(frame, "shape", None)
        dtype = getattr(frame, "dtype", type(frame).__name__)
        raise ValueError(f"expected an HxWx3 uint8 RGB frame, got shape={shape} dtype={dtype}")
    image = Image.fromarray(frame, "RGB")
    width, height = image.size
    if width > max_width:
        image = image.resize((max_width, max(1, round(height * max_width / width))), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    image.save(buf, "PNG", optimize=True)
    return buf.getvalue(), image.width, image.height
