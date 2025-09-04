"""AgenticX-based Query Generation Agent

This module implements QueryGeneratorAgent, responsible for generating high-quality search queries,
strictly following the AgenticX framework's agent design patterns.
"""

from typing import Dict, List, Any, Optional, Set
import asyncio
from datetime import datetime
from dataclasses import dataclass, field
from enum import Enum
from pydantic import Field

from agenticx.core.agent import Agent, AgentContext, AgentResult
from agenticx.llms.base import BaseLLMProvider
from agenticx.core.prompt import PromptTemplate

from models import SearchQuery, QueryType, KnowledgeGap, ResearchContext, SearchEngine


class QueryStrategy(Enum):
    """Query Strategy"""
    BROAD_EXPLORATION = "broad_exploration"      # Broad exploration
    FOCUSED_DEEP_DIVE = "focused_deep_dive"      # Focused deep dive
    GAP_FILLING = "gap_filling"                  # Gap filling
    VERIFICATION = "verification"                # Verification
    COMPARATIVE = "comparative"                  # Comparative analysis
    TEMPORAL = "temporal"                        # Temporal dimension
    MULTI_PERSPECTIVE = "multi_perspective"      # Multi-perspective


class QueryComplexity(Enum):
    """Query Complexity"""
    SIMPLE = "simple"          # Simple query
    MODERATE = "moderate"      # Moderate complexity
    COMPLEX = "complex"        # Complex query
    EXPERT = "expert"          # Expert-level query


@dataclass
class QueryGenerationContext:
    """Query Generation Context"""
    research_topic: str
    research_objectives: List[str]
    iteration_number: int
    previous_queries: List[SearchQuery]
    knowledge_gaps: List[KnowledgeGap]
    accumulated_knowledge: Dict[str, Any]
    strategy: QueryStrategy
    target_complexity: QueryComplexity
    max_queries: int = 10
    language_preference: str = "zh-CN"
    domain_constraints: List[str] = field(default_factory=list)
    temporal_constraints: Dict[str, Any] = field(default_factory=dict)


@dataclass
class QueryAnalysis:
    """Query Analysis Results"""
    query_text: str
    estimated_relevance: float
    estimated_coverage: float
    complexity_score: float
    uniqueness_score: float
    expected_result_count: int
    search_engines_compatibility: Dict[str, bool]
    keywords: List[str]
    semantic_concepts: List[str]


class QueryGeneratorAgent(Agent):
    """Query Generation Agent
    
    Based on agenticx.core.agent.Agent implementation, providing:
    1. Intelligent query generation
    2. Multi-strategy query optimization
    3. Knowledge gap-oriented queries
    4. Query quality assessment
    5. Multi-language query support
    """
    
    # Additional field definitions
    query_templates: Dict[QueryStrategy, List[str]] = Field(default_factory=dict, description="Query templates")
    enhancement_terms: Dict[str, List[str]] = Field(default_factory=dict, description="Query enhancement terms")
    generated_queries: Set[str] = Field(default_factory=set, description="Generated queries cache")
    query_stats: Dict[str, Any] = Field(default_factory=dict, description="Query performance statistics")
    
    def __init__(self, name: str = "Query Generation Expert", role: str = "Expert Search Query Formulator", 
                 goal: str = "Generate high-quality, diverse search queries to support in-depth research and information collection",
                 organization_id: str = "deepsearch", **kwargs):
        super().__init__(
            name=name,
            role=role,
            goal=goal,
            organization_id=organization_id,
            backstory="You are an experienced search query expert, skilled at generating precise and diverse search queries based on research topics and context. You are well-versed in various search strategies and can identify knowledge gaps and formulate corresponding query plans.",
            **kwargs
        )
        
        # Query templates
        self.query_templates = {
            QueryStrategy.BROAD_EXPLORATION: [
                "{topic} overview",
                "{topic} basic concepts",
                "{topic} development history",
                "{topic} application areas",
                "{topic} latest developments"
            ],
            QueryStrategy.FOCUSED_DEEP_DIVE: [
                "{topic} detailed analysis",
                "{topic} technical principles",
                "{topic} implementation methods",
                "{topic} case studies",
                "{topic} expert opinions"
            ],
            QueryStrategy.GAP_FILLING: [
                "{topic} {gap_area}",
                "{gap_area} applications in {topic}",
                "{topic} {gap_area} solutions",
                "{gap_area} related research"
            ],
            QueryStrategy.VERIFICATION: [
                "{topic} verification methods",
                "{topic} reliability analysis",
                "{topic} comparative studies",
                "{topic} empirical research"
            ],
            QueryStrategy.COMPARATIVE: [
                "{topic} vs {alternative}",
                "{topic} comparative analysis",
                "{topic} advantages and disadvantages",
                "{topic} alternative solutions"
            ],
            QueryStrategy.TEMPORAL: [
                "{topic} 2024",
                "{topic} latest developments",
                "{topic} trend analysis",
                "{topic} future prospects"
            ],
            QueryStrategy.MULTI_PERSPECTIVE: [
                "{topic} technical perspective",
                "{topic} business perspective",
                "{topic} social impact",
                "{topic} policies and regulations"
            ]
        }
        
        # Query enhancement terms
        self.enhancement_terms = {
            "depth": ["in-depth", "detailed", "comprehensive", "systematic", "complete"],
            "quality": ["authoritative", "professional", "academic", "official", "reliable"],
            "recency": ["latest", "2024", "recent", "current", "newest"],
            "scope": ["global", "international", "domestic", "industry", "field"],
            "type": ["research", "report", "analysis", "review", "case"]
        }
        
        # Generated queries cache is already defined as class attribute with Field
        
        # Query performance statistics
        self.query_stats = {
            "total_generated": 0,
            "successful_queries": 0,
            "average_relevance": 0.0,
            "strategy_usage": {strategy: 0 for strategy in QueryStrategy}
        }
    
    async def generate_queries(self, research_topic: str, 
                             research_context: Dict[str, Any],
                             knowledge_gaps: List[KnowledgeGap],
                             iteration_number: int,
                             max_queries: int = 10) -> List[SearchQuery]:
        """Generate search queries"""
        
        # Detect language and set language preference
        detected_language = self._detect_language(research_topic)
        language_preference = "zh-CN" if detected_language == "zh" else "en-US"
        
        # Build query generation context
        generation_context = QueryGenerationContext(
            research_topic=research_topic,
            research_objectives=research_context.get("objectives", []),
            iteration_number=iteration_number,
            previous_queries=research_context.get("previous_queries", []),
            knowledge_gaps=knowledge_gaps,
            accumulated_knowledge=research_context,
            strategy=self._determine_query_strategy(iteration_number, knowledge_gaps),
            target_complexity=self._determine_target_complexity(iteration_number),
            max_queries=max_queries,
            language_preference=language_preference
        )
        
        # Generate queries
        queries = await self._generate_queries_by_strategy(generation_context)
        
        # Query optimization and deduplication
        optimized_queries = await self._optimize_queries(queries, generation_context)
        
        # Query quality evaluation
        evaluated_queries = await self._evaluate_queries(optimized_queries, generation_context)
        
        # Select best queries
        selected_queries = await self._select_best_queries(evaluated_queries, generation_context)
        
        # Update statistics
        self._update_query_stats(selected_queries, generation_context.strategy)
        
        return selected_queries
    
    def generate_initial_queries(self, research_topic: str, num_queries: int = 3) -> str:
        """Generate initial search query prompts (maintaining backward compatibility)"""
        detected_language = self._detect_language(research_topic)
        
        if detected_language == "zh":
            prompt = f"""
您是一位专业的搜索查询专家。请根据以下研究主题生成{num_queries}个高质量的搜索查询。

研究主题: {research_topic}

生成的查询应该：
1. 涵盖主题的不同方面
2. 使用不同的关键词组合
3. 包含具体和抽象的观点
4. 确保查询简洁且有针对性
5. **重要：生成的查询必须与研究主题使用相同的语言（如果主题是中文，查询也应该是中文；如果主题是英文，查询也应该是英文）**

请以JSON格式返回查询列表：
{{
    "queries": ["query1", "query2", "query3"]
}}
"""
        else:
            prompt = f"""
You are a professional search query expert. Please generate {num_queries} high-quality search queries based on the following research topic.

Research Topic: {research_topic}

The generated queries should:
1. Cover different aspects of the topic
2. Use different keyword combinations
3. Include both specific and abstract perspectives
4. Ensure queries are concise and targeted
5. **Important: Generated queries must use the same language as the research topic (if the topic is in Chinese, queries should also be in Chinese; if the topic is in English, queries should also be in English)**

Please return the query list in JSON format:
{{
    "queries": ["query1", "query2", "query3"]
}}
"""
        return prompt
    
    def _determine_query_strategy(self, iteration_number: int, 
                                knowledge_gaps: List[KnowledgeGap]) -> QueryStrategy:
        """Determine query strategy"""
        if iteration_number == 1:
            return QueryStrategy.BROAD_EXPLORATION
        elif len(knowledge_gaps) > 5:
            return QueryStrategy.GAP_FILLING
        elif iteration_number <= 3:
            return QueryStrategy.FOCUSED_DEEP_DIVE
        else:
            return QueryStrategy.VERIFICATION
    
    def _determine_target_complexity(self, iteration_number: int) -> QueryComplexity:
        """Determine target complexity"""
        if iteration_number == 1:
            return QueryComplexity.SIMPLE
        elif iteration_number <= 3:
            return QueryComplexity.MODERATE
        else:
            return QueryComplexity.COMPLEX
    
    async def _generate_queries_by_strategy(self, context: QueryGenerationContext) -> List[str]:
        """Generate queries based on strategy"""
        queries = []
        
        if context.strategy == QueryStrategy.GAP_FILLING:
            # Generate queries based on knowledge gaps
            queries.extend(await self._generate_gap_filling_queries(context))
        else:
            # Generate queries based on templates
            queries.extend(await self._generate_template_queries(context))
        
        # Generate semantic expansion queries
        queries.extend(await self._generate_semantic_queries(context))
        
        # Generate combination queries
        queries.extend(await self._generate_combination_queries(context))
        
        return queries
    
    async def _generate_gap_filling_queries(self, context: QueryGenerationContext) -> List[str]:
        """Generate queries to fill knowledge gaps"""
        queries = []
        detected_language = self._detect_language(context.research_topic)
        
        for gap in context.knowledge_gaps:
            gap_area = gap.description
            
            # Direct query for gap area
            queries.append(f"{context.research_topic} {gap_area}")
            
            # Query for solutions
            if detected_language == "zh":
                queries.append(f"{gap_area} 解决方案")
                queries.append(f"{gap_area} 研究现状")
                queries.append(f"{gap_area} 专家观点")
            else:
                queries.append(f"{gap_area} solutions")
                queries.append(f"{gap_area} research status")
                queries.append(f"{gap_area} expert opinions")
        
        return queries
    
    async def _generate_template_queries(self, context: QueryGenerationContext) -> List[str]:
        """Generate queries based on templates"""
        queries = []
        templates = self.query_templates.get(context.strategy, [])
        detected_language = self._detect_language(context.research_topic)
        
        for template in templates:
            if detected_language == "zh":
                alternative = "相关技术"  # Can be determined dynamically based on context
                gap_area = "关键问题"    # Can be determined based on knowledge gaps
            else:
                alternative = "related technology"  # Can be determined dynamically based on context
                gap_area = "key issues"             # Can be determined based on knowledge gaps
            
            query = template.format(
                topic=context.research_topic,
                alternative=alternative,
                gap_area=gap_area
            )
            queries.append(query)
        
        return queries
    
    async def _generate_semantic_queries(self, context: QueryGenerationContext) -> List[str]:
        """Generate semantic expansion queries"""
        queries = []
        detected_language = self._detect_language(context.research_topic)
        
        # Use LLM to generate semantically related queries
        if detected_language == "zh":
            prompt = f"""
请为研究主题"{context.research_topic}"生成3个语义相关的搜索查询。

要求：
1. 查询应该从不同角度探索主题
2. 包含同义词和相关概念
3. 适合在搜索引擎中使用
4. 避免重复已有查询

已有查询：{context.previous_queries}

请直接返回查询列表，每行一个查询：
"""
        else:
            prompt = f"""
Please generate 3 semantically related search queries for the research topic "{context.research_topic}".

Requirements:
1. Queries should explore the topic from different angles
2. Include synonyms and related concepts
3. Suitable for use in search engines
4. Avoid duplicating existing queries

Existing queries: {context.previous_queries}

Please return the query list directly, one query per line:
"""
        
        try:
            if hasattr(self, 'llm') and self.llm:
                response = await self.llm.generate(
                    prompt=prompt,
                    max_tokens=200,
                    temperature=0.7
                )
                
                # Parse response
                semantic_queries = [q.strip() for q in response.split('\n') if q.strip()]
                queries.extend(semantic_queries[:3])  # Limit quantity
        except Exception as e:
            # If LLM is unavailable, use predefined semantic expansion
            queries.extend(self._generate_fallback_semantic_queries(context))
        
        return queries
    
    def _generate_fallback_semantic_queries(self, context: QueryGenerationContext) -> List[str]:
        """Generate fallback semantic queries"""
        topic = context.research_topic
        detected_language = self._detect_language(topic)
        
        if detected_language == "zh":
            return [
                f"{topic} 原理机制",
                f"{topic} 实际应用", 
                f"{topic} 发展趋势",
                f"{topic} 技术挑战",
                f"{topic} 解决方案"
            ]
        else:
            return [
                f"{topic} principles and mechanisms",
                f"{topic} practical applications",
                f"{topic} development trends", 
                f"{topic} technical challenges",
                f"{topic} solutions"
            ]
    
    async def _generate_combination_queries(self, context: QueryGenerationContext) -> List[str]:
        """Generate combination queries"""
        queries = []
        topic = context.research_topic
        
        # Add enhancement terms
        for category, terms in self.enhancement_terms.items():
            for term in terms[:2]:  # Select first 2 from each category
                queries.append(f"{topic} {term}")
        
        # Add boolean combination queries
        if len(context.research_objectives) > 1:
            obj1, obj2 = context.research_objectives[0], context.research_objectives[1]
            queries.append(f"{topic} {obj1} AND {obj2}")
            queries.append(f"{topic} ({obj1} OR {obj2})")
        
        return queries
    
    async def _optimize_queries(self, queries: List[str], 
                              context: QueryGenerationContext) -> List[str]:
        """Optimize queries"""
        optimized = []
        
        for query in queries:
            # Deduplication
            if query in self.generated_queries:
                continue
            
            # Length filtering
            if len(query) < 5 or len(query) > 100:
                continue
            
            # Quality filtering
            if self._is_low_quality_query(query):
                continue
            
            # Query optimization
            optimized_query = self._optimize_single_query(query, context)
            optimized.append(optimized_query)
            self.generated_queries.add(optimized_query)
        
        return optimized
    
    def _is_low_quality_query(self, query: str) -> bool:
        """Check if query is low quality"""
        # Detect language and get appropriate meaningless words
        detected_language = self._detect_language(query)
        meaningless_words = self._get_meaningless_words(detected_language)
        
        # Check for meaningless words
        if any(word in query.lower() for word in meaningless_words):
            return True
        
        # Check if too simple
        if len(query.split()) < 2:
            return True
        
        return False
    
    def _optimize_single_query(self, query: str, context: QueryGenerationContext) -> str:
        """Optimize single query"""
        optimized = query.strip()
        
        # Add quotes for precision (for phrases)
        if ' ' in optimized and '"' not in optimized and len(optimized.split()) <= 3:
            optimized = f'"{optimized}"'
        
        # Adjust based on complexity
        if context.target_complexity == QueryComplexity.COMPLEX:
            if 'AND' not in optimized and 'OR' not in optimized:
                # Add boolean operators
                words = optimized.split()
                if len(words) >= 2:
                    optimized = f"{words[0]} AND {' '.join(words[1:])}"
        
        return optimized
    
    async def _evaluate_queries(self, queries: List[str], 
                              context: QueryGenerationContext) -> List[QueryAnalysis]:
        """Evaluate query quality"""
        analyses = []
        
        for query in queries:
            analysis = await self._analyze_single_query(query, context)
            analyses.append(analysis)
        
        return analyses
    
    async def _analyze_single_query(self, query: str, 
                                   context: QueryGenerationContext) -> QueryAnalysis:
        """Analyze single query"""
        # Estimate relevance
        relevance = self._estimate_relevance(query, context)
        
        # Estimate coverage
        coverage = self._estimate_coverage(query, context)
        
        # Calculate complexity score
        complexity = self._calculate_complexity_score(query)
        
        # Calculate uniqueness score
        uniqueness = self._calculate_uniqueness_score(query, context)
        
        # Estimate result count
        expected_results = self._estimate_result_count(query)
        
        # Search engine compatibility
        compatibility = self._check_search_engine_compatibility(query)
        
        # Extract keywords
        keywords = self._extract_keywords(query)
        
        # Extract semantic concepts
        concepts = self._extract_semantic_concepts(query, context)
        
        return QueryAnalysis(
            query_text=query,
            estimated_relevance=relevance,
            estimated_coverage=coverage,
            complexity_score=complexity,
            uniqueness_score=uniqueness,
            expected_result_count=expected_results,
            search_engines_compatibility=compatibility,
            keywords=keywords,
            semantic_concepts=concepts
        )
    
    def _estimate_relevance(self, query: str, context: QueryGenerationContext) -> float:
        """Estimate query relevance"""
        topic_words = context.research_topic.lower().split()
        query_words = query.lower().split()
        
        # Calculate word overlap
        overlap = len(set(topic_words) & set(query_words))
        max_overlap = max(len(topic_words), len(query_words))
        
        if max_overlap == 0:
            return 0.0
        
        base_relevance = overlap / max_overlap
        
        # Adjust based on query strategy
        if context.strategy == QueryStrategy.BROAD_EXPLORATION:
            return min(base_relevance + 0.1, 1.0)
        elif context.strategy == QueryStrategy.FOCUSED_DEEP_DIVE:
            return base_relevance
        
        return base_relevance
    
    def _estimate_coverage(self, query: str, context: QueryGenerationContext) -> float:
        """Estimate query coverage"""
        # Estimate based on query length and complexity
        words_count = len(query.split())
        
        if words_count <= 2:
            return 0.3  # Simple queries have lower coverage
        elif words_count <= 4:
            return 0.6  # Medium queries
        else:
            return 0.8  # Complex queries have higher coverage
    
    def _calculate_complexity_score(self, query: str) -> float:
        """Calculate complexity score"""
        score = 0.0
        
        # Based on length
        words_count = len(query.split())
        score += min(words_count / 10, 0.4)
        
        # Based on operators
        operators = ['AND', 'OR', 'NOT', '"', '(', ')']
        operator_count = sum(1 for op in operators if op in query)
        score += min(operator_count / 5, 0.3)
        
        # Based on technical terms
        if any(char.isupper() for char in query):
            score += 0.2
        
        # Based on numbers and special characters
        if any(char.isdigit() for char in query):
            score += 0.1
        
        return min(score, 1.0)
    
    def _calculate_uniqueness_score(self, query: str, 
                                  context: QueryGenerationContext) -> float:
        """Calculate uniqueness score"""
        # Similarity with previous queries
        previous_queries = [q.query for q in context.previous_queries]
        
        if not previous_queries:
            return 1.0
        
        max_similarity = 0.0
        query_words = set(query.lower().split())
        
        for prev_query in previous_queries:
            prev_words = set(prev_query.lower().split())
            if len(query_words | prev_words) == 0:
                continue
            
            similarity = len(query_words & prev_words) / len(query_words | prev_words)
            max_similarity = max(max_similarity, similarity)
        
        return 1.0 - max_similarity
    
    def _estimate_result_count(self, query: str) -> int:
        """Estimate the number of results a query might return"""
        # Simple estimation based on query length and complexity
        words_count = len(query.split())
        
        if words_count <= 2:
            return 1000  # Simple queries return more results
        elif words_count <= 4:
            return 500   # Medium queries
        else:
            return 200   # Complex queries return fewer results
    
    def _check_search_engine_compatibility(self, query: str) -> Dict[str, bool]:
        """Check query compatibility with search engines"""
        detected_language = self._detect_language(query)
        
        # Base compatibility for all engines
        compatibility = {
            "google": True,  # Google supports most queries
            "bing": True,    # Bing supports most queries
            "bochaai": True  # BochaaI supports most queries
        }
        
        # Language-specific adjustments
        if detected_language == "zh":
            # Baidu is better for Chinese queries
            compatibility["bochaai"] = True
            # Some engines may have limitations with Chinese quotes
            if '"' in query:
                compatibility["bochaai"] = False
        else:
            # Baidu has limited support for non-Chinese queries
            compatibility["bochaai"] = False
        
        return compatibility
    
    def _extract_keywords(self, query: str) -> List[str]:
        """Extract keywords from text"""
        # Simple keyword extraction (more complex NLP techniques can be used in practice)
        words = query.replace('"', '').replace('(', '').replace(')', '').split()
        
        # Detect language and get appropriate stop words
        detected_language = self._detect_language(query)
        stop_words = self._get_stop_words(detected_language)
        
        keywords = [word for word in words if word not in stop_words and len(word) > 1]
        
        return keywords
    
    def _extract_semantic_concepts(self, query: str, 
                                 context: QueryGenerationContext) -> List[str]:
        """Extract semantic concepts"""
        # Extract concepts based on research topic and query content
        concepts = []
        
        # Add research topic as core concept
        concepts.append(context.research_topic)
        
        # Detect language and extract concepts dynamically
        detected_language = self._detect_language(query)
        concept_patterns = self._get_concept_patterns(detected_language)
        
        # Extract concepts based on detected language patterns
        for pattern, concept in concept_patterns.items():
            if pattern.lower() in query.lower():
                concepts.append(concept)
        
        return list(set(concepts))
    
    def _detect_language(self, text: str) -> str:
        """Detect the language of the input text"""
        # Simple language detection based on character sets
        chinese_chars = sum(1 for char in text if '\u4e00' <= char <= '\u9fff')
        total_chars = len([char for char in text if char.isalpha()])
        
        if total_chars == 0:
            return "en"  # Default to English if no alphabetic characters
        
        chinese_ratio = chinese_chars / total_chars if total_chars > 0 else 0
        
        if chinese_ratio > 0.3:  # If more than 30% are Chinese characters
            return "zh"
        else:
            return "en"
    
    def _get_concept_patterns(self, language: str) -> Dict[str, str]:
        """Get concept patterns based on detected language"""
        if language == "zh":
            return {
                "技术": "技术",
                "应用": "应用", 
                "发展": "发展",
                "研究": "研究",
                "原理": "原理",
                "机制": "机制",
                "方法": "方法",
                "分析": "分析",
                "比较": "比较",
                "评估": "评估"
            }
        else:  # Default to English
            return {
                "technology": "technology",
                "application": "application",
                "development": "development", 
                "research": "research",
                "principle": "principle",
                "mechanism": "mechanism",
                "method": "method",
                "analysis": "analysis",
                "comparison": "comparison",
                "evaluation": "evaluation"
            }
    
    def _get_meaningless_words(self, language: str) -> List[str]:
        """Get meaningless words based on detected language"""
        if language == "zh":
            return ["什么", "如何", "为什么", "哪里", "谁", "哪个", "多少"]
        else:
            return ["what", "how", "why", "where", "who", "which", "how many"]
    
    def _get_stop_words(self, language: str) -> Set[str]:
        """Get stop words based on detected language"""
        if language == "zh":
            return {'AND', 'OR', 'NOT', '的', '在', '与', '和', '或', '非', '是', '有', '为', '对', '从', '到'}
        else:
            return {'AND', 'OR', 'NOT', 'the', 'in', 'and', 'or', 'not', 'is', 'are', 'was', 'were', 'be', 'been', 'being'}
    
    async def _select_best_queries(self, analyses: List[QueryAnalysis], 
                                 context: QueryGenerationContext) -> List[SearchQuery]:
        """Select the best queries"""
        # Calculate overall score
        scored_analyses = []
        for analysis in analyses:
            score = self._calculate_overall_score(analysis, context)
            scored_analyses.append((score, analysis))
        
        # Sort and select the best queries
        scored_analyses.sort(key=lambda x: x[0], reverse=True)
        
        # Detect language for the research topic
        detected_language = self._detect_language(context.research_topic)
        language_code = "zh-CN" if detected_language == "zh" else "en-US"
        
        # Select appropriate search engines based on language
        if detected_language == "zh":
            search_engines = [SearchEngine.GOOGLE, SearchEngine.BING, SearchEngine.BOCHAAI]
        else:
            search_engines = [SearchEngine.GOOGLE, SearchEngine.BING, SearchEngine.BOCHAAI]
        
        selected_queries = []
        for i, (score, analysis) in enumerate(scored_analyses[:context.max_queries]):
            search_query = SearchQuery(
                query=analysis.query_text,
                query_type=self._determine_query_type(analysis),
                max_results=self._determine_max_results(analysis, context),
                language=language_code,
                search_engines=search_engines,
                metadata={
                    "relevance_score": analysis.estimated_relevance,
                    "coverage_score": analysis.estimated_coverage,
                    "complexity_score": analysis.complexity_score,
                    "uniqueness_score": analysis.uniqueness_score,
                    "overall_score": score,
                    "keywords": analysis.keywords,
                    "concepts": analysis.semantic_concepts,
                    "priority": len(scored_analyses) - i  # Priority based on ranking
                }
            )
            selected_queries.append(search_query)
        
        return selected_queries
    
    def _calculate_overall_score(self, analysis: QueryAnalysis, 
                               context: QueryGenerationContext) -> float:
        """Calculate overall score"""
        # Weight configuration
        weights = {
            "relevance": 0.3,
            "coverage": 0.2,
            "complexity": 0.2,
            "uniqueness": 0.2,
            "expected_results": 0.1
        }
        
        # Normalize expected result count
        normalized_results = min(analysis.expected_result_count / 1000, 1.0)
        
        score = (
            weights["relevance"] * analysis.estimated_relevance +
            weights["coverage"] * analysis.estimated_coverage +
            weights["complexity"] * analysis.complexity_score +
            weights["uniqueness"] * analysis.uniqueness_score +
            weights["expected_results"] * normalized_results
        )
        
        return score
    
    def _determine_query_type(self, analysis: QueryAnalysis) -> QueryType:
        """Determine query type"""
        if analysis.complexity_score > 0.7:
            return QueryType.DEEP_DIVE
        elif "AND" in analysis.query_text or "OR" in analysis.query_text:
            return QueryType.FOLLOWUP
        elif '"' in analysis.query_text:
            return QueryType.CLARIFICATION
        else:
            return QueryType.INITIAL
    
    def _determine_max_results(self, analysis: QueryAnalysis, 
                             context: QueryGenerationContext) -> int:
        """Determine maximum results"""
        if context.strategy == QueryStrategy.BROAD_EXPLORATION:
            return 20
        elif context.strategy == QueryStrategy.FOCUSED_DEEP_DIVE:
            return 15
        elif context.strategy == QueryStrategy.GAP_FILLING:
            return 10
        else:
            return 12
    
    def _update_query_stats(self, queries: List[SearchQuery], strategy: QueryStrategy) -> None:
        """Update query statistics"""
        self.query_stats["total_generated"] += len(queries)
        self.query_stats["strategy_usage"][strategy] += 1
        
        if queries:
            avg_relevance = sum(q.metadata.get("relevance_score", 0.0) for q in queries) / len(queries)
            self.query_stats["average_relevance"] = (
                self.query_stats["average_relevance"] + avg_relevance
            ) / 2
    
    async def get_query_statistics(self) -> Dict[str, Any]:
        """Get query statistics"""
        return self.query_stats.copy()
    
    async def reset_query_cache(self) -> None:
        """Reset query cache"""
        self.generated_queries.clear()
        self.query_stats = {
            "total_generated": 0,
            "successful_queries": 0,
            "average_relevance": 0.0,
            "strategy_usage": {strategy: 0 for strategy in QueryStrategy}
        }
    
    def generate_followup_queries(self, research_topic: str, previous_findings: str, knowledge_gaps: str, num_queries: int = 2) -> str:
        """Generate follow-up search query prompts (maintaining backward compatibility)"""
        detected_language = self._detect_language(research_topic)
        
        if detected_language == "zh":
            prompt = f"""
您是一位专业的搜索查询专家。基于当前的研究发现和已识别的知识空白，生成{num_queries}个后续搜索查询。

研究主题: {research_topic}

现有发现:
{previous_findings}

已识别的知识空白:
{knowledge_gaps}

生成的查询应该：
1. 专门针对已识别的知识空白
2. 补充现有信息不足
3. 深入挖掘相关细节
4. 使用更具体或更广泛的关键词
5. **重要：生成的查询必须与研究主题使用相同的语言（如果主题是中文，查询也应该是中文；如果主题是英文，查询也应该是英文）**

请以JSON格式返回查询列表：
{{
    "queries": ["query1", "query2"]
}}
"""
        else:
            prompt = f"""
You are a professional search query expert. Based on current research findings and identified knowledge gaps, generate {num_queries} follow-up search queries.

Research Topic: {research_topic}

Existing Findings:
{previous_findings}

Identified Knowledge Gaps:
{knowledge_gaps}

The generated queries should:
1. Specifically target identified knowledge gaps
2. Supplement existing information deficiencies
3. Dig deeper into relevant details
4. Use more specific or broader keywords
5. **Important: Generated queries must use the same language as the research topic (if the topic is in Chinese, queries should also be in Chinese; if the topic is in English, queries should also be in English)**

Please return the query list in JSON format:
{{
    "queries": ["query1", "query2"]
}}
"""
        return prompt