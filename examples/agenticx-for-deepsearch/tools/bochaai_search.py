#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BochaaI Web Search Tool Implementation
Web search tool implementation based on BochaaI Web Search API
"""

import os
import json
import urllib.parse
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional, Union
from pydantic import BaseModel, Field
import sys
import os

# Add project root directory to Python path
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from agenticx.tools.base import BaseTool


class SearchInput(BaseModel):
    """Search input model"""
    query: str = Field(description="Search query string")
    freshness: Optional[str] = Field(default="noLimit", description="Search time range")
    summary: Optional[bool] = Field(default=False, description="Whether to display text summary")
    include: Optional[str] = Field(default=None, description="Specify website scope for search")
    exclude: Optional[str] = Field(default=None, description="Exclude website scope for search")
    count: Optional[int] = Field(default=10, description="Number of returned results")


class WebPageValue(BaseModel):
    """Web page search result model"""
    id: str = Field(description="Web page sort ID")
    name: str = Field(description="Web page title")
    url: str = Field(description="Web page URL")
    displayUrl: str = Field(description="Web page display URL")
    snippet: str = Field(description="Brief description of web page content")
    summary: Optional[str] = Field(default=None, description="Text summary of web page content")
    siteName: Optional[str] = Field(default=None, description="Web page site name")
    siteIcon: Optional[str] = Field(default=None, description="Web page site icon")
    datePublished: Optional[str] = Field(default=None, description="Web page publication date")
    dateLastCrawled: Optional[str] = Field(default=None, description="Web page crawl date")
    cachedPageUrl: Optional[str] = Field(default=None, description="Web page cached page URL")
    language: Optional[str] = Field(default=None, description="Web page language")
    isFamilyFriendly: Optional[bool] = Field(default=None, description="Whether it's a family-friendly page")
    isNavigational: Optional[bool] = Field(default=None, description="Whether it's a navigational page")


class WebSearchWebPages(BaseModel):
    """Web search result collection model"""
    webSearchUrl: Optional[str] = Field(default=None, description="Search URL")
    totalEstimatedMatches: Optional[int] = Field(default=None, description="Total number of web pages matching the search")
    value: List[WebPageValue] = Field(description="Search result list")
    someResultsRemoved: Optional[bool] = Field(default=None, description="Whether results have been filtered for safety")


class WebSearchQueryContext(BaseModel):
    """Search query context model"""
    originalQuery: str = Field(description="Original search keywords")


class SearchResponse(BaseModel):
    """Search response model"""
    search_type: str = Field(description="Search type")
    queryContext: WebSearchQueryContext = Field(description="Query context")
    webPages: Optional[WebSearchWebPages] = Field(default=None, description="Web page search results")
    images: Optional[Dict[str, Any]] = Field(default=None, description="Image search results")
    videos: Optional[Dict[str, Any]] = Field(default=None, description="Video search results")


class BochaaIWebSearchTool(BaseTool):
    """BochaaI Web Search tool, encapsulates calls to BochaaI Web Search API"""
    
    def __init__(self, api_key: Optional[str] = None, endpoint: Optional[str] = None):
        """
        Initialize BochaaI Web Search tool
        
        Args:
            api_key: BochaaI API Key (if not provided, get from environment variables)
            endpoint: API endpoint (defaults to official endpoint)
        """
        super().__init__(
            name="bochaai_web_search_tool",
            description="Use BochaaI Web Search API to search for web page information. Input search query, returns relevant web page results with titles, links and summaries.",
            args_schema=SearchInput
        )
        
        # Priority: passed parameters, then environment variables
        self.api_key = api_key or os.getenv("BOCHAAI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "BochaaI API Key not configured\n"
                "Please set api_key parameter in config file, or set in environment variables:\n"
                "  BOCHAAI_API_KEY=your_bochaai_api_key"
            )
        
        self.endpoint = endpoint or "https://api.bochaai.com/v1/web-search"
        
        # BochaaI Web Search configuration completed
    
    def _run(self, query: str, freshness: str = "noLimit", summary: bool = False, 
             include: Optional[str] = None, exclude: Optional[str] = None, 
             count: int = 10) -> List[Dict[str, Any]]:
        """
        Execute BochaaI Web Search
        
        Args:
            query: Search query string
            freshness: Search time range
            summary: Whether to display text summary
            include: Specify website scope for search
            exclude: Exclude website scope for search
            count: Number of returned results
            
        Returns:
            List[Dict[str, Any]]: Search results list, each result includes title, link, summary, etc.
        """
        try:
            # Build request data
            request_data = {
                "query": query,
                "freshness": freshness,
                "summary": summary,
                "count": min(max(count, 1), 50)  # Limit between 1-50
            }
            
            # Add optional parameters
            if include:
                request_data["include"] = include
            if exclude:
                request_data["exclude"] = exclude
            
            # Create request
            req = urllib.request.Request(
                self.endpoint,
                data=json.dumps(request_data).encode('utf-8'),
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json',
                    'User-Agent': 'AgenticX-BochaaI-Search/1.0'
                }
            )
            
            # Send request
            with urllib.request.urlopen(req, timeout=30) as response:
                data = response.read().decode('utf-8')
                result = json.loads(data)
            
            # Check response status
            
            # Parse search results
            results = []
            
            # Check response structure, BochaaI's response format is {"code": 200, "data": {...}}
            if 'data' in result:
                data = result['data']
                if 'webPages' in data and data['webPages'] and 'value' in data['webPages']:
                    for item in data['webPages']['value']:
                        result_item = {
                            'id': item.get('id', ''),
                            'title': item.get('name', 'No Title'),
                            'url': item.get('url', ''),
                            'displayUrl': item.get('displayUrl', ''),
                            'snippet': item.get('snippet', 'No Summary'),
                            'siteName': item.get('siteName', ''),
                            'datePublished': item.get('datePublished', ''),
                            'language': item.get('language', ''),
                            'isFamilyFriendly': item.get('isFamilyFriendly', True),
                            'images': []  # Initialize image field
                        }
                        
                        # Add summary (if requested)
                        if summary and 'summary' in item:
                            result_item['summary'] = item['summary']
                        
                        results.append(result_item)
                
                # Handle image search results
                if 'images' in data and data['images'] and 'value' in data['images']:
                    for img_item in data['images']['value'][:5]:  # Limit image count
                        image_info = {
                            'type': 'image',
                            'title': img_item.get('name', 'Image'),
                            'url': img_item.get('contentUrl', ''),
                            'thumbnail': img_item.get('thumbnailUrl', ''),
                            'source': img_item.get('hostPageUrl', ''),
                            'width': img_item.get('width', 0),
                            'height': img_item.get('height', 0)
                        }
                        results.append(image_info)

                # If no webPages data found, handle silently
                pass
            # If no 'data' field found, handle silently
            
            # Print title of each web page in search results
            # print(f"    ✦ search query: \033[36m{query}\033[0m")
            if results:
                print(f"  |")
                for i, result in enumerate(results, 1):
                    if result.get('type') != 'image':  # Only print web page results, not image results
                        title = result.get('title', 'No Title')
                        print(f"  | \033[2m{title}\033[0m")
                print(f"  |")

            return results
            
        except urllib.error.HTTPError as e:
            error_msg = f"BochaAI API HTTP error: {e.code} - {e.reason}"
            if e.code == 401:
                error_msg += "\nPlease check if BOCHAAI_API_KEY is correctly set"
            elif e.code == 429:
                error_msg += "\nRequests too frequent, please try again later"
            elif e.code == 403:
                error_msg += "\nAccess denied, please check API key permissions"
            print(f"  | \033[2m{error_msg}\033[0m")
            return []
            
        except urllib.error.URLError as e:
            print(f"  | \033[2mNetwork connection error: {e.reason}\033[0m")
            return []
            
        except json.JSONDecodeError as e:
            print(f"  | \033[2mJSON parsing error: {e}\033[0m")
            return []
            
        except Exception as e:
            print(f"  | \033[2mBochaAI search failed: {e}\033[0m")
            return []
    
    async def _arun(self, query: str, freshness: str = "noLimit", summary: bool = False,
                    include: Optional[str] = None, exclude: Optional[str] = None,
                    count: int = 10) -> List[Dict[str, Any]]:
        """Asynchronously execute search (currently calls synchronous method)"""
        return self._run(query, freshness, summary, include, exclude, count)


class MockBochaaISearchTool(BaseTool):
    """Mock BochaaI Search tool for testing"""
    
    def __init__(self):
        super().__init__(
            name="bochaai_web_search_tool",
            description="Mock using BochaaI Web Search API to search for web page information. Input search query, returns relevant web page results with titles, links and summaries.",
            args_schema=SearchInput
        )
        
        # Mock BochaaI Search configuration completed
    
    def _run(self, query: str, freshness: str = "noLimit", summary: bool = False,
             include: Optional[str] = None, exclude: Optional[str] = None,
             count: int = 10) -> List[Dict[str, Any]]:
        """
        Mock BochaaI search execution
        
        Args:
            query: Search query string
            freshness: Search time range
            summary: Whether to display text summary
            include: Specify website scope for search
            exclude: Exclude website scope for search
            count: Number of returned results
            
        Returns:
            List[Dict[str, Any]]: Mock search results list
        """
        # Return mock search results
        mock_results = []
        
        for i in range(min(count, 5)):  # Return up to 5 mock results
            result = {
                "id": f"mock_result_{i+1}",
                "title": f"{['In-depth Analysis', 'Latest Updates', 'Professional Insights', 'Industry Report', 'Technical Guide'][i]} on '{query}'",
                "url": f"https://example.com/{query.replace(' ', '-')}-{i+1}",
                "displayUrl": f"example.com/{query.replace(' ', '-')}-{i+1}",
                "snippet": f"This is a detailed introduction about {query}, containing the latest research findings and development trends. The content covers multiple important aspects",
                "siteName": f"Professional {['News', 'Updates', 'Tech', 'Research', 'Analysis'][i]} Site",
                "datePublished": "2024-12-20T10:30:00+08:00",
                "language": "en-US",
                "isFamilyFriendly": True
            }
            
            # If summary is requested, add summary field
            if summary:
                result["summary"] = f"Detailed summary about {query}: This is a comprehensive analysis report that deeply explores various aspects of the related topic, providing valuable insights and recommendations."
            
            mock_results.append(result)
        
        print(f"    ⎿ ✅ Mock BochaAI search completed: query='{query}', result count={len(mock_results)}")
        return mock_results
    
    async def _arun(self, query: str, freshness: str = "noLimit", summary: bool = False,
                    include: Optional[str] = None, exclude: Optional[str] = None,
                    count: int = 10) -> List[Dict[str, Any]]:
        """Asynchronously execute mock search"""
        return self._run(query, freshness, summary, include, exclude, count)


# For compatibility, provide simplified search result model
class SearchResult(BaseModel):
    """Simplified search result model"""
    title: str = Field(description="Search result title")
    url: str = Field(description="Search result link")
    link: str = Field(description="Search result link (alias)")
    snippet: str = Field(description="Search result summary")


def convert_to_simple_results(results: List[Dict[str, Any]]) -> List[SearchResult]:
    """Convert BochaaI search results to simplified search result model"""
    simple_results = []
    for result in results:
        simple_result = SearchResult(
            title=result.get('title', ''),
            url=result.get('url', ''),
            link=result.get('url', ''),
            snippet=result.get('snippet', '')
        )
        simple_results.append(simple_result)
    return simple_results