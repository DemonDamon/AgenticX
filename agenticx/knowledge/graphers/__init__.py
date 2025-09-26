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

# 提取器
from .extractors import (
    BaseExtractor,
    EntityExtractor,
    RelationshipExtractor
)

# 验证器
from .validators import GraphQualityValidator

# 社区检测
from .community import CommunityDetector

# 优化器
from .optimizer import GraphOptimizer

# 构建器
from .builder import KnowledgeGraphBuilder
from .graphrag_constructor import GraphRAGConstructor

# Neo4j导出器
try:
    from .neo4j_exporter import Neo4jExporter, Neo4jExporterContext
    NEO4J_AVAILABLE = True
except ImportError:
    NEO4J_AVAILABLE = False

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
    
    # 提取器
    'BaseExtractor',
    'EntityExtractor',
    'RelationshipExtractor',
    
    # 验证器
    'GraphQualityValidator',
    
    # 社区检测
    'CommunityDetector',
    
    # 优化器
    'GraphOptimizer',
    
    # 构建器
    'KnowledgeGraphBuilder',
    'GraphRAGConstructor',
    
    # Neo4j支持
    'NEO4J_AVAILABLE'
]

# 条件导出Neo4j功能
if NEO4J_AVAILABLE:
    __all__.extend(['Neo4jExporter', 'Neo4jExporterContext'])