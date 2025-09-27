"""Configuration classes for knowledge graphers."""
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class LLMConfig:
    """Configuration for the Language Model Client."""
    type: str = "static"
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    provider: Optional[str] = None  # e.g., 'litellm', 'openai'
    timeout: Optional[float] = None
    max_retries: Optional[int] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'LLMConfig':
        valid_keys = {f.name for f in cls.__dataclass_fields__.values()}
        filtered_data = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**filtered_data)


@dataclass
class GraphRagPrompts:
    """Prompts for the GraphRAG constructor."""
    general: str = "You are an expert information extractor..."
    # Add other prompts as needed from youtu-graphrag config

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'GraphRagPrompts':
        valid_keys = {f.name for f in cls.__dataclass_fields__.values()}
        filtered_data = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**filtered_data)


@dataclass
class EntityExtractionConfig:
    """Configuration for entity extraction."""
    extraction_method: str = "llm"
    max_entities_per_chunk: int = 20
    entity_types: List[str] = field(default_factory=lambda: ["PERSON", "ORGANIZATION", "LOCATION", "CONCEPT", "EVENT", "TECHNOLOGY", "PRODUCT"])
    confidence_threshold: float = 0.7
    enable_coreference_resolution: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'EntityExtractionConfig':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class RelationshipExtractionConfig:
    """Configuration for relationship extraction."""
    extraction_method: str = "llm"
    max_relationships_per_chunk: int = 30
    relationship_types: List[str] = field(default_factory=lambda: ["RELATED_TO", "PART_OF", "LOCATED_IN", "WORKS_FOR", "CREATED_BY", "INFLUENCES", "DEPENDS_ON"])
    confidence_threshold: float = 0.6
    enable_bidirectional: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'RelationshipExtractionConfig':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class QualityValidationConfig:
    """Configuration for graph quality validation."""
    min_entity_confidence: float = 0.5
    min_relationship_confidence: float = 0.4
    max_orphaned_entities_ratio: float = 0.1
    enable_consistency_check: bool = True
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'QualityValidationConfig':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class CommunityDetectionConfig:
    """Configuration for community detection."""
    algorithm: str = "leiden"  # leiden, louvain, label_propagation
    resolution: float = 1.0
    max_communities: int = 100
    min_community_size: int = 3
    enable_hierarchical: bool = True
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'CommunityDetectionConfig':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class GraphOptimizationConfig:
    """Configuration for graph optimization."""
    enable_entity_merging: bool = True
    entity_similarity_threshold: float = 0.9
    enable_relationship_pruning: bool = True
    relationship_weight_threshold: float = 0.3
    enable_noise_reduction: bool = True
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'GraphOptimizationConfig':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class Neo4jConfig:
    """Configuration for Neo4j database connection and export."""
    enabled: bool = False
    uri: str = "bolt://localhost:7687"
    username: str = "neo4j"
    password: str = "password"
    database: str = "neo4j"
    auto_export: bool = False  # Whether to automatically export after graph construction
    clear_on_export: bool = True  # Whether to clear existing data before export
    create_indexes: bool = True  # Whether to create performance indexes
    batch_size: int = 1000  # Batch size for large graph exports
    timeout: int = 30  # Connection timeout in seconds
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Neo4jConfig':
        valid_keys = {f.name for f in cls.__dataclass_fields__.values()}
        filtered_data = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**filtered_data)


@dataclass
class GraphRagConfig:
    """Configuration for the GraphRAG constructor."""
    chunk_size: int = 1000
    chunk_overlap: int = 200
    extraction_method: str = "separate"  # "spo" (两阶段抽取) 或 "separate" (分离抽取)
    schema_path: str = "schema.json"  # 基础Schema文件路径
    enable_custom_schema: bool = True  # 启用定制Schema生成
    prompts_dir: str = "prompts"  # 提示词文件夹路径
    spo_batch_size: int = 5  # SPO批处理大小
    prompts: GraphRagPrompts = field(default_factory=GraphRagPrompts)
    entity_extraction: EntityExtractionConfig = field(default_factory=EntityExtractionConfig)
    relationship_extraction: RelationshipExtractionConfig = field(default_factory=RelationshipExtractionConfig)
    quality_validation: QualityValidationConfig = field(default_factory=QualityValidationConfig)
    community_detection: CommunityDetectionConfig = field(default_factory=CommunityDetectionConfig)
    graph_optimization: GraphOptimizationConfig = field(default_factory=GraphOptimizationConfig)
    neo4j: Neo4jConfig = field(default_factory=Neo4jConfig)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'GraphRagConfig':
        prompts_data = data.get('prompts', {})
        entity_extraction_data = data.get('entity_extraction', {})
        relationship_extraction_data = data.get('relationship_extraction', {})
        quality_validation_data = data.get('quality_validation', {})
        community_detection_data = data.get('community_detection', {})
        graph_optimization_data = data.get('graph_optimization', {})
        neo4j_data = data.get('neo4j', {})
        return cls(
            chunk_size=data.get('chunk_size', 1000),
            chunk_overlap=data.get('chunk_overlap', 200),
            extraction_method=data.get('extraction_method', 'separate'),
            schema_path=data.get('schema_path', 'schema.json'),
            enable_custom_schema=data.get('enable_custom_schema', True),
            prompts_dir=data.get('prompts_dir', 'prompts'),
            spo_batch_size=data.get('spo_batch_size', 5),  # 添加spo_batch_size参数处理
            prompts=GraphRagPrompts.from_dict(prompts_data),
            entity_extraction=EntityExtractionConfig.from_dict(entity_extraction_data),
            relationship_extraction=RelationshipExtractionConfig.from_dict(relationship_extraction_data),
            quality_validation=QualityValidationConfig.from_dict(quality_validation_data),
            community_detection=CommunityDetectionConfig.from_dict(community_detection_data),
            graph_optimization=GraphOptimizationConfig.from_dict(graph_optimization_data),
            neo4j=Neo4jConfig.from_dict(neo4j_data)
        )


@dataclass
class GrapherConfig:
    """Top-level configuration for graphers."""
    type: str = "graphrag"
    llm: LLMConfig = field(default_factory=LLMConfig)
    graphrag: GraphRagConfig = field(default_factory=GraphRagConfig)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'GrapherConfig':
        # Handle nested structure where config is under 'grapher' key
        if 'grapher' in data:
            grapher_data = data['grapher']
            llm_data = grapher_data.get('llm', {})
            graphrag_data = grapher_data.get('graphrag', {})
            config_type = grapher_data.get('type', 'graphrag')
        else:
            llm_data = data.get('llm', {})
            graphrag_data = data.get('graphrag', {})
            config_type = data.get('type', 'graphrag')
        
        return cls(
            type=config_type,
            llm=LLMConfig.from_dict(llm_data),
            graphrag=GraphRagConfig.from_dict(graphrag_data)
        )