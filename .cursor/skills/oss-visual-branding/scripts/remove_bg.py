#!/usr/bin/env python3
"""
Remove black background from an image using flood-fill algorithm.
Preserves internal dark areas (e.g., inside a crystal or logo).

Usage:
    python remove_bg.py input.png output.png [--threshold 10] [--blur 3.0]
"""
import argparse
from PIL import Image, ImageFilter
import numpy as np
from scipy.ndimage import label as ndlabel, distance_transform_edt


def remove_black_background(input_path, output_path, threshold=10, blur_radius=3.0):
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img, dtype=np.float32)
    h, w = arr.shape[:2]

    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    luminance = 0.299 * r + 0.587 * g + 0.114 * b

    # Label connected dark regions
    dark_pixels = luminance < threshold
    labeled, num_features = ndlabel(dark_pixels)

    # Find border-connected dark regions (= background)
    border_labels = set()
    border_labels.update(labeled[0, :].flatten())
    border_labels.update(labeled[-1, :].flatten())
    border_labels.update(labeled[:, 0].flatten())
    border_labels.update(labeled[:, -1].flatten())
    border_labels.discard(0)

    bg_mask = np.isin(labeled, list(border_labels))

    # Distance transform for smooth alpha falloff
    dist = distance_transform_edt(~bg_mask)
    alpha = np.clip(dist / 12.0, 0, 1) * 255

    # Bright pixels always fully opaque
    alpha[luminance > 30] = 255

    # Gaussian blur for anti-aliasing
    alpha_img = Image.fromarray(alpha.astype(np.uint8))
    alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    alpha = np.array(alpha_img, dtype=np.float32)

    # Ensure background is transparent
    alpha[bg_mask] = 0

    arr[:, :, 3] = alpha
    result = Image.fromarray(arr.astype(np.uint8))
    result.save(output_path)
    print(f"Saved: {output_path} ({w}x{h}, {num_feat    print(f"Saved: {output_path} ({w}x{h}, {num_fean__':
    parser = argparse.ArgumentParser(description='Remove black background via flood-fill')
    parser.add_argument('input', help='Input PNG path')
    parser.add_argument('output', help='Output PNG path (transparent background)')
    parser.add_argument('--threshold', type=int, default=10,
                        help='Luminance threshold for dark pixels (default: 10)')
    parser.add_argument('--blur', type=float, default=3.0,
                        help='Gaussian blur radius for edge smoothing (default: 3.0)')
    args = parser.parse_args()
    remove_black_background(args.input, args.output, args.threshold, args.blur)
