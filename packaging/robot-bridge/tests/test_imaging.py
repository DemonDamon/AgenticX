#!/usr/bin/env python3
"""Tests for PNG encoding of camera frames.

Author: Hongyi Zhao
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from agx_robot_bridge.imaging import encode_png


def test_downscales_wide_frames_keeping_aspect():
    frame = np.zeros((720, 1280, 3), np.uint8)
    png, width, height = encode_png(frame)
    assert (width, height) == (640, 360)
    assert Image.open(io.BytesIO(png)).size == (640, 360)


def test_small_frames_are_not_upscaled():
    frame = np.full((120, 160, 3), 200, np.uint8)
    png, width, height = encode_png(frame)
    assert (width, height) == (160, 120)
    assert Image.open(io.BytesIO(png)).getpixel((0, 0)) == (200, 200, 200)


@pytest.mark.parametrize(
    "frame",
    [
        np.zeros((10, 10), np.uint8),
        np.zeros((10, 10, 4), np.uint8),
        np.zeros((10, 10, 3), np.float32),
        [[0, 0, 0]],
    ],
)
def test_rejects_invalid_frames(frame):
    with pytest.raises(ValueError):
        encode_png(frame)
