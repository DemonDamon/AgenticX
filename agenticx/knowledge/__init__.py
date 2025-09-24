"""AgenticX Knowledge Management System

A comprehensive knowledge management framework that provides:
- Unified knowledge base interface
- Multiple chunking strategies
- Rich document readers
- Vector database integrations
- Intelligent knowledge tools
- Advanced document processing with multi-backend support
- Content extraction and structural analysis
- Flexible configuration management

Inspired by Agno's knowledge architecture but designed for AgenticX's
modular and enterprise-ready framework.
"""

from .base import (
    BaseKnowledge,
    BaseChunker,
    BaseReader,
    KnowledgeError,
    ChunkingError,
    ReaderError,
)
from .document import Document, DocumentMetadata, ChunkMetadata
from .knowledge import Knowledge
from .processing import (
    DocumentProcessor,
    ProcessingResult,
    ProcessingBackend,
    ComplexityLevel,
    BaseProcessingBackend,
    SimpleTextBackend,
    StructuredBackend,
    VLMLayoutBackend,
    ProcessingMetrics,
)
from .extractor import (
    ContentExtractor,
    ContentType,
    StructuralElement,
    StructuralElementType,
    ExtractionResult,
    BaseContentExtractor,
    TextContentExtractor,
    MarkdownContentExtractor,
)
from .config import (
    ProcessingConfiguration,
    ProcessingOptions,
    BackendConfig,
    FeatureFlags,
    ReaderConfig,
    ConfigurationManager,
    ConfigFormat,
    ConfigurationError,
)
from .chunkers import (
    # Framework classes
    ChunkingFramework,
    ChunkingOptimizer,
    ChunkingStrategy,
    ChunkQuality,
    ChunkMetrics,
    ChunkingResult,
    AdvancedBaseChunker,
    get_chunking_framework,
    # Chunker implementations
    SemanticChunker,
    AgenticChunker,
    RecursiveChunker,
    FixedSizeChunker,
    DocumentChunker,
    CSVRowChunker,
    # Functions
    get_chunker,
    register_chunker,
    create_chunking_optimizer,
    create_chunking_config,
)
from .graphers import (
    # Data models
    Entity,
    Relationship,
    KnowledgeGraph,
    EntityType,
    RelationType,
    NodeLevel,
    # Quality assessment
    GraphQualityMetrics,
    GraphQualityReport,
    # Core builders
    KnowledgeGraphBuilder,
    EntityExtractor,
    RelationshipExtractor,
    GraphQualityValidator,
    # Advanced constructors
    GraphRAGConstructor,
    CommunityDetector,
    GraphOptimizer,
)

__all__ = [
    # Base classes
    "BaseKnowledge",
    "BaseChunker", 
    "BaseReader",
    
    # Core classes
    "Knowledge",
    "Document",
    "DocumentMetadata",
    "ChunkMetadata",
    
    # Document Processing
    "DocumentProcessor",
    "ProcessingResult",
    "ProcessingBackend",
    "ComplexityLevel",
    "BaseProcessingBackend",
    "SimpleTextBackend",
    "StructuredBackend", 
    "VLMLayoutBackend",
    "ProcessingMetrics",
    
    # Content Extraction
    "ContentExtractor",
    "ContentType",
    "StructuralElement",
    "StructuralElementType",
    "ExtractionResult",
    "BaseContentExtractor",
    "TextContentExtractor",
    "MarkdownContentExtractor",
    
    # Configuration Management
    "ProcessingConfiguration",
    "ProcessingOptions",
    "BackendConfig",
    "FeatureFlags",
    "ReaderConfig",
    "ConfigurationManager",
    "ConfigFormat",
    
    # Intelligent Chunking Framework
    "ChunkingFramework",
    "ChunkingOptimizer",
    "ChunkingStrategy",
    "ChunkQuality",
    "ChunkMetrics",
    "ChunkingResult",
    "AdvancedBaseChunker",
    "get_chunking_framework",
    
    # Intelligent Chunkers
    "SemanticChunker",
    "AgenticChunker",
    "RecursiveChunker",
    "FixedSizeChunker",
    "DocumentChunker",
    "CSVRowChunker",
    "get_chunker",
    "register_chunker",
    "create_chunking_optimizer",
    "create_chunking_config",
    
    # Knowledge Graph Data Models
    "Entity",
    "Relationship",
    "KnowledgeGraph",
    "EntityType",
    "RelationType",
    "NodeLevel",
    "GraphQualityMetrics",
    "GraphQualityReport",
    
    # Knowledge Graph Builders
    "KnowledgeGraphBuilder",
    "EntityExtractor",
    "RelationshipExtractor",
    "GraphQualityValidator",
    
    # Advanced GraphRAG Constructors
    "GraphRAGConstructor",
    "CommunityDetector",
    "GraphOptimizer",
    
    # Exceptions
    "KnowledgeError",
    "ChunkingError",
    "ReaderError",
    "ConfigurationError",
]