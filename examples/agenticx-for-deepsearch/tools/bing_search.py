"""
Bing Web Search Tool Implementation
Web search tool implementation based on Bing Web Search API
"""

import os
import json
import urllib.parse
import urllib.request
import ssl
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from agenticx.tools.base import BaseTool


class SearchInput(BaseModel):
    """Search input model"""
    query: str = Field(description="Search query string")


class SearchResult(BaseModel):
    """Search result model"""
    title: str = Field(description="Search result title")
    link: str = Field(description="Search result link")
    snippet: str = Field(description="Search result summary")
    displayUrl: Optional[str] = Field(default=None, description="Display URL")
    dateLastCrawled: Optional[str] = Field(default=None, description="Last crawl time")
    images: Optional[List[Dict[str, str]]] = Field(default_factory=list, description="Related image information")


class BingWebSearchTool(BaseTool):
    """Bing Web Search tool, encapsulates calls to Bing Web Search API"""
    
    def __init__(self, subscription_key: Optional[str] = None, endpoint: Optional[str] = None,
                 market: Optional[str] = None, safe_search: Optional[str] = None,
                 count: Optional[int] = None):
        """
        Initialize Bing Web Search tool
        
        Args:
            subscription_key: Bing Subscription Key (if not provided, get from environment variables)
            endpoint: Bing API endpoint (defaults to official endpoint)
            market: Search market (defaults to zh-CN)
            safe_search: Safe search level (defaults to Moderate)
            count: Number of returned results (defaults to 10)
        """
        super().__init__(
            name="bing_web_search_tool",
            description="Use Bing Web Search API to search for web page information. Input search query, returns relevant web page results with titles, links and summaries.",
            args_schema=SearchInput
        )
        
        # Priority: passed parameters, then environment variables
        self.subscription_key = subscription_key or os.getenv("BING_SUBSCRIPTION_KEY") or os.getenv("AZURE_SUBSCRIPTION_KEY")
        if not self.subscription_key:
            raise ValueError(
                "Bing Subscription Key not configured\n"
                "Please set subscription_key parameter in config file, or set in environment variables:\n"
                "  BING_SUBSCRIPTION_KEY=your_bing_subscription_key\n"
                "  AZURE_SUBSCRIPTION_KEY=your_azure_subscription_key"
            )
        
        self.endpoint = endpoint or "https://api.bing.microsoft.com/v7.0/search"
        self.market = market or "zh-CN"
        self.safe_search = safe_search or "Moderate"
        self.count = count or 10
        
        print(f"● Bing Web Search configuration:")
        print(f"   Endpoint: {self.endpoint}")
        print(f"   Market: {self.market}")
        print(f"   Safe Search: {self.safe_search}")
        print(f"   Count: {self.count}")
        print(f"   API Key: {'Configured' if self.subscription_key else 'Not configured'}")
    
    def _run(self, query: str) -> List[Dict[str, Any]]:
        """
        Execute Bing Web Search
        
        Args:
            query: Search query string
            
        Returns:
            List[Dict[str, Any]]: Search results list, each result includes title, link, snippet
        """
        try:
            # Build request URL
            params = {
                'q': query,
                'count': self.count,  # Number of returned results
                'offset': 0,
                'mkt': self.market,  # Chinese market
                'safesearch': self.safe_search
            }
            
            url = f"{self.endpoint}?{urllib.parse.urlencode(params)}"
            
            # Create request
            req = urllib.request.Request(url)
            req.add_header('Ocp-Apim-Subscription-Key', self.subscription_key)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            
            # Send request
            with urllib.request.urlopen(req) as response:
                data = response.read().decode('utf-8')
                result = json.loads(data)
            
            # Parse search results
            results = []
            if 'webPages' in result and 'value' in result['webPages']:
                for item in result['webPages']['value']:
                    result_item = {
                        'title': item.get('name', 'No title'),
                        'link': item.get('url', ''),
                        'snippet': item.get('snippet', 'No summary'),
                        'images': []  # Initialize image list
                    }
                    results.append(result_item)
            
            # Process image search results (if any)
            if 'images' in result and 'value' in result['images']:
                image_results = []
                for img in result['images']['value'][:5]:  # Take up to 5 images
                    image_info = {
                        'url': img.get('contentUrl', ''),
                        'thumbnail': img.get('thumbnailUrl', ''),
                        'title': img.get('name', ''),
                        'width': str(img.get('width', '')),
                        'height': str(img.get('height', ''))
                    }
                    image_results.append(image_info)
                
                # Add image information to the first search result (if there are search results)
                if results and image_results:
                    results[0]['images'] = image_results
            
            print(f"✅ Bing search completed: query='{query}', result count={len(results)}")
            return results
            
        except urllib.error.HTTPError as e:
            error_msg = f"Bing API HTTP error: {e.code} - {e.reason}"
            if e.code == 401:
                error_msg += "\nPlease check if BING_SUBSCRIPTION_KEY is set correctly"
            elif e.code == 429:
                error_msg += "\nRequest too frequent, please try again later"
            elif e.code == 403:
                error_msg += "\nAccess denied, please check API key permissions"
            print(f"❌ {error_msg}")
            return []
            
        except urllib.error.URLError as e:
            print(f"❌ Network connection error: {e.reason}")
            return []
            
        except json.JSONDecodeError as e:
            print(f"❌ JSON parsing error: {e}")
            return []
            
        except Exception as e:
            print(f"❌ Bing search failed: {e}")
            return []
    
    async def _arun(self, query: str) -> List[Dict[str, Any]]:
        """Asynchronous execution of search (currently calls synchronous method)"""
        return self._run(query)


class MockBingSearchTool(BaseTool):
    """Mock Bing Search tool, for testing"""
    
    def __init__(self):
        super().__init__(
            name="bing_web_search_tool",
            description="Simulate using Bing Web Search API to search for web page information. Input search query, returns relevant web page results with titles, links and summaries.",
            args_schema=SearchInput
        )
        
        print(f"● Mock Bing Search configuration:")
        print(f"   Mode: Test mode (returns simulated results)")
    
    def _run(self, query: str) -> List[Dict[str, Any]]:
        """
        Simulate Bing search
        
        Args:
            query: Search query string
            
        Returns:
            List[Dict[str, Any]]: Simulated search results list
        """
        # Return simulated search results
        mock_results = [
            {
                "title": f"Deep analysis report on '{query}'",
                "link": "https://example.com/analysis1",
                "snippet": f"This is a detailed analysis report on {query}, covering the latest research achievements and development trends. The report points out several key points..."
            },
            {
                "title": f"{query} - Latest development dynamics",
                "link": "https://example.com/news1",
                "snippet": f"Latest news indicates that the {query} field is experiencing rapid development, with multiple important breakthroughs worth noting. Experts predict..."
            },
            {
                "title": f"Future outlook and challenges for {query}",
                "link": "https://example.com/future1",
                "snippet": f"In terms of future development of {query}, the industry generally believes that opportunities coexist with challenges. The main development directions include..."
            },
            {
                "title": f"Expert interpretation: Key technologies for {query}",
                "link": "https://example.com/tech1",
                "snippet": f"Technical experts have deeply analyzed the core technologies related to {query}, identifying current technical bottlenecks and solutions..."
            },
            {
                "title": f"Case studies on {query} industry applications",
                "link": "https://example.com/case1",
                "snippet": f"Through multiple actual case analyses, we can see the application effect and value of {query} in different industries..."
            }
        ]
        
        print(f"✅ Mock Bing search completed: query='{query}', result count={len(mock_results)}")
        return mock_results
    
    async def _arun(self, query: str) -> List[Dict[str, Any]]:
        """Asynchronous execution of search (currently calls synchronous method)"""
        return self._run(query)