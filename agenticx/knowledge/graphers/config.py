"""Configuration classes for knowledge graphers."""
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Optional


@dataclass
class LLMConfig:
    """Configuration for the Language Model Client."""
    type: str = "static"
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    provider: Optional[str] = None  # e.g., 'litellm', 'openai'

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
    # Add other entity extraction specific configs

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'EntityExtractionConfig':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class RelationshipExtractionConfig:
    """Configuration for relationship extraction."""
    extraction_method: str = "llm"
    # Add other relationship extraction specific configs

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'RelationshipExtractionConfig':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class QualityValidationConfig:
    """Configuration for graph quality validation."""
    # Add quality validation specific configs
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'QualityValidationConfig':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class CommunityDetectionConfig:
    """Configuration for community detection."""
    # Add community detection specific configs
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'CommunityDetectionConfig':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class GraphOptimizationConfig:
    """Configuration for graph optimization."""
    # Add graph optimization specific configs
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'GraphOptimizationConfig':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class GraphRagConfig:
    """Configuration for the GraphRAG constructor."""
    chunk_size: int = 1000
    chunk_overlap: int = 200
    prompts: GraphRagPrompts = field(default_factory=GraphRagPrompts)
    entity_extraction: EntityExtractionConfig = field(default_factory=EntityExtractionConfig)
    relationship_extraction: RelationshipExtractionConfig = field(default_factory=RelationshipExtractionConfig)
    quality_validation: QualityValidationConfig = field(default_factory=QualityValidationConfig)
    community_detection: CommunityDetectionConfig = field(default_factory=CommunityDetectionConfig)
    graph_optimization: GraphOptimizationConfig = field(default_factory=GraphOptimizationConfig)

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
        return cls(
            chunk_size=data.get('chunk_size', 1000),
            chunk_overlap=data.get('chunk_overlap', 200),
            prompts=GraphRagPrompts.from_dict(prompts_data),
            entity_extraction=EntityExtractionConfig.from_dict(entity_extraction_data),
            relationship_extraction=RelationshipExtractionConfig.from_dict(relationship_extraction_data),
            quality_validation=QualityValidationConfig.from_dict(quality_validation_data),
            community_detection=CommunityDetectionConfig.from_dict(community_detection_data),
            graph_optimization=GraphOptimizationConfig.from_dict(graph_optimization_data)
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