#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Data Processor for MAI-UI Training with Qwen3-VL Format.

This module converts trajectory.jsonl to Qwen3-VL compatible training format:
- Each step becomes a separate training sample
- Images are referenced via image_url format (path-based, not base64)
- First step: image + instruction + assistant output
- Subsequent steps: image + instruction + history chain + assistant output

Usage:
    # Single trajectory file
    python data_processor.py --trajectory trajectory.jsonl --output sft_train.jsonl
    python data/data_processor.py --trajectory ../dataset/20260119_201327/trajectory.jsonl --max_dim 1024
    python data/data_processor.py --trajectory ../dataset/20260128_113523/trajectory.jsonl --max_dim 1024 --multi_turn

    # Directory containing trajectory folders (sequential processing)
    python data_processor.py --trajectory_dir dataset/ --output sft_train.jsonl

    # Batch processing with multi-threading (recommended for train_data)
    # Processes all subfolders in parallel, combines into single sft_train.jsonl
    # screenshot_path will be formatted as "subfolder/step_XXX_resized.png"
    python data/data_processor.py --train_data_dir ../dataset/train_data --max_dim 1024 --num_workers 4 --multi_turn

Author: Damon Li
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock
from typing import Any, Generator

try:
    from PIL import Image  # type: ignore[import]  # pyright: ignore
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    Image = None


# =============================================================================
# System Prompt (imported or fallback)
# =============================================================================

# Import official MAI-UI prompt from trainer/prompts/maiui_official_prompts.py
# Use MAI_MOBILE_SYS_PROMPT (standard version) instead of ASK_USER_MCP version
# The ASK_USER_MCP version includes ask_user and double_click actions, but we use
# the standard version for LoRA fine-tuning unless those actions are needed.
MAI_MOBILE_SYS_PROMPT = None

# Constants
SCALE_FACTOR = 999

prompts_file = Path(__file__).parent.parent / "prompts" / "maiui_official_prompts.py"
if prompts_file.exists():
    try:
        prompts_dir = prompts_file.parent
        if str(prompts_dir) not in sys.path:
            sys.path.insert(0, str(prompts_dir))
        from maiui_official_prompts import MAI_MOBILE_SYS_PROMPT  # type: ignore[import]  # pyright: ignore
    except ImportError:
        pass

# Get system prompt - always use official prompt, raise error if not available
if MAI_MOBILE_SYS_PROMPT is not None:
    GUI_AGENT_SYSTEM_PROMPT = MAI_MOBILE_SYS_PROMPT
else:
    raise ImportError(
        "Failed to import MAI_MOBILE_SYS_PROMPT from "
        "trainer/prompts/maiui_official_prompts.py. "
        "Please ensure the prompt file exists."
    )


# =============================================================================
# Data Loading Functions
# =============================================================================

def load_trajectory(trajectory_file: str) -> list[dict]:
    """Load trajectory data from JSONL file.
    
    Args:
        trajectory_file: Path to trajectory.jsonl file.
        
    Returns:
        List of step dictionaries.
    """
    steps = []
    with open(trajectory_file, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                step = json.loads(line)
                steps.append(step)
            except json.JSONDecodeError as e:
                print(f"Warning: Failed to parse line {line_num}: {e}")
    return steps


# =============================================================================
# Image Path Resolution
# =============================================================================

def resolve_image_path(
    screenshot_path: str,
    trajectory_dir: Path,
    image_base_dir: Path | None = None,
) -> str | None:
    """Resolve screenshot path to absolute or relative path.
    
    Args:
        screenshot_path: Original screenshot path from trajectory.
        trajectory_dir: Directory containing the trajectory.jsonl file.
        image_base_dir: Optional base directory for images.
        
    Returns:
        Resolved path string, or None if file doesn't exist.
    """
    if not screenshot_path:
        return None
    
    path = Path(screenshot_path)
    
    # If already absolute, check existence
    if path.is_absolute():
        if path.exists():
            return str(path)
        # Even if absolute path doesn't exist, try to find by filename
        # (e.g., Windows paths on Mac, or moved files)
        # Fall through to try filename matching below
    
    # Try relative to image_base_dir
    if image_base_dir:
        full_path = image_base_dir / path
        if full_path.exists():
            return str(full_path)
        # Try just the filename
        full_path = image_base_dir / path.name
        if full_path.exists():
            return str(full_path)
    
    # Try relative to trajectory directory
    full_path = trajectory_dir / path
    if full_path.exists():
        return str(full_path)
    
    # Try just the filename relative to trajectory directory
    full_path = trajectory_dir / path.name
    if full_path.exists():
        return str(full_path)
    
    # All attempts failed, return None
    return None


def get_image_filename(screenshot_path: str) -> str | None:
    """Extract just the filename from screenshot path.
    
    Args:
        screenshot_path: Original screenshot path from trajectory.
        
    Returns:
        Just the filename (e.g., "step_001.png"), or None if empty.
    """
    if not screenshot_path:
        return None
    return Path(screenshot_path).name


# =============================================================================
# Image Resize Functions
# =============================================================================

def resize_image(image: Image.Image, max_dim: int = 1024) -> tuple[Image.Image, float]:
    """Resize image to max_dim while maintaining aspect ratio.
    
    Args:
        image: PIL Image to resize.
        max_dim: Maximum dimension (width or height).
        
    Returns:
        Tuple of (resized_image, scale_ratio).
        scale_ratio is the ratio of resized_size / original_size.
    """
    if not HAS_PIL:
        return image, 1.0
    
    if max(image.size) <= max_dim:
        return image, 1.0
    
    ratio = max_dim / max(image.size)
    new_size = (int(image.width * ratio), int(image.height * ratio))
    resized_image = image.resize(new_size, Image.LANCZOS)
    return resized_image, ratio


# =============================================================================
# Coordinate Conversion Functions
# =============================================================================

def convert_normalized_to_absolute(
    normalized_x: float, 
    normalized_y: float, 
    image_width: int, 
    image_height: int
) -> tuple[int, int]:
    """Convert normalized coordinates (0-1) to absolute coordinates (pixels).
    
    Args:
        normalized_x: Normalized x coordinate (0-1).
        normalized_y: Normalized y coordinate (0-1).
        image_width: Image width in pixels.
        image_height: Image height in pixels.
        
    Returns:
        Tuple of (absolute_x, absolute_y) in pixels.
    """
    absolute_x = int(normalized_x * image_width)
    absolute_y = int(normalized_y * image_height)
    return (absolute_x, absolute_y)


def scale_coordinates(
    coords: list[float],
    scale_ratio: float
) -> list[int]:
    """Scale coordinates by ratio.
    
    Args:
        coords: [x, y] coordinates.
        scale_ratio: Scale ratio (resized_size / original_size).
        
    Returns:
        Scaled coordinates as integers.
    """
    if len(coords) >= 2:
        return [int(coords[0] * scale_ratio), int(coords[1] * scale_ratio)]
    return coords


def convert_coordinates_in_action(
    action: dict, 
    image_width: int, 
    image_height: int,
    scale_ratio: float = 1.0,
) -> dict:
    """Convert normalized coordinates to absolute, scale, and normalize to 0-999 range.
    
    Args:
        action: Action dictionary that may contain coordinate fields.
        image_width: Original image width in pixels.
        image_height: Original image height in pixels.
        scale_ratio: Optional scale ratio for resized images (resized_size / original_size).
        
    Returns:
        New action dict with converted/scaled coordinates normalized to 0-999 range.
    """
    action = action.copy()  # Don't modify original
    
    # Fields that may contain coordinates
    coord_fields = ["coordinate", "start_coordinate", "end_coordinate"]
    
    # Calculate scaled image dimensions
    scaled_width = image_width * scale_ratio
    scaled_height = image_height * scale_ratio
    
    for field in coord_fields:
        if field in action:
            coords = action[field]
            if isinstance(coords, list) and len(coords) >= 2:
                x, y = coords[0], coords[1]
                if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                    # If coordinates are normalized (0-1 range), convert to absolute first
                    if 0 <= x <= 1 and 0 <= y <= 1:
                        abs_x = x * image_width
                        abs_y = y * image_height
                    else:
                        # Already absolute coordinates
                        abs_x, abs_y = x, y
                    
                    # Apply scale ratio for resized images
                    scaled_x = abs_x * scale_ratio
                    scaled_y = abs_y * scale_ratio
                    
                    # Scale to 0-999 range: x/width*999 and y/height*999
                    if scaled_width > 0:
                        final_x = int(scaled_x / scaled_width * SCALE_FACTOR)
                    else:
                        final_x = 0
                    
                    if scaled_height > 0:
                        final_y = int(scaled_y / scaled_height * SCALE_FACTOR)
                    else:
                        final_y = 0
                    
                    # Clamp to valid range
                    final_x = max(0, min(SCALE_FACTOR, final_x))
                    final_y = max(0, min(SCALE_FACTOR, final_y))
                    
                    action[field] = [final_x, final_y]
    
    return action


def get_image_size(image_path: str | Path) -> tuple[int, int] | None:
    """Get image dimensions.
    
    Args:
        image_path: Path to image file.
        
    Returns:
        Tuple of (width, height) or None if image cannot be loaded.
    """
    if not HAS_PIL:
        return None
    
    try:
        path = Path(image_path)
        if not path.exists():
            return None
        
        with Image.open(path) as img:
            return img.size  # Returns (width, height)
    except Exception:
        return None


# =============================================================================
# History Formatting
# =============================================================================

def format_history_chain(
    steps: list[dict],
    current_index: int,
    max_history: int | None = None,
    image_sizes: dict[int, tuple[int, int]] | None = None,
    scale_ratios: dict[int, float] | None = None,
) -> str:
    """Format previous steps as history chain text.
    
    Args:
        steps: List of all steps.
        current_index: Current step index (0-based).
        max_history: Maximum number of history steps to include. None = all.
        image_sizes: Optional dict mapping step index to (width, height) for coordinate conversion.
        scale_ratios: Optional dict mapping step index to scale_ratio for resized images.
        
    Returns:
        Formatted history text, or empty string if no history.
    """
    if current_index <= 0:
        return ""
    
    # Get history steps (all steps before current)
    history_steps = steps[:current_index]
    
    # Limit history if specified
    if max_history is not None and len(history_steps) > max_history:
        history_steps = history_steps[-max_history:]
    
    if not history_steps:
        return ""
    
    history_lines = ["\nPrevious actions:"]
    for i, step in enumerate(history_steps):
        step_num = i + 1  # Step编号从1开始
        thinking = step.get("thinking", "")
        action = step.get("action", {})
        
        # Convert coordinates to absolute and scale if image size is available
        if action and image_sizes:
            step_idx = current_index - len(history_steps) + i
            if step_idx in image_sizes:
                width, height = image_sizes[step_idx]
                scale_ratio = scale_ratios.get(step_idx, 1.0) if scale_ratios else 1.0
                action = convert_coordinates_in_action(action, width, height, scale_ratio)
        
        # Add Step number
        history_lines.append(f"Step {step_num}:")
        
        # Add thinking tags (only if thinking exists)
        if thinking:
            history_lines.append("<thinking>")
            history_lines.append(thinking)
            history_lines.append("</thinking>")
        
        # Add tool_call tags (only if action exists)
        if action:
            tool_call_dict = {
                "name": "mobile_use",
                "arguments": action
            }
            tool_call_json = json.dumps(tool_call_dict, ensure_ascii=False)
            history_lines.append("<tool_call>")
            history_lines.append(tool_call_json)
            history_lines.append("</tool_call>")
        
        # Add blank line between steps (except after the last one)
        if i < len(history_steps) - 1:
            history_lines.append("")
    
    return "\n".join(history_lines)


# =============================================================================
# Sample Building Functions
# =============================================================================

def build_user_content(
    image_path: str | None,
    instruction: str,
    history_text: str,
) -> list[dict]:
    """Build user message content for Qwen3-VL format.
    
    Args:
        image_path: Path to screenshot image.
        instruction: Task instruction.
        history_text: Formatted history chain text.
        
    Returns:
        List of content items.
    """
    content = []
    
    # Add image first (if exists)
    if image_path:
        content.append({
            "type": "image_url",
            "image_url": image_path
        })
    
    # Build text content
    text = instruction
    if history_text:
        text += history_text
    
    content.append({
        "type": "text",
        "text": text
    })
    
    return content


def build_assistant_content(
    thinking: str, 
    action: dict,
    image_width: int | None = None,
    image_height: int | None = None,
    scale_ratio: float = 1.0,
) -> list[dict]:
    """Build assistant message content.
    
    Args:
        thinking: The thinking process text.
        action: The action dictionary (may contain normalized coordinates).
        image_width: Original image width in pixels (for coordinate conversion).
        image_height: Original image height in pixels (for coordinate conversion).
        scale_ratio: Scale ratio for resized images (resized_size / original_size).
        
    Returns:
        List of content items.
    """
    # Convert coordinates to absolute and scale if image size is available
    if image_width and image_height:
        action = convert_coordinates_in_action(action, image_width, image_height, scale_ratio)
    
    # Format response according to system prompt:
    # <thinking>...</thinking>
    # <tool_call>{"name": "mobile_use", "arguments": <args-json-object>}</tool_call>
    action_json = json.dumps(action, ensure_ascii=False)
    response_text = f"<thinking>\n{thinking}\n</thinking>\n<tool_call>\n{{\"name\": \"mobile_use\", \"arguments\": {action_json}}}\n</tool_call>"
    
    return [{"type": "text", "text": response_text}]


def process_step_image(
    step: dict,
    step_index: int,
    trajectory_dir: Path,
    image_base_dir: Path | None,
    max_dim: int | None,
    output_dir: Path | None,
) -> tuple[str | None, int | None, int | None, float]:
    """Process image for a single step: resolve path, resize if needed, return info.
    
    Args:
        step: Step data dictionary.
        step_index: Index of the step.
        trajectory_dir: Directory containing trajectory file.
        image_base_dir: Optional base directory for images.
        max_dim: Maximum image dimension for resizing.
        output_dir: Directory to save resized images.
        
    Returns:
        Tuple of (image_filename, original_width, original_height, scale_ratio).
        Returns (None, None, None, 1.0) if image cannot be processed.
    """
    screenshot_path = step.get("screenshot_path", "")
    if not screenshot_path:
        return None, None, None, 1.0
    
    # Get just the filename
    image_filename = get_image_filename(screenshot_path)
    
    # Resolve full path for validation
    full_image_path = resolve_image_path(
        screenshot_path,
        trajectory_dir,
        image_base_dir,
    )
    
    # If path resolution failed, or if resolved filename doesn't match step_index,
    # try using step_index to construct filename
    # This handles cases where screenshot_path has wrong filename (e.g., Windows paths copied to Mac)
    step_num = step_index + 1
    expected_filename = f"step_{step_num:03d}.png"
    
    if not full_image_path or not Path(full_image_path).exists():
        # Path resolution failed, try step_index-based filename
        fallback_path = trajectory_dir / expected_filename
        if fallback_path.exists():
            full_image_path = str(fallback_path)
            image_filename = expected_filename
        else:
            return None, None, None, 1.0
    elif image_filename != expected_filename:
        # Path resolved but filename doesn't match step_index, prefer step_index-based filename
        fallback_path = trajectory_dir / expected_filename
        if fallback_path.exists():
            full_image_path = str(fallback_path)
            image_filename = expected_filename
        # Otherwise, use the resolved path (it exists, just filename mismatch)
    
    original_width = None
    original_height = None
    scale_ratio = 1.0
    
    if HAS_PIL:
        try:
            with Image.open(full_image_path) as img:
                original_width, original_height = img.size
                
                # Resize image if max_dim is specified
                if max_dim is not None:
                    resized_image, scale_ratio = resize_image(img.copy(), max_dim)
                    
                    # Save resized image
                    if output_dir is None:
                        output_dir = trajectory_dir
                    output_dir.mkdir(parents=True, exist_ok=True)
                    
                    # Save with _resized suffix
                    image_path_obj = Path(image_filename)
                    resized_filename = f"{image_path_obj.stem}_resized{image_path_obj.suffix}"
                    resized_path = output_dir / resized_filename
                    
                    # Always save resized image (will overwrite if exists)
                    # This ensures all images get resized versions, even if processing was interrupted
                    resized_image.save(resized_path, quality=95)
                    
                    image_filename = resized_filename
        except Exception as e:
            print(f"Warning: Failed to process image {full_image_path}: {e}")
            return None, None, None, 1.0
    else:
        size = get_image_size(full_image_path)
        if size:
            original_width, original_height = size
    
    return image_filename, original_width, original_height, scale_ratio


def build_multi_turn_messages(
    all_steps: list[dict],
    current_step_index: int,
    trajectory_dir: Path,
    system_prompt: str,
    image_base_dir: Path | None = None,
    max_dim: int | None = None,
    output_dir: Path | None = None,
) -> tuple[list[dict], dict] | None:
    """Build multi-turn conversation format messages.
    
    Creates a conversation that matches inference format:
    
    Case 1 (first step, no history):
        - system message
        - user: instruction + current screenshot
        - assistant: response to predict
    
    Case 2 (subsequent steps, with history):
        - system message
        - user: instruction only (no image)
        - assistant: step 0 response (history)
        - assistant: step 1 response (history)
        - ...
        - assistant: step N-1 response (history)
        - user: current screenshot only (紧邻要预测的 assistant)
        - assistant: step N response (to predict)
    
    This format ensures:
    1. Each sample has exactly ONE image (current screenshot)
    2. Image is placed right before the assistant response to predict
    3. Training format matches inference format (WebUI adds current screenshot as last user message)
    
    Args:
        all_steps: List of all steps in trajectory.
        current_step_index: Index of the last step to include (inclusive, 0-based).
        trajectory_dir: Directory containing trajectory file.
        system_prompt: System prompt text.
        image_base_dir: Optional base directory for images.
        max_dim: Maximum image dimension for resizing.
        output_dir: Directory to save resized images.
        
    Returns:
        Tuple of (messages list, metadata dict), or None if images are missing.
    """
    messages = []
    
    # Add system message
    messages.append({
        "role": "system",
        "content": [{"type": "text", "text": system_prompt}]
    })
    
    # Get instruction from first step (same for all steps in a trajectory)
    instruction = all_steps[0].get("instruction", "")
    
    # Process current step's image (only need the current screenshot)
    current_step = all_steps[current_step_index]
    current_image_filename, current_orig_width, current_orig_height, current_scale_ratio = process_step_image(
        step=current_step,
        step_index=current_step_index,
        trajectory_dir=trajectory_dir,
        image_base_dir=image_base_dir,
        max_dim=max_dim,
        output_dir=output_dir,
    )
    
    if not current_image_filename:
        return None  # Skip if current image is missing
    
    if current_step_index == 0:
        # Case 1: First step - instruction + image in the same user message
        messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": instruction},
                {"type": "image_url", "image_url": current_image_filename}
            ]
        })
    else:
        # Case 2: Subsequent steps
        # 1. First user message: instruction only (no image)
        messages.append({
            "role": "user",
            "content": [{"type": "text", "text": instruction}]
        })
        
        # 2. Add action history (assistant messages for steps 0 to N-1)
        for step_idx in range(current_step_index):
            step = all_steps[step_idx]
            
            # Process historical step's image for coordinate conversion
            # Note: we don't include the image in messages, only use it for coordinate conversion
            _, orig_width, orig_height, scale_ratio = process_step_image(
                step=step,
                step_index=step_idx,
                trajectory_dir=trajectory_dir,
                image_base_dir=image_base_dir,
                max_dim=max_dim,
                output_dir=output_dir,
            )
            
            # Build assistant content
            thinking = step.get("thinking", "")
            action = step.get("action", {})
            
            # Convert coordinates based on the step's image dimensions
            if orig_width and orig_height:
                action = convert_coordinates_in_action(
                    action, orig_width, orig_height, scale_ratio
                )
            
            # Format assistant response
            action_json = json.dumps(action, ensure_ascii=False)
            response_text = (
                f"<thinking>\n{thinking}\n</thinking>\n"
                f"<tool_call>\n{{\"name\": \"mobile_use\", \"arguments\": {action_json}}}\n</tool_call>"
            )
            
            messages.append({
                "role": "assistant",
                "content": [{"type": "text", "text": response_text}]
            })
        
        # 3. Last user message: current screenshot only (right before the response to predict)
        messages.append({
            "role": "user",
            "content": [{"type": "image_url", "image_url": current_image_filename}]
        })
    
    # 4. Current step's assistant response (the one to predict)
    current_thinking = current_step.get("thinking", "")
    current_action = current_step.get("action", {})
    
    # Convert coordinates based on current step's image dimensions
    if current_orig_width and current_orig_height:
        current_action = convert_coordinates_in_action(
            current_action, current_orig_width, current_orig_height, current_scale_ratio
        )
    
    # Format assistant response
    current_action_json = json.dumps(current_action, ensure_ascii=False)
    current_response_text = (
        f"<thinking>\n{current_thinking}\n</thinking>\n"
        f"<tool_call>\n{{\"name\": \"mobile_use\", \"arguments\": {current_action_json}}}\n</tool_call>"
    )
    
    messages.append({
        "role": "assistant",
        "content": [{"type": "text", "text": current_response_text}]
    })
    
    # Build metadata for the final step
    final_metadata = {
        "source": str(trajectory_dir),
        "step_index": current_step.get("step_index", current_step_index + 1),
        "action_type": current_step.get("action_type", current_step.get("action", {}).get("action", "unknown")),
        "success": current_step.get("success", True),
        "timestamp": current_step.get("timestamp"),
        "screenshot_path": current_image_filename,
        "num_turns": current_step_index + 1,
    }
    if current_orig_width and current_orig_height:
        final_metadata["original_image_width"] = current_orig_width
        final_metadata["original_image_height"] = current_orig_height
        if max_dim is not None:
            # Calculate resized dimensions
            if max(current_orig_width, current_orig_height) > max_dim:
                ratio = max_dim / max(current_orig_width, current_orig_height)
                final_metadata["image_width"] = int(current_orig_width * ratio)
                final_metadata["image_height"] = int(current_orig_height * ratio)
                final_metadata["scale_ratio"] = current_scale_ratio
            else:
                final_metadata["image_width"] = current_orig_width
                final_metadata["image_height"] = current_orig_height
    
    return messages, final_metadata


def build_training_sample(
    step: dict,
    step_index: int,
    all_steps: list[dict],
    trajectory_dir: Path,
    system_prompt: str,
    image_base_dir: Path | None = None,
    max_history: int | None = None,
    max_dim: int | None = None,
    output_dir: Path | None = None,
    multi_turn: bool = False,
) -> dict | None:
    """Build a single training sample for a step.
    
    Args:
        step: Current step data.
        step_index: Index of current step (0-based).
        all_steps: List of all steps in trajectory.
        trajectory_dir: Directory containing trajectory file.
        system_prompt: System prompt text.
        image_base_dir: Optional base directory for images.
        max_history: Maximum history steps to include.
        max_dim: Maximum image dimension for resizing (None = no resize).
        output_dir: Directory to save resized images (default: same as trajectory_dir).
        multi_turn: If True, use multi-turn conversation format instead of 
            history text concatenation.
        
    Returns:
        Training sample dict, or None if image is missing.
    """
    # Use multi-turn format if requested
    if multi_turn:
        result = build_multi_turn_messages(
            all_steps=all_steps,
            current_step_index=step_index,
            trajectory_dir=trajectory_dir,
            system_prompt=system_prompt,
            image_base_dir=image_base_dir,
            max_dim=max_dim,
            output_dir=output_dir,
        )
        if result is None:
            return None
        messages, metadata = result
        return {
            "messages": messages,
            "metadata": metadata
        }
    
    # Original single-turn format with history text concatenation
    # Extract step data
    instruction = step.get("instruction", "")
    thinking = step.get("thinking", "")
    action = step.get("action", {})
    screenshot_path = step.get("screenshot_path", "")
    
    # Use just the filename for image path (since output will be in same dir)
    image_filename = get_image_filename(screenshot_path)
    
    # Verify image exists (use full path for validation)
    full_image_path = resolve_image_path(
        screenshot_path,
        trajectory_dir,
        image_base_dir,
    )
    
    if not full_image_path or not Path(full_image_path).exists():
        return None
    
    # Load image and get original dimensions
    original_width = None
    original_height = None
    resized_image = None
    scale_ratio = 1.0
    resized_width = None
    resized_height = None
    
    if HAS_PIL:
        try:
            with Image.open(full_image_path) as img:
                original_width, original_height = img.size
                
                # Resize image if max_dim is specified
                if max_dim is not None:
                    resized_image, scale_ratio = resize_image(img.copy(), max_dim)
                    resized_width, resized_height = resized_image.size
                    
                    # Save resized image
                    if output_dir is None:
                        output_dir = trajectory_dir
                    output_dir.mkdir(parents=True, exist_ok=True)
                    
                    # Save with _resized suffix to avoid overwriting original
                    image_path_obj = Path(image_filename)
                    resized_filename = f"{image_path_obj.stem}_resized{image_path_obj.suffix}"
                    resized_path = output_dir / resized_filename
                    resized_image.save(resized_path, quality=95)
                    image_filename = resized_filename  # Update filename to point to resized image
                else:
                    resized_width, resized_height = original_width, original_height
        except Exception as e:
            print(f"Warning: Failed to process image {full_image_path}: {e}")
            return None
    else:
        # Fallback: get size without PIL
        size = get_image_size(full_image_path)
        if size:
            original_width, original_height = size
            resized_width, resized_height = original_width, original_height
    
    # Use resized dimensions for coordinate conversion
    image_width = resized_width if resized_width else original_width
    image_height = resized_height if resized_height else original_height
    
    # Build image sizes and scale ratios dicts for history coordinate conversion
    image_sizes = {}
    scale_ratios = {}
    if image_width and image_height:
        image_sizes[step_index] = (original_width, original_height)  # Store original size for conversion
        scale_ratios[step_index] = scale_ratio
        
        # Also get sizes for history steps
        # Use process_step_image to ensure resized images are saved for history steps too
        for i in range(step_index):
            hist_step = all_steps[i]
            hist_screenshot_path = hist_step.get("screenshot_path", "")
            if hist_screenshot_path:
                # Use process_step_image to process and save resized image
                _, hist_orig_width, hist_orig_height, hist_scale_ratio = process_step_image(
                    step=hist_step,
                    step_index=i,
                    trajectory_dir=trajectory_dir,
                    image_base_dir=image_base_dir,
                    max_dim=max_dim,
                    output_dir=output_dir,
                )
                if hist_orig_width and hist_orig_height:
                    image_sizes[i] = (hist_orig_width, hist_orig_height)
                    scale_ratios[i] = hist_scale_ratio
    
    # Format history chain (empty for first step)
    history_text = format_history_chain(
        all_steps, 
        step_index, 
        max_history,
        image_sizes=image_sizes if image_sizes else None,
        scale_ratios=scale_ratios if scale_ratios else None,
    )
    
    # Build user content (use filename for image_url)
    user_content = build_user_content(image_filename, instruction, history_text)
    
    # Build assistant content (with original image size and scale ratio for coordinate conversion)
    assistant_content = build_assistant_content(
        thinking, 
        action,
        image_width=original_width,
        image_height=original_height,
        scale_ratio=scale_ratio,
    )
    
    # Build messages
    messages = [
        {
            "role": "system",
            "content": [{"type": "text", "text": system_prompt}]
        },
        {
            "role": "user",
            "content": user_content
        },
        {
            "role": "assistant",
            "content": assistant_content
        }
    ]
    
    # Build metadata
    metadata = {
        "source": str(trajectory_dir),
        "step_index": step.get("step_index", step_index + 1),
        "action_type": step.get("action_type", action.get("action", "unknown")),
        "success": step.get("success", True),
        "timestamp": step.get("timestamp"),
        "screenshot_path": image_filename,  # Store filename (may be resized)
    }
    
    # Add image dimensions to metadata (store both original and resized)
    if original_width and original_height:
        metadata["original_image_width"] = original_width
        metadata["original_image_height"] = original_height
    if resized_width and resized_height:
        metadata["image_width"] = resized_width
        metadata["image_height"] = resized_height
    if scale_ratio != 1.0:
        metadata["scale_ratio"] = scale_ratio
    
    return {
        "messages": messages,
        "metadata": metadata
    }


# =============================================================================
# Main Processing Functions
# =============================================================================

def process_trajectory_to_qwen3vl_format(
    trajectory_file: str,
    output_file: str | None = None,
    system_prompt: str | None = None,
    image_base_dir: str | None = None,
    max_history: int | None = None,
    skip_missing_images: bool = True,
    max_dim: int | None = None,
    multi_turn: bool = False,
) -> dict[str, Any]:
    """Convert trajectory.jsonl to Qwen3-VL training format.
    
    Args:
        trajectory_file: Path to trajectory.jsonl file.
        output_file: Output JSONL file path.
        system_prompt: System prompt (uses default if None).
        image_base_dir: Base directory for resolving image paths.
        max_history: Maximum history steps to include (None = all).
        skip_missing_images: Whether to skip steps with missing images.
        max_dim: Maximum image dimension for resizing (None = no resize).
        multi_turn: If True, use multi-turn conversation format.
        
    Returns:
        Statistics dictionary with counts and image size information.
    """
    # Use default system prompt if not provided
    if system_prompt is None:
        system_prompt = GUI_AGENT_SYSTEM_PROMPT
    
    # Load trajectory
    steps = load_trajectory(trajectory_file)
    
    if not steps:
        return {"total_steps": 0, "processed": 0, "skipped": 0}
    
    # Get directories
    trajectory_path = Path(trajectory_file)
    trajectory_dir = trajectory_path.parent
    image_base = Path(image_base_dir) if image_base_dir else None
    
    # Set default output file if not provided
    if output_file is None:
        output_file = str(trajectory_dir / "sft_train.jsonl")
    
    # Determine output directory for resized images
    output_path = Path(output_file)
    output_dir = output_path.parent
    
    # Pre-process all images first: resize all images regardless of whether they'll be used in samples
    # This ensures all images get resized versions, even if some steps are skipped
    if max_dim is not None:
        print(f"Pre-processing {len(steps)} images for resizing...")
        for i, step in enumerate(steps):
            screenshot_path = step.get("screenshot_path", "")
            if screenshot_path:
                try:
                    # Process image to ensure resized version is created
                    process_step_image(
                        step=step,
                        step_index=i,
                        trajectory_dir=trajectory_dir,
                        image_base_dir=image_base,
                        max_dim=max_dim,
                        output_dir=output_dir,
                    )
                except Exception as e:
                    # Continue processing other images even if one fails
                    print(f"Warning: Failed to pre-process image for step {i}: {e}")
                    continue
    
    # Process each step
    samples = []
    stats = {
        "total_steps": len(steps),
        "processed": 0,
        "skipped": 0,
        "action_types": {},
        "image_stats": {
            "original_sizes": [],
            "resized_sizes": [],
            "resized_count": 0,
        },
    }
    
    for i, step in enumerate(steps):
        screenshot_path = step.get("screenshot_path", "")
        
        # Verify image exists (use full path for validation)
        full_image_path = resolve_image_path(
            screenshot_path,
            trajectory_dir,
            image_base,
        )
        
        if skip_missing_images and screenshot_path and not full_image_path:
            stats["skipped"] += 1
            continue
        
        sample = build_training_sample(
            step=step,
            step_index=i,
            all_steps=steps,
            trajectory_dir=trajectory_dir,
            system_prompt=system_prompt,
            image_base_dir=image_base,
            max_history=max_history,
            max_dim=max_dim,
            output_dir=output_dir,
            multi_turn=multi_turn,
        )
        
        if sample:
            samples.append(sample)
            stats["processed"] += 1
            
            # Track action types
            action_type = sample["metadata"].get("action_type", "unknown")
            stats["action_types"][action_type] = stats["action_types"].get(action_type, 0) + 1
            
            # Track image size statistics
            metadata = sample["metadata"]
            if "original_image_width" in metadata and "original_image_height" in metadata:
                orig_w = metadata["original_image_width"]
                orig_h = metadata["original_image_height"]
                stats["image_stats"]["original_sizes"].append((orig_w, orig_h))
                
                if "image_width" in metadata and "image_height" in metadata:
                    resized_w = metadata["image_width"]
                    resized_h = metadata["image_height"]
                    stats["image_stats"]["resized_sizes"].append((resized_w, resized_h))
                    if (resized_w, resized_h) != (orig_w, orig_h):
                        stats["image_stats"]["resized_count"] += 1
        else:
            stats["skipped"] += 1
    
    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, "w", encoding="utf-8") as f:
        for sample in samples:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")
    
    return stats


def process_trajectory_directory(
    trajectory_dir: str,
    output_file: str | None = None,
    system_prompt: str | None = None,
    max_history: int | None = None,
    skip_missing_images: bool = True,
    max_dim: int | None = None,
    multi_turn: bool = False,
) -> dict[str, Any]:
    """Process all trajectory.jsonl files in a directory.
    
    Args:
        trajectory_dir: Directory containing trajectory folders.
        output_file: Output JSONL file path (default: each trajectory's directory).
        system_prompt: System prompt (uses default if None).
        max_history: Maximum history steps to include.
        skip_missing_images: Whether to skip steps with missing images.
        max_dim: Maximum image dimension for resizing (None = no resize).
        multi_turn: If True, use multi-turn conversation format.
        
    Returns:
        Combined statistics dictionary.
    """
    if system_prompt is None:
        system_prompt = GUI_AGENT_SYSTEM_PROMPT
    
    trajectory_path = Path(trajectory_dir)
    
    # Find all trajectory.jsonl files
    trajectory_files = list(trajectory_path.rglob("trajectory.jsonl"))
    
    if not trajectory_files:
        print(f"No trajectory.jsonl files found in {trajectory_dir}")
        return {"total_trajectories": 0, "total_samples": 0}
    
    print(f"Found {len(trajectory_files)} trajectory files")
    
    # Process all trajectories
    all_samples = []
    total_stats = {
        "total_trajectories": len(trajectory_files),
        "total_steps": 0,
        "processed": 0,
        "skipped": 0,
        "action_types": {},
        "image_stats": {
            "original_sizes": [],
            "resized_sizes": [],
            "resized_count": 0,
        },
    }
    
    for traj_file in trajectory_files:
        print(f"Processing: {traj_file}")
        
        # Load and process trajectory
        steps = load_trajectory(str(traj_file))
        if not steps:
            continue
        
        traj_dir = traj_file.parent
        
        # Determine output file for this trajectory
        if output_file is None:
            # Output to each trajectory's directory
            traj_output_file = str(traj_dir / "sft_train.jsonl")
            output_dir = traj_dir
        else:
            # Use provided output file (combine all trajectories)
            traj_output_file = output_file
            output_dir = Path(output_file).parent
        
        # Pre-process all images first: resize all images regardless of whether they'll be used in samples
        # This ensures all images get resized versions, even if some steps are skipped
        if max_dim is not None:
            print(f"  Pre-processing {len(steps)} images for resizing...")
            for i, step in enumerate(steps):
                screenshot_path = step.get("screenshot_path", "")
                if screenshot_path:
                    try:
                        # Process image to ensure resized version is created
                        process_step_image(
                            step=step,
                            step_index=i,
                            trajectory_dir=traj_dir,
                            image_base_dir=None,
                            max_dim=max_dim,
                            output_dir=output_dir,
                        )
                    except Exception as e:
                        # Continue processing other images even if one fails
                        print(f"  Warning: Failed to pre-process image for step {i}: {e}")
                        continue
        
        traj_samples = []
        
        for i, step in enumerate(steps):
            screenshot_path = step.get("screenshot_path", "")
            
            # Verify image exists (use full path for validation)
            full_image_path = resolve_image_path(
                screenshot_path,
                traj_dir,
                None,
            )
            
            if skip_missing_images and screenshot_path and not full_image_path:
                total_stats["skipped"] += 1
                continue
            
            sample = build_training_sample(
                step=step,
                step_index=i,
                all_steps=steps,
                trajectory_dir=traj_dir,
                system_prompt=system_prompt,
                image_base_dir=None,
                max_history=max_history,
                max_dim=max_dim,
                output_dir=output_dir,
                multi_turn=multi_turn,
            )
            
            if sample:
                traj_samples.append(sample)
                all_samples.append(sample)
                total_stats["processed"] += 1
                
                action_type = sample["metadata"].get("action_type", "unknown")
                total_stats["action_types"][action_type] = (
                    total_stats["action_types"].get(action_type, 0) + 1
                )
                
                # Track image size statistics
                metadata = sample["metadata"]
                if "original_image_width" in metadata and "original_image_height" in metadata:
                    orig_w = metadata["original_image_width"]
                    orig_h = metadata["original_image_height"]
                    total_stats["image_stats"]["original_sizes"].append((orig_w, orig_h))
                    
                    if "image_width" in metadata and "image_height" in metadata:
                        resized_w = metadata["image_width"]
                        resized_h = metadata["image_height"]
                        total_stats["image_stats"]["resized_sizes"].append((resized_w, resized_h))
                        if (resized_w, resized_h) != (orig_w, orig_h):
                            total_stats["image_stats"]["resized_count"] += 1
            else:
                total_stats["skipped"] += 1
        
        total_stats["total_steps"] += len(steps)
        
        # Write output for this trajectory (if output_file is None, write to each dir)
        if output_file is None:
            output_path = Path(traj_output_file)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(traj_output_file, "w", encoding="utf-8") as f:
                for sample in traj_samples:
                    f.write(json.dumps(sample, ensure_ascii=False) + "\n")
            print(f"  Saved {len(traj_samples)} samples to: {traj_output_file}")
    
    # Write combined output if output_file was provided
    if output_file is not None:
        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, "w", encoding="utf-8") as f:
            for sample in all_samples:
                f.write(json.dumps(sample, ensure_ascii=False) + "\n")
        print(f"\nTotal samples: {len(all_samples)}")
        print(f"Saved to: {output_file}")
    
    return total_stats


# =============================================================================
# Batch Processing with Multi-threading
# =============================================================================

def _process_single_folder(
    folder_path: Path,
    parent_dir: Path,
    system_prompt: str,
    max_history: int | None,
    skip_missing_images: bool,
    max_dim: int | None,
    multi_turn: bool,
    print_lock: Lock | None = None,
) -> tuple[list[dict], dict]:
    """Process a single subfolder in a thread-safe manner.
    
    This function processes one trajectory folder and returns samples with
    screenshot_path formatted as "subfolder_name/step_XXX_resized.png".
    
    Args:
        folder_path: Path to the subfolder containing trajectory.jsonl.
        parent_dir: Parent directory (train_data dir) for relative path calculation.
        system_prompt: System prompt text.
        max_history: Maximum history steps to include.
        skip_missing_images: Whether to skip steps with missing images.
        max_dim: Maximum image dimension for resizing.
        multi_turn: If True, use multi-turn conversation format.
        print_lock: Optional lock for thread-safe printing.
        
    Returns:
        Tuple of (samples list, stats dict).
    """
    # Get subfolder name for path prefix
    subfolder_name = folder_path.name
    
    # Find trajectory.jsonl in this folder
    trajectory_file = folder_path / "trajectory.jsonl"
    if not trajectory_file.exists():
        return [], {"total_steps": 0, "processed": 0, "skipped": 0, "error": "No trajectory.jsonl"}
    
    # Thread-safe print
    def safe_print(msg: str) -> None:
        if print_lock:
            with print_lock:
                print(msg)
        else:
            print(msg)
    
    safe_print(f"Processing: {subfolder_name}")
    
    # Load trajectory
    steps = load_trajectory(str(trajectory_file))
    if not steps:
        return [], {"total_steps": 0, "processed": 0, "skipped": 0}
    
    # Pre-process all images (resize)
    if max_dim is not None:
        safe_print(f"  [{subfolder_name}] Pre-processing {len(steps)} images for resizing...")
        for i, step in enumerate(steps):
            screenshot_path = step.get("screenshot_path", "")
            if screenshot_path:
                try:
                    process_step_image(
                        step=step,
                        step_index=i,
                        trajectory_dir=folder_path,
                        image_base_dir=None,
                        max_dim=max_dim,
                        output_dir=folder_path,  # Save resized images in same folder
                    )
                except Exception as e:
                    safe_print(f"  [{subfolder_name}] Warning: Failed to pre-process image for step {i}: {e}")
                    continue
    
    # Process each step and build samples
    samples = []
    stats = {
        "total_steps": len(steps),
        "processed": 0,
        "skipped": 0,
        "action_types": {},
        "image_stats": {
            "original_sizes": [],
            "resized_sizes": [],
            "resized_count": 0,
        },
    }
    
    for i, step in enumerate(steps):
        screenshot_path = step.get("screenshot_path", "")
        
        # Verify image exists
        full_image_path = resolve_image_path(
            screenshot_path,
            folder_path,
            None,
        )
        
        if skip_missing_images and screenshot_path and not full_image_path:
            stats["skipped"] += 1
            continue
        
        sample = build_training_sample(
            step=step,
            step_index=i,
            all_steps=steps,
            trajectory_dir=folder_path,
            system_prompt=system_prompt,
            image_base_dir=None,
            max_history=max_history,
            max_dim=max_dim,
            output_dir=folder_path,
            multi_turn=multi_turn,
        )
        
        if sample:
            # Update screenshot_path to include subfolder name
            # This is the key modification for batch processing
            if "metadata" in sample and "screenshot_path" in sample["metadata"]:
                original_path = sample["metadata"]["screenshot_path"]
                sample["metadata"]["screenshot_path"] = f"{subfolder_name}/{original_path}"
            
            # Also update image_url in messages for training
            for msg in sample.get("messages", []):
                if msg.get("role") == "user":
                    for content in msg.get("content", []):
                        if content.get("type") == "image_url" and "image_url" in content:
                            original_url = content["image_url"]
                            # Only update if it's a relative path (not already prefixed)
                            if not original_url.startswith(subfolder_name):
                                content["image_url"] = f"{subfolder_name}/{original_url}"
            
            samples.append(sample)
            stats["processed"] += 1
            
            # Track action types
            action_type = sample["metadata"].get("action_type", "unknown")
            stats["action_types"][action_type] = stats["action_types"].get(action_type, 0) + 1
            
            # Track image size statistics
            metadata = sample["metadata"]
            if "original_image_width" in metadata and "original_image_height" in metadata:
                orig_w = metadata["original_image_width"]
                orig_h = metadata["original_image_height"]
                stats["image_stats"]["original_sizes"].append((orig_w, orig_h))
                
                if "image_width" in metadata and "image_height" in metadata:
                    resized_w = metadata["image_width"]
                    resized_h = metadata["image_height"]
                    stats["image_stats"]["resized_sizes"].append((resized_w, resized_h))
                    if (resized_w, resized_h) != (orig_w, orig_h):
                        stats["image_stats"]["resized_count"] += 1
        else:
            stats["skipped"] += 1
    
    safe_print(f"  [{subfolder_name}] Processed {stats['processed']} samples, skipped {stats['skipped']}")
    return samples, stats


def process_train_data_directory(
    train_data_dir: str,
    output_file: str | None = None,
    system_prompt: str | None = None,
    max_history: int | None = None,
    skip_missing_images: bool = True,
    max_dim: int | None = None,
    multi_turn: bool = False,
    num_workers: int = 4,
) -> dict[str, Any]:
    """Process all subfolders in train_data directory using multi-threading.
    
    This function discovers all subfolders containing trajectory.jsonl files,
    processes them in parallel using ThreadPoolExecutor, and combines all
    samples into a single sft_train.jsonl file.
    
    The screenshot_path in output will be formatted as "subfolder_name/step_XXX_resized.png"
    to support the combined output file structure.
    
    Args:
        train_data_dir: Path to the train_data directory containing subfolders.
        output_file: Output JSONL file path (default: train_data_dir/sft_train.jsonl).
        system_prompt: System prompt (uses default if None).
        max_history: Maximum history steps to include.
        skip_missing_images: Whether to skip steps with missing images.
        max_dim: Maximum image dimension for resizing (None = no resize).
        multi_turn: If True, use multi-turn conversation format.
        num_workers: Number of parallel worker threads (default: 4).
        
    Returns:
        Combined statistics dictionary.
    """
    if system_prompt is None:
        system_prompt = GUI_AGENT_SYSTEM_PROMPT
    
    train_data_path = Path(train_data_dir)
    
    if not train_data_path.exists():
        print(f"Error: Directory not found: {train_data_dir}")
        return {"error": "Directory not found"}
    
    # Discover all subfolders with trajectory.jsonl
    subfolders = []
    for item in sorted(train_data_path.iterdir()):
        if item.is_dir() and (item / "trajectory.jsonl").exists():
            subfolders.append(item)
    
    if not subfolders:
        print(f"No subfolders with trajectory.jsonl found in {train_data_dir}")
        return {"total_folders": 0, "total_samples": 0}
    
    print(f"Found {len(subfolders)} folders to process with {num_workers} workers")
    print(f"Folders: {[f.name for f in subfolders]}")
    
    # Set default output file
    if output_file is None:
        output_file = str(train_data_path / "sft_train.jsonl")
    
    # Create a lock for thread-safe printing
    print_lock = Lock()
    
    # Process folders in parallel
    all_samples = []
    total_stats = {
        "total_folders": len(subfolders),
        "total_steps": 0,
        "processed": 0,
        "skipped": 0,
        "action_types": {},
        "image_stats": {
            "original_sizes": [],
            "resized_sizes": [],
            "resized_count": 0,
        },
    }
    
    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        # Submit all tasks
        future_to_folder = {
            executor.submit(
                _process_single_folder,
                folder,
                train_data_path,
                system_prompt,
                max_history,
                skip_missing_images,
                max_dim,
                multi_turn,
                print_lock,
            ): folder
            for folder in subfolders
        }
        
        # Collect results as they complete
        for future in as_completed(future_to_folder):
            folder = future_to_folder[future]
            try:
                samples, stats = future.result()
                
                # Merge samples
                all_samples.extend(samples)
                
                # Merge stats
                total_stats["total_steps"] += stats.get("total_steps", 0)
                total_stats["processed"] += stats.get("processed", 0)
                total_stats["skipped"] += stats.get("skipped", 0)
                
                # Merge action types
                for action_type, count in stats.get("action_types", {}).items():
                    total_stats["action_types"][action_type] = (
                        total_stats["action_types"].get(action_type, 0) + count
                    )
                
                # Merge image stats
                img_stats = stats.get("image_stats", {})
                total_stats["image_stats"]["original_sizes"].extend(
                    img_stats.get("original_sizes", [])
                )
                total_stats["image_stats"]["resized_sizes"].extend(
                    img_stats.get("resized_sizes", [])
                )
                total_stats["image_stats"]["resized_count"] += (
                    img_stats.get("resized_count", 0)
                )
                
            except Exception as e:
                with print_lock:
                    print(f"Error processing {folder.name}: {e}")
    
    # Sort samples by screenshot_path for consistent output
    all_samples.sort(key=lambda x: x.get("metadata", {}).get("screenshot_path", ""))
    
    # Write combined output
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, "w", encoding="utf-8") as f:
        for sample in all_samples:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")
    
    print(f"\n{'='*60}")
    print(f"Batch processing completed!")
    print(f"  Total folders: {total_stats['total_folders']}")
    print(f"  Total samples: {len(all_samples)}")
    print(f"  Saved to: {output_file}")
    
    total_stats["total_samples"] = len(all_samples)
    return total_stats


# =============================================================================
# CLI Entry Point
# =============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert trajectory.jsonl to Qwen3-VL training format"
    )
    parser.add_argument(
        "--trajectory", "-t",
        type=str,
        help="Path to single trajectory.jsonl file"
    )
    parser.add_argument(
        "--trajectory_dir", "-d",
        type=str,
        help="Directory containing trajectory folders"
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="Output JSONL file path (default: same dir as trajectory)"
    )
    parser.add_argument(
        "--max_history",
        type=int,
        default=None,
        help="Maximum number of history steps (default: all)"
    )
    parser.add_argument(
        "--image_base_dir",
        type=str,
        default=None,
        help="Base directory for resolving image paths"
    )
    parser.add_argument(
        "--no_skip_missing",
        action="store_true",
        help="Don't skip steps with missing images"
    )
    parser.add_argument(
        "--max_dim",
        type=int,
        default=None,
        help="Maximum image dimension for resizing (default: None, no resize). "
             "Images will be resized maintaining aspect ratio, similar to inference."
    )
    parser.add_argument(
        "--multi_turn",
        action="store_true",
        help="Use multi-turn conversation format instead of history text concatenation. "
             "In multi-turn format, each step is a separate user-assistant turn with images."
    )
    parser.add_argument(
        "--train_data_dir",
        type=str,
        default=None,
        help="Path to train_data directory for batch processing. "
             "Will process all subfolders in parallel and combine into single sft_train.jsonl. "
             "screenshot_path will be formatted as 'subfolder/step_XXX_resized.png'."
    )
    parser.add_argument(
        "--num_workers",
        type=int,
        default=4,
        help="Number of parallel worker threads for batch processing (default: 4). "
             "Only used with --train_data_dir."
    )
    
    args = parser.parse_args()
    
    if not args.trajectory and not args.trajectory_dir and not args.train_data_dir:
        parser.error("Either --trajectory, --trajectory_dir, or --train_data_dir is required")
    
    skip_missing = not args.no_skip_missing
    
    # Handle batch processing mode (--train_data_dir)
    if args.train_data_dir:
        stats = process_train_data_directory(
            train_data_dir=args.train_data_dir,
            output_file=args.output,
            max_history=args.max_history,
            skip_missing_images=skip_missing,
            max_dim=args.max_dim,
            multi_turn=args.multi_turn,
            num_workers=args.num_workers,
        )
        print(f"\nFinal stats:")
        print(f"  Total folders: {stats.get('total_folders', 0)}")
        print(f"  Processed: {stats.get('processed', 0)}")
        print(f"  Skipped: {stats.get('skipped', 0)}")
        print(f"  Action types: {stats.get('action_types', {})}")
        
        # Print image resize statistics
        if args.max_dim is not None and stats.get("image_stats"):
            img_stats = stats["image_stats"]
            if img_stats.get("original_sizes"):
                orig_sizes = img_stats["original_sizes"]
                resized_sizes = img_stats.get("resized_sizes", [])
                resized_count = img_stats.get("resized_count", 0)
                
                if orig_sizes:
                    avg_orig_w = sum(s[0] for s in orig_sizes) / len(orig_sizes)
                    avg_orig_h = sum(s[1] for s in orig_sizes) / len(orig_sizes)
                    print(f"\nImage resize statistics (max_dim={args.max_dim}):")
                    print(f"  Original avg size: {avg_orig_w:.0f}x{avg_orig_h:.0f}")
                    
                    if resized_sizes:
                        avg_resized_w = sum(s[0] for s in resized_sizes) / len(resized_sizes)
                        avg_resized_h = sum(s[1] for s in resized_sizes) / len(resized_sizes)
                        print(f"  Resized avg size: {avg_resized_w:.0f}x{avg_resized_h:.0f}")
                        print(f"  Images resized: {resized_count}/{len(orig_sizes)}")
    elif args.trajectory:
        # Process single trajectory
        # Determine output file path
        if args.output is None:
            trajectory_path = Path(args.trajectory)
            output_path = trajectory_path.parent / "sft_train.jsonl"
        else:
            output_path = Path(args.output)
        
        stats = process_trajectory_to_qwen3vl_format(
            trajectory_file=args.trajectory,
            output_file=str(output_path) if args.output is None else args.output,
            image_base_dir=args.image_base_dir,
            max_history=args.max_history,
            skip_missing_images=skip_missing,
            max_dim=args.max_dim,
            multi_turn=args.multi_turn,
        )
        print(f"Processed: {stats['processed']}, Skipped: {stats['skipped']}")
        print(f"Action types: {stats['action_types']}")
        
        # Print image resize statistics
        if args.max_dim is not None and stats.get("image_stats"):
            img_stats = stats["image_stats"]
            if img_stats.get("original_sizes"):
                orig_sizes = img_stats["original_sizes"]
                resized_sizes = img_stats.get("resized_sizes", [])
                resized_count = img_stats.get("resized_count", 0)
                
                if orig_sizes:
                    avg_orig_w = sum(s[0] for s in orig_sizes) / len(orig_sizes)
                    avg_orig_h = sum(s[1] for s in orig_sizes) / len(orig_sizes)
                    print(f"\nImage resize statistics (max_dim={args.max_dim}):")
                    print(f"  Original avg size: {avg_orig_w:.0f}x{avg_orig_h:.0f}")
                    
                    if resized_sizes:
                        avg_resized_w = sum(s[0] for s in resized_sizes) / len(resized_sizes)
                        avg_resized_h = sum(s[1] for s in resized_sizes) / len(resized_sizes)
                        print(f"  Resized avg size: {avg_resized_w:.0f}x{avg_resized_h:.0f}")
                        print(f"  Images resized: {resized_count}/{len(orig_sizes)}")
        
        print(f"Saved to: {output_path}")
    else:
        # Process directory
        stats = process_trajectory_directory(
            trajectory_dir=args.trajectory_dir,
            output_file=args.output,
            max_history=args.max_history,
            skip_missing_images=skip_missing,
            max_dim=args.max_dim,
            multi_turn=args.multi_turn,
        )
        print(f"\nFinal stats:")
        print(f"  Processed: {stats.get('processed', 0)}")
        print(f"  Skipped: {stats.get('skipped', 0)}")
        print(f"  Action types: {stats.get('action_types', {})}")
        
        # Print image resize statistics
        if args.max_dim is not None and stats.get("image_stats"):
            img_stats = stats["image_stats"]
            if img_stats.get("original_sizes"):
                orig_sizes = img_stats["original_sizes"]
                resized_sizes = img_stats.get("resized_sizes", [])
                resized_count = img_stats.get("resized_count", 0)
                
                if orig_sizes:
                    avg_orig_w = sum(s[0] for s in orig_sizes) / len(orig_sizes)
                    avg_orig_h = sum(s[1] for s in orig_sizes) / len(orig_sizes)
                    print(f"\nImage resize statistics (max_dim={args.max_dim}):")
                    print(f"  Original avg size: {avg_orig_w:.0f}x{avg_orig_h:.0f}")
                    
                    if resized_sizes:
                        avg_resized_w = sum(s[0] for s in resized_sizes) / len(resized_sizes)
                        avg_resized_h = sum(s[1] for s in resized_sizes) / len(resized_sizes)
                        print(f"  Resized avg size: {avg_resized_w:.0f}x{avg_resized_h:.0f}")
                        print(f"  Images resized: {resized_count}/{len(orig_sizes)}")


if __name__ == "__main__":
    main()
