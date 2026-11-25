"""OKF (Open Knowledge Format v0.2) Bundle 导出。

把 Document 列表写回 OKF Bundle 目录树，与 okf_reader 构成 round-trip：
- Document.content 作正文 body；
- custom["okf"] 中的字段原样写回 frontmatter（含未知字段；concept_id 为内部
  注入键，导出时剔除，不污染原始 frontmatter）；
- 目录组织按 custom["okf"]["concept_id"] 相对路径；无 concept_id 时按 name 平铺；
- 导出动作按 Actor 命名约定记入 generated：process:agenticx-export + ISO 8601 UTC 时间；
- 无 okf 元数据的文档生成最小合法 frontmatter（type: Reference 或调用方指定）。
"""

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import yaml

from .document import Document
from .readers.okf_reader import OKF_METADATA_KEY

logger = logging.getLogger(__name__)

# 导出动作的 Actor 标识（OKF Actor 命名约定：<producer>/<version> 或 process:<id>）
EXPORT_ACTOR = "process:agenticx-export"

# 无 OKF 元数据的文档默认 type
DEFAULT_EXPORT_TYPE = "Reference"

# concept_id 非法时（空 / 路径穿越）回退的键
_FALLBACK_KEY = "_unnamed"


def export_bundle(
    documents: Sequence[Document],
    output_dir: Path,
    default_type: str = DEFAULT_EXPORT_TYPE,
    skip_unnamed: bool = False,
) -> List[Path]:
    """把 Document 列表导出为 OKF Bundle 目录树。

    Args:
        documents: 待导出的 Document 列表（通常来自 OKFReader 或检索结果）
        output_dir: Bundle 输出目录（不存在则创建）
        default_type: 无 OKF 元数据文档的默认 type（OKF 唯一必填字段）
        skip_unnamed: True 时跳过既无 concept_id 又无 name 的文档；False 用序号平铺

    Returns:
        写入的 Concept 文件路径列表
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    written: List[Path] = []
    seen_targets: Dict[str, int] = {}

    for index, document in enumerate(documents):
        okf_meta = _get_okf_meta(document)
        concept_id = _safe_concept_id(okf_meta, document, index)

        if concept_id is None:
            if skip_unnamed:
                logger.warning(f"Skipping unnamed document at index {index}")
                continue
            concept_id = f"{_FALLBACK_KEY}-{index}"

        # 同名目标去重：追加序号，避免互相覆盖
        target_key = concept_id
        if target_key in seen_targets:
            seen_targets[target_key] += 1
            concept_id = f"{concept_id}~{seen_targets[target_key]}"
        else:
            seen_targets[target_key] = 0

        frontmatter = _build_frontmatter(okf_meta, default_type)
        file_path = output_dir / f"{concept_id}.md"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(
            "---\n" + _dump_yaml(frontmatter) + "---\n\n" + document.content,
            encoding="utf-8",
        )
        written.append(file_path)

    logger.info(f"Exported {len(written)} OKF concepts to {output_dir}")
    return written


def _get_okf_meta(document: Document) -> Dict[str, Any]:
    """提取 Document 上的 OKF 元数据；无则返回空 dict。"""
    okf = document.metadata.custom.get(OKF_METADATA_KEY)
    return dict(okf) if isinstance(okf, dict) else {}


def _safe_concept_id(
    okf_meta: Dict[str, Any], document: Document, index: int
) -> Optional[str]:
    """从 okf 元数据或 name 计算 concept_id；非法（穿越/绝对路径）返回 None。"""
    raw = okf_meta.get("concept_id")
    if not raw or not isinstance(raw, str):
        raw = document.metadata.name

    if not raw or not isinstance(raw, str):
        return None

    candidate = raw.strip().strip("/")
    if not candidate or candidate in {".", ".."}:
        return None
    # 逐段校验路径穿越
    for part in Path(candidate).parts:
        if part in {"..", ""} or (len(part) > 1 and part.endswith(":")):
            return None
    return candidate


def _build_frontmatter(okf_meta: Dict[str, Any], default_type: str) -> Dict[str, Any]:
    """构造导出 frontmatter：原样保留 OKF 字段（剔除内部 concept_id），补导出动作。"""
    frontmatter: Dict[str, Any] = {}
    for key, value in okf_meta.items():
        if key == "concept_id":
            # concept_id 为 reader 内部注入键，不属于原始 frontmatter
            continue
        frontmatter[key] = value

    if not frontmatter.get("type"):
        frontmatter["type"] = default_type

    # 记录导出动作：符合 Actor 命名约定，generated.by 缺失时该字段不成立
    generated = frontmatter.get("generated")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(generated, dict):
        generated = dict(generated)
    else:
        generated = {}
    generated["by"] = EXPORT_ACTOR
    generated["at"] = now
    frontmatter["generated"] = generated
    return frontmatter


def _dump_yaml(data: Dict[str, Any]) -> str:
    """以保持键序、允许 Unicode 的风格 dump frontmatter。"""
    return yaml.safe_dump(
        data,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=120,
    ).rstrip() + "\n"


__all__ = ["export_bundle", "EXPORT_ACTOR", "DEFAULT_EXPORT_TYPE"]
