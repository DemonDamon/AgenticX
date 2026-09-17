#!/usr/bin/env python3
"""Tests for the dock icon plate mask."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

_SPEC = importlib.util.spec_from_file_location(
    "build_near_box_logo",
    Path(__file__).with_name("build-near-box-logo.py"),
)
_MOD = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(_MOD)
mac_icon_mask = _MOD.mac_icon_mask
apply_icon_mask = _MOD.apply_icon_mask
fill_icon = _MOD.fill_icon
defringe_white_matte = _MOD.defringe_white_matte


class MacIconMaskTest(unittest.TestCase):
    def test_corners_are_clear_and_the_center_stays_solid(self) -> None:
        mask = mac_icon_mask(128)
        self.assertEqual(mask.shape, (128, 128))
        self.assertLess(float(mask[0, 0]), 0.02)
        self.assertLess(float(mask[0, 127]), 0.02)
        self.assertLess(float(mask[127, 0]), 0.02)
        self.assertLess(float(mask[127, 127]), 0.02)
        self.assertGreater(float(mask[64, 64]), 0.98)
        self.assertGreater(float(mask[2, 64]), 0.98)

    def test_apply_icon_mask_punches_transparent_corners(self) -> None:
        plate = np.full((64, 64, 3), 255, dtype=np.uint8)
        out = apply_icon_mask(plate)
        self.assertEqual(out.shape, (64, 64, 4))
        self.assertEqual(int(out[0, 0, 3]), 0)
        self.assertEqual(int(out[32, 32, 3]), 255)

    def test_fill_icon_matches_native_dock_mark_size(self) -> None:
        mark = Image.new("RGBA", (80, 80), (249, 115, 26, 255))
        out = np.array(fill_icon(mark, 128))
        self.assertEqual(out.shape, (128, 128, 4))
        self.assertEqual(int(out[0, 64, 3]), 0)
        self.assertEqual(int(out[64, 0, 3]), 0)
        self.assertGreater(int(out[64, 64, 3]), 250)
        ys, xs = np.where(out[..., 3] > 128)
        span = int(max(ys.max() - ys.min(), xs.max() - xs.min()) + 1)
        self.assertLess(span, int(128 * 0.92))
        self.assertGreater(span, int(128 * 0.78))

    def test_defringe_clears_cream_rim_on_a_dark_matte(self) -> None:
        arr = np.zeros((16, 16, 4), dtype=np.uint8)
        arr[3:13, 3:13] = (249, 115, 26, 255)
        arr[3, 3:13] = (255, 247, 227, 255)
        arr[12, 3:13] = (255, 247, 227, 255)
        arr[3:13, 3] = (255, 247, 227, 255)
        arr[3:13, 12] = (255, 247, 227, 255)
        out = np.array(defringe_white_matte(Image.fromarray(arr)))
        luma = (
            0.2126 * out[..., 0].astype(np.float32)
            + 0.7152 * out[..., 1].astype(np.float32)
            + 0.0722 * out[..., 2].astype(np.float32)
        )
        opaque = out[..., 3] > 128
        trans = out[..., 3] == 0
        pad = np.pad(trans, 1, constant_values=True)
        edge = opaque & (
            pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
        )
        self.assertTrue(bool(opaque.any()))
        self.assertLess(float(luma[edge].max()), 200.0)
        self.assertGreater(int(out[7, 7, 3]), 250)
        self.assertGreater(int(out[7, 7, 0]), 200)


if __name__ == "__main__":
    unittest.main()
