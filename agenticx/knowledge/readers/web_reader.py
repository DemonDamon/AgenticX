"""Web content reader for AgenticX Knowledge Management System"""

import asyncio
import logging
from pathlib import Path
from typing import List, Optional, Union, Any
from urllib.parse import urlparse

from ..base import BaseReader
from ..document import Document, DocumentMetadata

logger = logging.getLogger(__name__)


class WebReader(BaseReader):
    """Reader for web content from URLs"""
    
    def __init__(
        self,
        timeout: int = 30,
        max_retries: int = 3,
        extract_links: bool = False,
        extract_images: bool = False,
        user_agent: Optional[str] = None,
        headers: Optional[dict] = None,
        **kwargs
    ):
        """
        Initialize WebReader
        
        Args:
            timeout: Request timeout in seconds
            max_retries: Maximum number of retries
            extract_links: Whether to extract links from content
            extract_images: Whether to extract image URLs
            user_agent: Custom user agent string
            headers: Additional HTTP headers
            **kwargs: Additional configuration
        """
        self.timeout = timeout
        self.max_retries = max_retries
        self.extract_links = extract_links
        self.extract_images = extract_images
        self.user_agent = user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        )
        self.headers = headers or {}
        self.config = kwargs
        
        # Set default headers
        self.headers.setdefault('User-Agent', self.user_agent)
        
        # Try to import required libraries
        self._http_library = self._get_http_library()
        self._html_parser = self._get_html_parser()
    
    def _get_http_library(self):
        """Get available HTTP library"""
        
        # Try aiohttp first - async and feature-rich
        try:
            import aiohttp
            logger.debug("Using aiohttp for HTTP requests")
            return 'aiohttp'
        except ImportError:
            pass
        
        # Try httpx as fallback - also async
        try:
            import httpx
            logger.debug("Using httpx for HTTP requests")
            return 'httpx'
        except ImportError:
            pass
        
        # Use requests as last resort - synchronous
        try:
            import requests
            logger.debug("Using requests for HTTP requests")
            return 'requests'
        except ImportError:
            pass
        
        logger.warning("No HTTP library found. Install aiohttp, httpx, or requests")
        return None
    
    def _get_html_parser(self):
        """Get available HTML parser"""
        
        # Try BeautifulSoup first - most comprehensive
        try:
            from bs4 import BeautifulSoup
            logger.debug("Using BeautifulSoup for HTML parsing")
            return 'beautifulsoup'
        except ImportError:
            pass
        
        # Try lxml as fallback
        try:
            import lxml.html
            logger.debug("Using lxml for HTML parsing")
            return 'lxml'
        except ImportError:
            pass
        
        # Use html.parser as last resort (built-in)
        import html.parser
        logger.debug("Using html.parser for HTML parsing")
        return 'html.parser'
    
    async def read(self, source: Union[str, Path]) -> List[Document]:
        """Read web content from URL and return documents
        
        Args:
            source: URL to read
            
        Returns:
            List containing single document with extracted content
            
        Raises:
            ImportError: If no HTTP library is available
            Exception: If web request fails
        """
        
        if not self._http_library:
            raise ImportError(
                "No HTTP library available. Install one of: "
                "aiohttp (pip install aiohttp), "
                "httpx (pip install httpx), "
                "requests (pip install requests)"
            )
        
        url = str(source)
        
        # Validate URL
        parsed_url = urlparse(url)
        if not parsed_url.scheme or not parsed_url.netloc:
            raise ValueError(f"Invalid URL: {url}")
        
        # Fetch content
        if self._http_library == 'aiohttp':
            html_content, response_info = await self._fetch_with_aiohttp(url)
        elif self._http_library == 'httpx':
            html_content, response_info = await self._fetch_with_httpx(url)
        elif self._http_library == 'requests':
            html_content, response_info = await self._fetch_with_requests(url)
        else:
            raise ImportError("No supported HTTP library found")
        
        # Parse HTML content
        text_content, extracted_data = await self._parse_html(html_content)
        
        # Create document metadata
        metadata = DocumentMetadata(
            name=parsed_url.path.split('/')[-1] or parsed_url.netloc,
            source=url,
            source_type='web',
            content_type=response_info.get('content_type', 'text/html'),
            size=len(text_content.encode('utf-8')),
            reader_name=self.__class__.__name__
        )
        
        # Add web-specific metadata
        metadata.custom.update({
            'url': url,
            'domain': parsed_url.netloc,
            'status_code': response_info.get('status_code'),
            'response_headers': response_info.get('headers', {}),
            **extracted_data
        })
        
        # Create document
        document = Document(content=text_content, metadata=metadata)
        
        logger.debug(f"Read web content: {url} ({len(text_content)} characters)")
        return [document]
    
    async def _fetch_with_aiohttp(self, url: str) -> tuple[str, dict]:
        """Fetch content using aiohttp"""
        
        import aiohttp
        
        timeout = aiohttp.ClientTimeout(total=self.timeout)
        
        for attempt in range(self.max_retries):
            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.get(url, headers=self.headers) as response:
                        response.raise_for_status()
                        
                        content = await response.text()
                        
                        response_info = {
                            'status_code': response.status,
                            'content_type': response.content_type,
                            'headers': dict(response.headers)
                        }
                        
                        return content, response_info
            
            except Exception as e:
                if attempt == self.max_retries - 1:
                    raise
                logger.warning(f"Attempt {attempt + 1} failed for {url}: {e}")
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
    
    async def _fetch_with_httpx(self, url: str) -> tuple[str, dict]:
        """Fetch content using httpx"""
        
        import httpx
        
        for attempt in range(self.max_retries):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.get(url, headers=self.headers)
                    response.raise_for_status()
                    
                    content = response.text
                    
                    response_info = {
                        'status_code': response.status_code,
                        'content_type': response.headers.get('content-type', ''),
                        'headers': dict(response.headers)
                    }
                    
                    return content, response_info
            
            except Exception as e:
                if attempt == self.max_retries - 1:
                    raise
                logger.warning(f"Attempt {attempt + 1} failed for {url}: {e}")
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
    
    async def _fetch_with_requests(self, url: str) -> tuple[str, dict]:
        """Fetch content using requests (synchronous)"""
        
        def _fetch():
            import requests
            
            for attempt in range(self.max_retries):
                try:
                    response = requests.get(
                        url,
                        headers=self.headers,
                        timeout=self.timeout
                    )
                    response.raise_for_status()
                    
                    content = response.text
                    
                    response_info = {
                        'status_code': response.status_code,
                        'content_type': response.headers.get('content-type', ''),
                        'headers': dict(response.headers)
                    }
                    
                    return content, response_info
                
                except Exception as e:
                    if attempt == self.max_retries - 1:
                        raise
                    logger.warning(f"Attempt {attempt + 1} failed for {url}: {e}")
                    import time
                    time.sleep(2 ** attempt)  # Exponential backoff
        
        # Run in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _fetch)
    
    async def _parse_html(self, html_content: str) -> tuple[str, dict]:
        """Parse HTML content and extract text"""
        
        def _parse():
            extracted_data = {}
            
            if self._html_parser == 'beautifulsoup':
                from bs4 import BeautifulSoup
                
                soup = BeautifulSoup(html_content, 'html.parser')
                
                # Extract title
                title_tag = soup.find('title')
                if title_tag:
                    extracted_data['title'] = title_tag.get_text().strip()
                
                # Extract meta description
                meta_desc = soup.find('meta', attrs={'name': 'description'})
                if meta_desc:
                    extracted_data['description'] = meta_desc.get('content', '').strip()
                
                # Extract links if requested
                if self.extract_links:
                    links = [a.get('href') for a in soup.find_all('a', href=True)]
                    extracted_data['links'] = [link for link in links if link]
                
                # Extract images if requested
                if self.extract_images:
                    images = [img.get('src') for img in soup.find_all('img', src=True)]
                    extracted_data['images'] = [img for img in images if img]
                
                # Remove script and style elements
                for script in soup(["script", "style"]):
                    script.decompose()
                
                # Get text content
                text = soup.get_text()
                
            elif self._html_parser == 'lxml':
                import lxml.html
                
                doc = lxml.html.fromstring(html_content)
                
                # Extract title
                title_elements = doc.xpath('//title/text()')
                if title_elements:
                    extracted_data['title'] = title_elements[0].strip()
                
                # Extract meta description
                meta_desc = doc.xpath('//meta[@name="description"]/@content')
                if meta_desc:
                    extracted_data['description'] = meta_desc[0].strip()
                
                # Extract links if requested
                if self.extract_links:
                    links = doc.xpath('//a/@href')
                    extracted_data['links'] = [link for link in links if link]
                
                # Extract images if requested
                if self.extract_images:
                    images = doc.xpath('//img/@src')
                    extracted_data['images'] = [img for img in images if img]
                
                # Get text content
                text = doc.text_content()
                
            else:
                # Basic HTML parsing
                import re
                
                # Extract title
                title_match = re.search(r'<title[^>]*>([^<]+)</title>', html_content, re.IGNORECASE)
                if title_match:
                    extracted_data['title'] = title_match.group(1).strip()
                
                # Remove HTML tags
                text = re.sub(r'<[^>]+>', '', html_content)
                
                # Extract links if requested
                if self.extract_links:
                    link_matches = re.findall(r'href=["\']([^"\'>]+)["\']', html_content, re.IGNORECASE)
                    extracted_data['links'] = link_matches
                
                # Extract images if requested
                if self.extract_images:
                    img_matches = re.findall(r'src=["\']([^"\'>]+)["\']', html_content, re.IGNORECASE)
                    extracted_data['images'] = img_matches
            
            # Clean up text
            lines = text.split('\n')
            cleaned_lines = [line.strip() for line in lines if line.strip()]
            cleaned_text = '\n'.join(cleaned_lines)
            
            return cleaned_text, extracted_data
        
        # Run in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _parse)
    
    def supports_source(self, source: Any) -> bool:
        """Check if this reader supports the given source
        
        Args:
            source: Source to check
            
        Returns:
            True if supported
        """
        
        if isinstance(source, str):
            return source.startswith(('http://', 'https://'))
        
        return False
    
    def get_supported_schemes(self) -> List[str]:
        """Get list of supported URL schemes
        
        Returns:
            List of supported schemes
        """
        
        return ['http', 'https']
    
    def __str__(self) -> str:
        return f"WebReader(library={self._http_library}, parser={self._html_parser})"