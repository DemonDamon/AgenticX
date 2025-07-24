"""AgenticX-based knowledge extraction task

This module implements KnowledgeExtractionTask, responsible for extracting structured knowledge from search results,
strictly following the AgenticX framework's Task abstraction.
"""

from typing import List, Dict, Any, Optional
from pydantic import Field
from agenticx.core.task import Task
from agenticx.core.message import Message
from models import SearchResult, KnowledgeItem


class KnowledgeExtractionTask(Task):
    """Knowledge extraction task
    
    Based on agenticx.core.Task implementation, responsible for:
    1. Extracting structured knowledge from search results
    2. Identifying key concepts and relationships
    3. Building knowledge graphs
    4. Generating knowledge summaries
    """
    
    llm_provider: Optional[Any] = Field(default=None, description="LLM provider")
    
    def __init__(self, description: str, expected_output: str, llm_provider=None, **kwargs):
        super().__init__(description=description, expected_output=expected_output, llm_provider=llm_provider, **kwargs)
    
    def _detect_language(self, text: str) -> str:
        """Detect input text language"""
        chinese_chars = sum(1 for char in text if '\u4e00' <= char <= '\u9fff')
        total_chars = len([char for char in text if char.isalpha()])
        
        if total_chars == 0:
            return "en"  # Default to English
        
        chinese_ratio = chinese_chars / total_chars if total_chars > 0 else 0
        
        if chinese_ratio > 0.3:  # More than 30% Chinese characters
            return "zh"
        else:
            return "en"
    
    async def execute(self, **kwargs) -> Dict[str, Any]:
        """Execute knowledge extraction task"""
        action = kwargs.get("action", "extract_knowledge")
        
        if action == "extract_knowledge":
            return await self._extract_knowledge(kwargs)
        elif action == "extract_facts":
            return await self._extract_facts(kwargs)
        elif action == "extract_concepts":
            return await self._extract_concepts(kwargs)
        elif action == "build_knowledge_graph":
            return await self._build_knowledge_graph(kwargs)
        else:
            raise ValueError(f"Unsupported operation: {action}")
    
    async def _extract_knowledge(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Extract knowledge"""
        search_results = kwargs.get("search_results", [])
        research_topic = kwargs.get("research_topic", "")
        
        if not search_results:
            return {"knowledge_items": [], "summary": "No search results to extract knowledge from"}
        
        knowledge_items = []
        
        for result in search_results:
            items = await self._extract_knowledge_from_result(result, research_topic)
            knowledge_items.extend(items)
        
        # Deduplication and organization
        unique_items = self._deduplicate_knowledge_items(knowledge_items)
        
        # Generate knowledge summary
        summary = await self._generate_knowledge_summary(unique_items, research_topic)
        
        return {
            "knowledge_items": unique_items,
            "summary": summary,
            "total_extracted": len(unique_items)
        }
    
    async def _extract_knowledge_from_result(self, result: SearchResult, research_topic: str) -> List[Dict[str, Any]]:
        """Extract knowledge from a single search result"""
        if not self.llm_provider:
            # Simple knowledge extraction logic
            return self._extract_simple_knowledge(result, research_topic)
        
        # Detect language based on research topic
        detected_language = self._detect_language(research_topic)
        
        # Use LLM for deep knowledge extraction with dynamic language support
        if detected_language == "zh":
            prompt = f"""
请从以下内容中提取与研究主题"{research_topic}"相关的结构化知识：

标题: {result.title}
内容: {result.content[:1500] if result.content else result.snippet}

请提取以下类型的知识：
1. 关键事实和数据
2. 重要概念和定义
3. 因果关系
4. 时间线信息
5. 专家观点

请以JSON格式返回，每个知识项包含：
- type: 知识类型（fact/concept/relationship/timeline/opinion）
- content: 知识内容
- confidence: 置信度（1-10）
- source: 来源信息
"""
        else:
            prompt = f"""
Please extract structured knowledge related to the research topic "{research_topic}" from the following content:

Title: {result.title}
Content: {result.content[:1500] if result.content else result.snippet}

Please extract the following types of knowledge:
1. Key facts and data
2. Important concepts and definitions
3. Cause-effect relationships
4. Timeline information
5. Expert opinions

Please return in JSON format, each knowledge item includes:
- type: Knowledge type (fact/concept/relationship/timeline/opinion)
- content: Knowledge content
- confidence: Confidence level (1-10)
- source: Source information
"""
        
        message = Message(content=prompt, sender=self.name)
        response = await self.llm_provider.generate(message.content)
        
        try:
            import json
            knowledge_data = json.loads(response)
            return knowledge_data.get("knowledge_items", [])
        except:
            # If parsing fails, return simple extraction result
            return self._extract_simple_knowledge(result, research_topic)
    
    def _extract_simple_knowledge(self, result: SearchResult, research_topic: str) -> List[Dict[str, Any]]:
        """Simple knowledge extraction"""
        knowledge_items = []
        content = result.content or result.snippet or ""
        
        # Detect language based on research topic
        detected_language = self._detect_language(research_topic)
        
        # Extract numerical facts
        import re
        numbers = re.findall(r'\d+(?:\.\d+)?(?:%|万|亿|千|百)?', content)
        for num in numbers[:3]:  # Limit quantity
            if detected_language == "zh":
                content_text = f"数值: {num}"
            else:
                content_text = f"Numerical value: {num}"
            
            knowledge_items.append({
                "type": "fact",
                "content": content_text,
                "confidence": 6,
                "source": result.url
            })
        
        # Extract key phrases
        sentences = content.split('。')[:2]
        for sentence in sentences:
            if len(sentence.strip()) > 10:
                knowledge_items.append({
                    "type": "concept",
                    "content": sentence.strip(),
                    "confidence": 5,
                    "source": result.url
                })
        
        return knowledge_items
    
    async def _extract_facts(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Extract fact information"""
        content = kwargs.get("content", "")
        research_topic = kwargs.get("research_topic", "")
        
        # Detect language based on research topic
        detected_language = self._detect_language(research_topic)
        
        if not content:
            if detected_language == "zh":
                return {"facts": [], "count": 0, "message": "无内容可提取事实"}
            else:
                return {"facts": [], "count": 0, "message": "No content to extract facts from"}
        
        facts = self._extract_simple_facts(content)
        
        return {
            "facts": facts,
            "count": len(facts)
        }
    
    async def _extract_concepts(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Extract concept information"""
        content = kwargs.get("content", "")
        research_topic = kwargs.get("research_topic", "")
        
        # Detect language based on research topic
        detected_language = self._detect_language(research_topic)
        
        if not content:
            if detected_language == "zh":
                return {"concepts": [], "count": 0, "message": "无内容可提取概念"}
            else:
                return {"concepts": [], "count": 0, "message": "No content to extract concepts from"}
        
        concepts = self._extract_simple_concepts(content)
        
        return {
            "concepts": concepts,
            "count": len(concepts)
        }
    
    async def _build_knowledge_graph(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Build knowledge graph"""
        knowledge_items = kwargs.get("knowledge_items", [])
        research_topic = kwargs.get("research_topic", "")
        
        # Detect language based on research topic
        detected_language = self._detect_language(research_topic)
        
        if not knowledge_items:
            if detected_language == "zh":
                return {"nodes": [], "edges": [], "graph_summary": "无知识项可构建图谱"}
            else:
                return {"nodes": [], "edges": [], "graph_summary": "No knowledge items to build graph from"}
        
        # Simple knowledge graph construction
        nodes = []
        edges = []
        
        for i, item in enumerate(knowledge_items):
            nodes.append({
                "id": i,
                "label": item.get("content", "")[:50],
                "type": item.get("type", "unknown"),
                "confidence": item.get("confidence", 5)
            })
        
        # Simple relationship inference
        for i in range(len(nodes)):
            for j in range(i+1, min(i+3, len(nodes))):
                edges.append({
                    "source": i,
                    "target": j,
                    "relationship": "related_to",
                    "weight": 0.5
                })
        
        if detected_language == "zh":
            graph_summary = f"构建了包含{len(nodes)}个节点和{len(edges)}条边的知识图谱"
        else:
            graph_summary = f"Built a knowledge graph with {len(nodes)} nodes and {len(edges)} edges"
        
        return {
            "nodes": nodes,
            "edges": edges,
            "graph_summary": graph_summary
        }
    
    def _extract_simple_facts(self, content: str) -> List[Dict[str, Any]]:
        """Simple fact extraction"""
        import re
        facts = []
        
        # Extract sentences containing numbers as facts
        sentences = content.split('。')
        for sentence in sentences:
            if re.search(r'\d+', sentence) and len(sentence.strip()) > 10:
                facts.append({
                    "content": sentence.strip(),
                    "type": "numerical_fact",
                    "confidence": 7
                })
        
        return facts[:5]  # Limit quantity
    
    def _extract_simple_concepts(self, content: str) -> List[Dict[str, Any]]:
        """Simple concept extraction"""
        import re
        concepts = []
        
        # Extract possible concepts (noun phrases)
        # Simple pattern: uppercase letter followed by lowercase letters
        concept_pattern = r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*'
        matches = re.findall(concept_pattern, content)
        
        for match in matches[:5]:  # Limit quantity
            concepts.append({
                "content": match,
                "type": "concept",
                "confidence": 6
            })
        
        return concepts
    
    def _deduplicate_knowledge_items(self, knowledge_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Deduplicate knowledge items"""
        seen_content = set()
        unique_items = []
        
        for item in knowledge_items:
            content = item.get("content", "")
            if content and content not in seen_content:
                seen_content.add(content)
                unique_items.append(item)
        
        return unique_items
    
    async def _generate_knowledge_summary(self, knowledge_items: List[Dict[str, Any]], research_topic: str) -> str:
        """Generate knowledge summary"""
        if not knowledge_items:
            # Detect language based on research topic
            detected_language = self._detect_language(research_topic)
            if detected_language == "zh":
                return "未提取到相关知识"
            else:
                return "No relevant knowledge extracted"
        
        # Detect language based on research topic
        detected_language = self._detect_language(research_topic)
        
        total_items = len(knowledge_items)
        types = {}
        
        for item in knowledge_items:
            item_type = item.get("type", "unknown")
            types[item_type] = types.get(item_type, 0) + 1
        
        if detected_language == "zh":
            type_summary = ", ".join([f"{k}: {v}个" for k, v in types.items()])
            return f"从研究主题'{research_topic}'中提取了{total_items}个知识项，包括{type_summary}。"
        else:
            type_summary = ", ".join([f"{k}: {v}" for k, v in types.items()])
            return f"Extracted {total_items} knowledge items from research topic '{research_topic}', including {type_summary}."