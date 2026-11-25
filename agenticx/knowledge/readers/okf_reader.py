"""OKF (Open Knowledge Format v0.2) Bundle 读取器。

按 OKF 规范把 Bundle 目录树解析为 Document：
- Bundle 模式（source 为目录）：遍历目录树内 .md，跳过保留文件 index.md/log.md，
  concept_id 为相对 Bundle 根的路径（去 .md 后缀）。
- 单文件模式（source 为文件）：解析单个 Concept；index.md/log.md 返回空列表
  （规范明文：保留文件不能用作 Concept）。

frontmatter 用 PyYAML 全量解析；解析失败按 OKF 宽容消费原则降级为纯文本入库
（log warning，不拒收不抛错）。原始 frontmatter 完整 dict 存 metadata.custom["okf"]
（含未知字段，round-trip 保真）；title→name、tags→tags，其余字段
（type/resource/sources/generated/verified/status/stale_after 等）原样保留在
custom["okf"]，concept_id 一并写入。
"""

import asyncio
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, AsyncIterator

import yaml

from ..base import BaseReader
from ..document import Document, DocumentMetadata

logger = logging.getLogger(__name__)

# OKF 规范保留文件：任意层级都有固定含义，不能用作普通 Concept
_RESERVED_FILENAMES = {"index.md", "log.md"}

# frontmatter 在 DocumentMetadata.custom 中的命名空间
OKF_METADATA_KEY = "okf"

# frontmatter 允许的最大体积，超过则视为普通文本，防止把正文误当 YAML 解析
_MAX_FRONTMATTER_BYTES = 64 * 1024


class _NoTimestampLoader(yaml.SafeLoader):
    """禁用 PyYAML 对 ISO 时间戳的隐式 datetime 转换。

    OKF 的时间字段（generated.at / verified[].at / stale_after 等）保持原始字符串：
    一是 round-trip 保真（用户写什么就还原什么），二是 custom 元数据保持
    JSON 可序列化（vector store 的 to_dict 链路依赖）。
    """

    yaml_implicit_resolvers = {
        key: [
            (tag, regexp) for tag, regexp in resolvers
            if tag != "tag:yaml.org,2002:timestamp"
        ]
        for key, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
    }


class OKFReader(BaseReader):
    """OKF Bundle / Concept Markdown 读取器。"""

    def __init__(self, encoding: str = "utf-8", **kwargs):
        self.encoding = encoding
        self.config = kwargs

    async def read(self, source: Union[str, Path], **kwargs) -> List[Document]:
        """读取 OKF Bundle 目录或单个 Concept 文件。

        Args:
            source: Bundle 目录路径或单个 .md 文件路径
            **kwargs: 兼容基类调用链（add_from_path 逐文件调用时传入）

        Returns:
            Document 列表（每个 Concept 一个）
        """
        path = Path(source)

        if not path.exists():
            raise FileNotFoundError(f"Path not found: {path}")

        if path.is_dir():
            # Bundle 模式：concept_id 为相对 Bundle 根的路径
            documents: List[Document] = []
            for file_path in sorted(path.rglob("*.md")):
                if file_path.name in _RESERVED_FILENAMES:
                    continue
                documents.extend(await self._read_concept(file_path, bundle_root=path))
            logger.info(f"Read OKF bundle at {path}: {len(documents)} concepts")
            return documents

        if not path.is_file():
            raise ValueError(f"Path is neither file nor directory: {path}")

        # 单文件模式：保留文件跳过；concept_id 退化为文件名去后缀
        if path.name in _RESERVED_FILENAMES:
            return []
        return await self._read_concept(path, bundle_root=path.parent)

    async def read_async(self, source: Union[str, Path], **kwargs) -> AsyncIterator[Document]:
        """异步逐个产出 Concept Document。"""
        for document in await self.read(source, **kwargs):
            yield document

    async def _read_concept(self, file_path: Path, bundle_root: Path) -> List[Document]:
        """解析单个 Concept 文件为 Document。"""
        try:
            raw = await asyncio.to_thread(file_path.read_bytes)
            text = raw.decode(self.encoding, errors="replace")
        except OSError as e:
            # 宽容消费：单个文件读失败不拒收整个 Bundle
            logger.warning(f"OKF reader failed to read {file_path}: {e}")
            return []

        frontmatter, body = self._split_frontmatter(text)
        concept_id = self._concept_id(file_path, bundle_root)

        if frontmatter is None:
            # 无 frontmatter：按普通文本降级，custom["okf"] 仅存 concept_id
            okf_meta: Dict[str, Any] = {"concept_id": concept_id}
            name = concept_id
            tags: List[str] = []
        else:
            # 完整 frontmatter dict 原样保留（含未知字段），映射逻辑单点集中于此
            okf_meta = dict(frontmatter)
            okf_meta["concept_id"] = concept_id
            title = frontmatter.get("title")
            name = str(title) if title else concept_id
            raw_tags = frontmatter.get("tags")
            if isinstance(raw_tags, list):
                tags = [str(t) for t in raw_tags]
            else:
                tags = []

        metadata = DocumentMetadata(
            name=name,
            source_type="okf",
            tags=tags,
            custom={OKF_METADATA_KEY: okf_meta},
        )
        return [Document(content=body, metadata=metadata)]

    @staticmethod
    def _split_frontmatter(text: str) -> tuple:
        """拆分 YAML frontmatter 与正文。

        Returns:
            (frontmatter_dict_or_None, body)；无合法 frontmatter 或 YAML 解析失败
            时返回 (None, 原全文)——宽容降级。
        """
        lines = text.lstrip("\ufeff").split("\n")
        if not lines or lines[0].strip() != "---":
            return None, text

        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                fm_text = "\n".join(lines[1:i])
                if len(fm_text.encode("utf-8")) > _MAX_FRONTMATTER_BYTES:
                    return None, text
                body = "\n".join(lines[i + 1:]).lstrip("\n")
                try:
                    parsed = yaml.load(fm_text, Loader=_NoTimestampLoader)
                except yaml.YAMLError as e:
                    logger.warning(f"OKF frontmatter YAML parse failed, fallback to plain text: {e}")
                    return None, text
                if not isinstance(parsed, dict):
                    # 空块或标量块都视为无 frontmatter
                    if parsed is None:
                        return {}, body
                    return None, text
                return parsed, body

        # 只有起始 --- 没有闭合 ---，视为普通文本
        return None, text

    @staticmethod
    def _concept_id(file_path: Path, bundle_root: Path) -> str:
        """Concept ID：相对 Bundle 根的路径去 .md；无法相对化时退化为文件名。"""
        try:
            relative = file_path.relative_to(bundle_root)
        except ValueError:
            relative = file_path
        return str(relative.with_suffix(""))


__all__ = ["OKFReader", "OKF_METADATA_KEY"]
