"""
Google Search Tool Implementation
Web search tool implementation based on Google Search API
"""

import os
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from google.genai import Client
from agenticx.tools.base import BaseTool


class SearchInput(BaseModel):
    """Search input model"""
    query: str = Field(description="Search query string")


class SearchResult(BaseModel):
    """Search result model"""
    title: str = Field(description="Search result title")
    link: str = Field(description="Search result link")
    snippet: str = Field(description="Search result summary")


class MockGoogleSearchTool(BaseTool):
    """Mock Google Search tool, for testing"""
    
    def __init__(self):
        super().__init__(
            name="google_search_tool",
            description="Simulate using Google Search API to search for web page information. Input search query, returns relevant web page results with titles, links and summaries.",
            args_schema=SearchInput
        )
        
        print(f"● Mock Google Search configuration:")
        print(f"   Mode: Test mode (returns simulated results)")
    
    def _run(self, query: str) -> List[Dict[str, Any]]:
        """
        Simulate Google search execution
        
        Args:
            query: Search query string
            
        Returns:
            List[Dict[str, Any]]: Simulated search results list
        """
        # Return simulated search results
        mock_results = [
            {
                "title": f"Professional analysis on '{query}'",
                "link": "https://example.com/analysis",
                "snippet": f"This is a professional analysis article on {query}, covering the latest development trends and technical details. The article provides in-depth insights and practical advice."
            },
            {
                "title": f"'{query}' latest research report",
                "link": "https://example.com/research",
                "snippet": f"Latest research report shows that {query} has made significant progress recently. The report provides detailed analysis of the advantages and challenges of related technologies."
            },
            {
                "title": f"'{query}' industry dynamics",
                "link": "https://example.com/industry",
                "snippet": f"Industry experts have provided in-depth interpretation of the latest dynamics of {query}, analyzing its impact and significance on future development."
            }
        ]
        
        return mock_results
    
    async def aexecute(self, query: str) -> List[Dict[str, Any]]:
        """Asynchronous execution of search (currently calls synchronous method)"""
        return self._run(query)


class GoogleSearchTool(BaseTool):
    """Google Search tool, encapsulates calls to Google Search API"""
    
    def __init__(self, api_key: Optional[str] = None, config: Optional[Dict[str, Any]] = None):
        """
        Initialize Google Search tool
        
        Args:
            api_key: Google API Key (if not provided, get from environment variables)
            config: Additional configuration parameters
        """
        super().__init__(
            name="google_search_tool",
            description="Use Google Search API to search for web page information. Input search query, returns relevant web page results with titles, links and summaries.",
            args_schema=SearchInput
        )
        
        # Priority: passed parameters, then environment variables
        self.api_key = api_key or os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "Google API Key not configured\n"
                "Please set api_key parameter in config file, or set in environment variables:\n"
                "  GOOGLE_API_KEY=your_google_api_key\n"
                "  GEMINI_API_KEY=your_gemini_api_key"
            ) 