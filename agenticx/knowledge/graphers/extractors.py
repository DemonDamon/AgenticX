"""Entity and Relationship Extractors for Knowledge Graph"""

import json
import re
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Set, Union
from loguru import logger

from .models import Entity, EntityType, Relationship, RelationType


class BaseExtractor(ABC):
    """Base class for extractors"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
    
    @abstractmethod
    def extract(self, text: str, **kwargs) -> List[Any]:
        """Extract items from text"""
        pass
    
    def clean_llm_response(self, response: str) -> str:
        """Clean LLM response by removing markdown and extra formatting"""
        # Remove markdown code blocks
        response = re.sub(r'```json\n(.*?)\n```', r'\1', response, flags=re.DOTALL)
        response = re.sub(r'```\n(.*?)\n```', r'\1', response, flags=re.DOTALL)
        
        # Remove markdown formatting
        response = re.sub(r'\*\*(.*?)\*\*', r'\1', response)  # Bold
        response = re.sub(r'\*(.*?)\*', r'\1', response)      # Italic
        response = re.sub(r'`(.*?)`', r'\1', response)          # Code
        
        # Clean up whitespace
        response = response.strip()
        
        return response


class EntityExtractor(BaseExtractor):
    """Extract entities from text using various methods"""
    
    def __init__(self, method: str = "llm", llm_client=None, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.method = method
        self.llm_client = llm_client
        
        # Default entity patterns for rule-based extraction
        self.entity_patterns = {
            EntityType.PERSON: [
                r'\b[A-Z][a-z]+ [A-Z][a-z]+\b',  # First Last
                r'\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?) [A-Z][a-z]+\b',  # Titles
            ],
            EntityType.ORGANIZATION: [
                r'\b[A-Z][A-Za-z]+ (?:Inc\.?|Corp\.?|Ltd\.?|Company|Corporation)\b',
                r'\b(?:Google|Microsoft|Apple|Amazon|Meta|OpenAI)\b',
            ],
            EntityType.LOCATION: [
                r'\b[A-Z][a-z]+ (?:City|State|Country|Region)\b',
                r'\b(?:USA|China|Japan|Europe|Asia)\b',
            ],
        }
    
    def extract(self, text: str, **kwargs) -> List[Entity]:
        """Extract entities from text"""
        logger.info(f"🔍 开始实体提取，方法: {self.method}")
        logger.debug(f"📝 文本长度: {len(text)} 字符")
        logger.debug(f"📄 文本预览: {text[:100]}..." if len(text) > 100 else f"📄 文本内容: {text}")
        
        if self.method == "llm":
            entities = self._extract_with_llm(text, **kwargs)
        elif self.method == "rule":
            entities = self._extract_with_rules(text, **kwargs)
        else:
            raise ValueError(f"Unknown extraction method: {self.method}")
        
        logger.success(f"✅ 实体提取完成，共提取到 {len(entities)} 个实体")
        for i, entity in enumerate(entities):
            logger.debug(f"  📍 实体[{i}]: {entity.name} ({entity.entity_type})")
        
        return entities
    
    def _extract_with_llm(self, text: str, **kwargs) -> List[Entity]:
        """Extract entities using LLM"""
        logger.debug("🤖 使用LLM进行实体提取")
        if not self.llm_client:
            raise ValueError("LLM client is required for LLM-based extraction")
        
        # Build extraction prompt
        logger.debug("📝 构建实体提取提示词")
        prompt = self._build_entity_extraction_prompt(text, **kwargs)
        logger.trace(f"🔍 完整提示词: {prompt}")
        
        try:
            # Call LLM
            logger.debug("🚀 调用LLM进行实体提取")
            response = self.llm_client.call(prompt)
            logger.debug(f"📥 LLM原始响应长度: {len(response)} 字符")
            logger.trace(f"🔍 LLM原始响应: {response}")
            
            # Clean response
            logger.debug("🧹 清理LLM响应")
            cleaned_response = self.clean_llm_response(response)
            logger.debug(f"✨ 清理后响应长度: {len(cleaned_response)} 字符")
            logger.trace(f"🔍 清理后响应: {cleaned_response}")
            
            # Parse JSON response
            logger.debug("📊 解析JSON响应")
            entities_data = json.loads(cleaned_response)
            logger.debug(f"📋 解析到 {len(entities_data)} 个实体数据")
            
            # Convert to Entity objects
            entities = []
            for entity_data in entities_data:
                try:
                    entity = Entity(
                        name=entity_data["name"],
                        entity_type=EntityType(entity_data.get("type", "unknown")),
                        description=entity_data.get("description"),
                        attributes=entity_data.get("attributes", {}),
                        confidence=entity_data.get("confidence", 0.8)
                    )
                    entities.append(entity)
                except (KeyError, ValueError) as e:
                    # Skip invalid entities
                    continue
            
            return entities
            
        except (json.JSONDecodeError, KeyError) as e:
            # Fallback to rule-based extraction if LLM fails
            return self._extract_with_rules(text, **kwargs)
    
    def _extract_with_rules(self, text: str, **kwargs) -> List[Entity]:
        """Extract entities using rule-based patterns"""
        entities = []
        
        for entity_type, patterns in self.entity_patterns.items():
            for pattern in patterns:
                matches = re.findall(pattern, text)
                for match in matches:
                    # Avoid duplicates
                    if not any(e.name == match for e in entities):
                        entity = Entity(
                            name=match,
                            entity_type=entity_type,
                            confidence=0.7  # Lower confidence for rule-based
                        )
                        entities.append(entity)
        
        return entities
    
    def _build_entity_extraction_prompt(self, text: str, **kwargs) -> str:
        """Build prompt for entity extraction"""
        entity_types = kwargs.get("entity_types", [
            "person", "organization", "location", "event", "concept", "object", "time"
        ])
        
        prompt = f"""
Extract entities from the following text. Return a JSON array of entities.

Text: {text}

Extract these types of entities: {', '.join(entity_types)}

For each entity, provide:
- name: the entity name
- type: the entity type from the list above
- description: brief description (optional)
- attributes: any relevant attributes (optional)
- confidence: confidence score 0-1

Return format:
[
  {{
    "name": "Entity Name",
    "type": "person",
    "description": "Brief description",
    "attributes": {{"key": "value"}},
    "confidence": 0.9
  }}
]

Only return the JSON array, no additional text.
"""
        return prompt.strip()
    
    def deduplicate_entities(self, entities: List[Entity]) -> List[Entity]:
        """Remove duplicate entities based on name similarity"""
        unique_entities = []
        seen_names = set()
        
        for entity in entities:
            # Simple deduplication based on exact name match
            if entity.name.lower() not in seen_names:
                unique_entities.append(entity)
                seen_names.add(entity.name.lower())
        
        return unique_entities


class RelationshipExtractor(BaseExtractor):
    """Extract relationships between entities"""
    
    def __init__(self, method: str = "llm", llm_client=None, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.method = method
        self.llm_client = llm_client
        
        # Default relationship patterns for rule-based extraction
        self.relationship_patterns = {
            RelationType.WORKS_FOR: [
                r'(\w+) works for (\w+)',
                r'(\w+) is employed by (\w+)',
            ],
            RelationType.KNOWS: [
                r'(\w+) knows (\w+)',
                r'(\w+) is friends with (\w+)',
            ],
            RelationType.LOCATED_IN: [
                r'(\w+) is located in (\w+)',
                r'(\w+) is in (\w+)',
            ],
        }
    
    def extract(self, text: str, entities: List[Entity], **kwargs) -> List[Relationship]:
        """Extract relationships from text given a list of entities"""
        logger.info(f"🔗 开始关系提取，方法: {self.method}")
        logger.debug(f"📝 文本长度: {len(text)} 字符")
        logger.debug(f"👥 输入实体数量: {len(entities)}")
        for i, entity in enumerate(entities):
            logger.debug(f"  📍 实体[{i}]: {entity.name} ({entity.entity_type})")
        
        if self.method == "llm":
            relationships = self._extract_with_llm(text, entities, **kwargs)
        elif self.method == "rule":
            relationships = self._extract_with_rules(text, entities, **kwargs)
        else:
            raise ValueError(f"Unknown extraction method: {self.method}")
        
        logger.success(f"✅ 关系提取完成，共提取到 {len(relationships)} 个关系")
        for i, rel in enumerate(relationships):
            logger.debug(f"  🔗 关系[{i}]: {rel.source_entity_id} --[{rel.relation_type}]--> {rel.target_entity_id}")
        
        return relationships
    
    def _extract_with_llm(self, text: str, entities: List[Entity], **kwargs) -> List[Relationship]:
        """Extract relationships using LLM"""
        if not self.llm_client:
            raise ValueError("LLM client is required for LLM-based extraction")
        
        # Build extraction prompt
        prompt = self._build_relationship_extraction_prompt(text, entities, **kwargs)
        
        try:
            # Call LLM
            response = self.llm_client.call(prompt)
            
            # Clean response
            cleaned_response = self.clean_llm_response(response)
            
            # Parse JSON response
            relationships_data = json.loads(cleaned_response)
            
            # Convert to Relationship objects
            relationships = []
            for rel_data in relationships_data:
                try:
                    relationship = Relationship(
                        source_entity_id=rel_data["source_id"],
                        target_entity_id=rel_data["target_id"],
                        relation_type=RelationType(rel_data.get("type", "related_to")),
                        description=rel_data.get("description"),
                        attributes=rel_data.get("attributes", {}),
                        confidence=rel_data.get("confidence", 0.8)
                    )
                    relationships.append(relationship)
                except (KeyError, ValueError) as e:
                    # Skip invalid relationships
                    continue
            
            return relationships
            
        except (json.JSONDecodeError, KeyError) as e:
            # Fallback to rule-based extraction if LLM fails
            return self._extract_with_rules(text, entities, **kwargs)
    
    def _extract_with_rules(self, text: str, entities: List[Entity], **kwargs) -> List[Relationship]:
        """Extract relationships using rule-based patterns"""
        relationships = []
        entity_map = {entity.name: entity for entity in entities}
        
        for relation_type, patterns in self.relationship_patterns.items():
            for pattern in patterns:
                matches = re.findall(pattern, text)
                for match in matches:
                    if len(match) >= 2:
                        source_name, target_name = match[0], match[1]
                        
                        # Check if both entities exist
                        if source_name in entity_map and target_name in entity_map:
                            source_entity = entity_map[source_name]
                            target_entity = entity_map[target_name]
                            
                            relationship = Relationship(
                                source_entity_id=source_entity.id,
                                target_entity_id=target_entity.id,
                                relation_type=relation_type,
                                confidence=0.7  # Lower confidence for rule-based
                            )
                            relationships.append(relationship)
        
        return relationships
    
    def _build_relationship_extraction_prompt(self, text: str, entities: List[Entity], **kwargs) -> str:
        """Build prompt for relationship extraction"""
        entity_list = [
            f"- {entity.name} ({entity.entity_type.value})" 
            for entity in entities
        ]
        
        relation_types = kwargs.get("relation_types", [
            "works_for", "knows", "located_in", "related_to", "part_of", "is_a"
        ])
        
        prompt = f"""
Extract relationships between the following entities from the text.
Return a JSON array of relationships.

Entities:
{chr(10).join(entity_list)}

Text: {text}

Extract these types of relationships: {', '.join(relation_types)}

For each relationship, provide:
- source_id: ID of the source entity
- target_id: ID of the target entity  
- type: relationship type from the list above
- description: brief description (optional)
- attributes: any relevant attributes (optional)
- confidence: confidence score 0-1

Return format:
[
  {{
    "source_id": "entity_id_1",
    "target_id": "entity_id_2", 
    "type": "works_for",
    "description": "Brief description",
    "attributes": {{"key": "value"}},
    "confidence": 0.8
  }}
]

Only return the JSON array, no additional text.
"""
        return prompt.strip()
    
    def deduplicate_relationships(self, relationships: List[Relationship]) -> List[Relationship]:
        """Remove duplicate relationships"""
        unique_relationships = []
        seen_pairs = set()
        
        for relationship in relationships:
            # Create a unique key for the relationship
            pair_key = (
                relationship.source_entity_id,
                relationship.target_entity_id,
                str(relationship.relation_type)
            )
            
            if pair_key not in seen_pairs:
                unique_relationships.append(relationship)
                seen_pairs.add(pair_key)
        
        return unique_relationships