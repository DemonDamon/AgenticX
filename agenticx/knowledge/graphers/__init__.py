"""
知识图谱构建模块

该模块提供了构建和管理知识图谱的核心功能，包括：
- 图谱数据模型定义
- 实体和关系提取
- 图谱构建和优化
- 社区检测
- 质量评估
"""

# 数据模型
from .models import (
    EntityType,
    RelationType,
    NodeLevel,
    Entity,
    Relationship,
    GraphQualityMetrics,
    GraphQualityReport,
    KnowledgeGraph
)

# 文档模型
from ..document import Document, DocumentMetadata

# Note: Traditional extractors removed - using SPO extraction only

# 验证器
from .validators import GraphQualityValidator

# 社区检测
from .community import CommunityDetector

# 优化器
from .optimizer import GraphOptimizer

# 构建器
from .builder import KnowledgeGraphBuilder

__all__ = [
    # 数据模型
    'EntityType',
    'RelationType',
    'NodeLevel',
    'Entity',
    'Relationship',
    'GraphQualityMetrics',
    'GraphQualityReport',
    'KnowledgeGraph',
    
    # 文档模型
    'Document',
    'DocumentMetadata',
    
    # Note: Traditional extractors removed
    
    # 验证器
    'GraphQualityValidator',
    
    # 社区检测
    'CommunityDetector',
    
    # 优化器
    'GraphOptimizer',
    
    # 构建器
    'KnowledgeGraphBuilder',

    # Neo4j is optional and must not be imported during package init.
    'NEO4J_AVAILABLE',
    'Neo4jExporter',
    'Neo4jExporterContext',
]


def __getattr__(name: str):
    if name == "NEO4J_AVAILABLE":
        try:
            from . import neo4j_exporter
        except ImportError:
            return False
        return bool(getattr(neo4j_exporter, "NEO4J_AVAILABLE", False))
    if name in {"Neo4jExporter", "Neo4jExporterContext"}:
        from .neo4j_exporter import Neo4jExporter, Neo4jExporterContext

        return Neo4jExporter if name == "Neo4jExporter" else Neo4jExporterContext
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
