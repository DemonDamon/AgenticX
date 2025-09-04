"""AgenticX-based web search task

This module implements WebSearchTask, responsible for executing web search operations,
strictly following the AgenticX framework's Task abstraction.
"""

from typing import List, Dict, Any, Optional
from pydantic import Field
from datetime import datetime
import logging
from agenticx.core.task import Task
from agenticx.core.message import Message
from models import SearchQuery, SearchResult, SearchEngine
from .google_search import GoogleSearchTool
from .bing_search import BingWebSearchTool
from .bochaai_search import BochaaIWebSearchTool


class WebSearchTask(Task):
    """Web search task
    
    Based on agenticx.core.Task implementation, responsible for:
    1. Executing multi-engine searches
    2. Aggregating search results
    3. Deduplication and sorting
    4. Result quality assessment
    """
    
    search_provider: Optional[Any] = Field(default=None, description="Search provider instance")
    search_tools: Dict[str, Any] = Field(default_factory=dict, description="Available search tools")
    
    def __init__(self, name: str = "WebSearch", description: str = "Execute web search operations across multiple search engines",
                 expected_output: str = "List of search results with titles, URLs, snippets and content",
                 search_provider=None, **kwargs):
        # Initialize search tools (only initialize available ones)
        search_tools = {}
        
        # Try to initialize Google search
        try:
            search_tools['google'] = GoogleSearchTool()
        except Exception as e:
            print(f"⚠️ Google search tool initialization failed: {e}")
        
        # Try to initialize Bing search
        try:
            search_tools['bing'] = BingWebSearchTool()
        except Exception as e:
            print(f"⚠️ Bing search tool initialization failed: {e}")
        
        # Try to initialize BochaaI search
        try:
            search_tools['bochaai'] = BochaaIWebSearchTool()
        except Exception as e:
            print(f"⚠️ BochaaI search tool initialization failed: {e}")
        
        super().__init__(
            description=description,
            expected_output=expected_output,
            **kwargs
        )
        
        # 设置实例属性
        self.search_provider = search_provider
        self.search_tools = search_tools
        
        # 设置日志记录器
        self.logger = logging.getLogger(self.__class__.__name__)
    
    async def execute(self, **kwargs) -> Dict[str, Any]:
        """Execute search task"""
        query = kwargs.get("query")
        engines = kwargs.get("engines", ["google"])
        max_results = kwargs.get("max_results", 10)
        
        if not query:
            raise ValueError("Missing search query")
        
        all_results = []
        
        # Execute search across multiple search engines
        for engine in engines:
            if engine in self.search_tools:
                try:
                    results = await self._search_with_engine(engine, query, max_results)
                    all_results.extend(results)
                except Exception as e:
                    self.logger.warning(f"Search engine {engine} execution failed: {e}")
        
        # Deduplication and sorting
        unique_results = self._deduplicate_results(all_results)
        sorted_results = self._sort_results(unique_results)
        
        return {
            "results": sorted_results[:max_results],
            "total_found": len(sorted_results),
            "engines_used": engines,
            "query": query
        }
    
    async def _search_with_engine(self, engine: str, query: str, max_results: int) -> List[SearchResult]:
        """Execute search using specified search engine"""
        tool = self.search_tools[engine]
        
        # Build search input
        search_input = {
            "query": query,
            "num_results": max_results
        }
        
        # Execute search
        results = await tool.search(**search_input)
        
        # Convert to standard format
        return self._convert_to_search_results(results, engine)
    
    def _convert_to_search_results(self, raw_results: List[Dict], engine: str) -> List[SearchResult]:
        """Convert raw search results to standard format"""
        search_results = []
        
        # 将字符串引擎名称转换为 SearchEngine 枚举
        try:
            engine_enum = SearchEngine(engine)
        except ValueError:
            # 如果引擎名称无效，使用默认值
            engine_enum = SearchEngine.BOCHAAI
        
        for result in raw_results:
            # 确保时间戳是 datetime 类型
            timestamp = result.get("timestamp")
            if timestamp is None:
                timestamp = datetime.now()
            elif isinstance(timestamp, str):
                try:
                    timestamp = datetime.fromisoformat(timestamp)
                except ValueError:
                    timestamp = datetime.now()
            
            search_result = SearchResult(
                title=result.get("title", ""),
                url=result.get("url", ""),
                snippet=result.get("snippet", ""),
                source=engine_enum,
                timestamp=timestamp,
                content=result.get("content", "")
            )
            search_results.append(search_result)
        
        return search_results
    
    def _deduplicate_results(self, results: List[SearchResult]) -> List[SearchResult]:
        """Remove duplicate results"""
        seen_urls = set()
        unique_results = []
        
        for result in results:
            if result.url not in seen_urls:
                seen_urls.add(result.url)
                unique_results.append(result)
        
        return unique_results
    
    def _sort_results(self, results: List[SearchResult]) -> List[SearchResult]:
        """Sort search results"""
        # Simple sorting logic, can be extended as needed
        return sorted(results, key=lambda x: len(x.snippet), reverse=True)