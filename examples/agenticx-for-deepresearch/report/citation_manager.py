"""AgenticX-based citation management task

This module implements CitationManagerTask, responsible for managing citation formats and source tracking,
strictly following the AgenticX framework's Task abstraction.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
import re
import logging
from urllib.parse import urlparse
from pydantic import Field
from agenticx.core.task import Task
from agenticx.core.message import Message
from models import Citation, SearchResult, ResearchReport


class CitationManagerTask(Task):
    """Citation management task
    
    Based on agenticx.core.Task implementation, responsible for:
    1. Creating and managing citations
    2. Formatting reference literature
    3. Validating citation integrity
    4. Supporting multiple citation formats
    """
    
    citation_format: str = Field(default="APA", description="Citation format")
    supported_formats: List[str] = Field(default_factory=lambda: ["APA", "MLA", "Chicago", "IEEE"], description="Supported citation formats")
    
    def __init__(self, description: str, expected_output: str, citation_format: str = "APA", **kwargs):
        supported_formats = ["APA", "MLA", "Chicago", "IEEE"]
        
        if citation_format not in supported_formats:
            raise ValueError(f"Unsupported citation format: {citation_format}. Supported formats: {supported_formats}")
        
        super().__init__(
            description=description, 
            expected_output=expected_output, 
            **kwargs
        )
        
        # Set instance attributes after calling super()
        self.citation_format = citation_format
        self.supported_formats = supported_formats
        
        # Initialize logger
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    async def execute(self, **kwargs) -> Dict[str, Any]:
        """Execute citation management task"""
        action = kwargs.get("action", "create_citations")
        
        if action == "create_citations":
            return await self._create_citations_from_results(kwargs.get("search_results", []))
        elif action == "format_citations":
            return await self._format_citations(kwargs.get("citations", []))
        elif action == "validate_citations":
            return await self._validate_citations(kwargs.get("citations", []))
        elif action == "merge_citations":
            return await self._merge_duplicate_citations(kwargs.get("citations", []))
        else:
            raise ValueError(f"Unsupported operation: {action}")
    
    async def _create_citations_from_results(self, search_results: List[SearchResult]) -> Dict[str, Any]:
        """Create citations from search results"""
        citations = []
        
        for result in search_results:
            citation = await self._create_citation_from_result(result)
            if citation:
                citations.append(citation)
        
        return {
            "citations": citations,
            "count": len(citations),
            "format": self.citation_format
        }
    
    async def _create_citation_from_result(self, result: SearchResult) -> Optional[Citation]:
        """Create citation from a single search result"""
        try:
            # Try to extract more information from URL
            domain_info = self._extract_domain_info(result.url)
            
            # Try to extract author information from title
            author = self._extract_author_from_title(result.title)
            
            # Try to extract publication date from content
            publication_date = self._extract_publication_date(result.snippet, result.content)
            
            # Prepare metadata
            metadata = {
                "domain": domain_info.get("domain"),
                "domain_type": domain_info.get("type"),
                "search_engine": result.source.value,
                "relevance_score": result.relevance_score
            }
            
            citation = Citation(
                source_url=result.url,
                title=self._clean_title(result.title),
                author=author,
                publication_date=publication_date,
                access_date=result.timestamp,
                citation_format=self.citation_format,
                metadata=metadata
            )
            
            return citation
            
        except Exception as e:
            self.logger.error(f"Failed to create citation: {e}")
            return None
    
    async def _format_citations(self, citations: List[Citation]) -> Dict[str, Any]:
        """Format citation list"""
        formatted_citations = []
        
        for i, citation in enumerate(citations, 1):
            formatted = self._format_single_citation(citation, i)
            formatted_citations.append({
                "index": i,
                "citation": citation,
                "formatted": formatted
            })
        
        return {
            "formatted_citations": formatted_citations,
            "bibliography": self._create_bibliography(citations),
            "format": self.citation_format
        }
    
    def _format_single_citation(self, citation: Citation, index: int) -> str:
        """Format single citation"""
        if self.citation_format == "APA":
            return self._format_apa_citation(citation)
        elif self.citation_format == "MLA":
            return self._format_mla_citation(citation)
        elif self.citation_format == "Chicago":
            return self._format_chicago_citation(citation)
        elif self.citation_format == "IEEE":
            return self._format_ieee_citation(citation, index)
        else:
            return citation.format_citation()
    
    def _format_apa_citation(self, citation: Citation) -> str:
        """APA format citation"""
        parts = []
        
        # Author
        if citation.author:
            parts.append(f"{citation.author}.")
        
        # Date
        if citation.publication_date:
            year = citation.publication_date.year
            parts.append(f"({year}).")
        else:
            parts.append("(n.d.).")
        
        # Title
        parts.append(f"{citation.title}.")
        
        # Source
        domain = urlparse(citation.source_url).netloc
        parts.append(f"Retrieved from {domain}")
        
        # URL
        parts.append(citation.source_url)
        
        return " ".join(parts)
    
    def _format_mla_citation(self, citation: Citation) -> str:
        """MLA format citation"""
        parts = []
        
        # Author
        if citation.author:
            parts.append(f'{citation.author}.')
        
        # Title
        parts.append(f'"{citation.title}."')
        
        # Website name
        domain = urlparse(citation.source_url).netloc
        parts.append(f'{domain},')
        
        # Publication date
        if citation.publication_date:
            date_str = citation.publication_date.strftime("%d %b %Y")
            parts.append(f'{date_str},')
        
        # Access date
        access_date = citation.access_date.strftime("%d %b %Y")
        parts.append(f'Web. {access_date}.')
        
        return " ".join(parts)
    
    def _format_chicago_citation(self, citation: Citation) -> str:
        """Chicago format citation"""
        parts = []
        
        # Author
        if citation.author:
            parts.append(f'{citation.author}.')
        
        # Title
        parts.append(f'"{citation.title}."')
        
        # Website
        domain = urlparse(citation.source_url).netloc
        parts.append(f'Accessed {citation.access_date.strftime("%B %d, %Y")}.')
        
        # URL
        parts.append(citation.source_url)
        
        return " ".join(parts)
    
    def _format_ieee_citation(self, citation: Citation, index: int) -> str:
        """IEEE format citation"""
        parts = [f"[{index}]"]
        
        # Author
        if citation.author:
            parts.append(f'{citation.author},')
        
        # Title
        parts.append(f'"{citation.title},"')
        
        # Website and date
        domain = urlparse(citation.source_url).netloc
        if citation.publication_date:
            date_str = citation.publication_date.strftime("%Y")
            parts.append(f'{domain}, {date_str}.')
        else:
            parts.append(f'{domain}.')
        
        # Access information
        access_date = citation.access_date.strftime("%b. %d, %Y")
        parts.append(f'[Online]. Available: {citation.source_url}. [Accessed: {access_date}]')
        
        return " ".join(parts)
    
    def _create_bibliography(self, citations: List[Citation]) -> str:
        """Create bibliography list"""
        if not citations:
            return ""
        
        bibliography = "## References\n\n"
        
        for i, citation in enumerate(citations, 1):
            formatted = self._format_single_citation(citation, i)
            bibliography += f"{formatted}\n\n"
        
        return bibliography
    
    async def _validate_citations(self, citations: List[Citation]) -> Dict[str, Any]:
        """Validate citation integrity"""
        validation_results = []
        
        for citation in citations:
            result = self._validate_single_citation(citation)
            validation_results.append(result)
        
        # Count validation results
        valid_count = sum(1 for r in validation_results if r["is_valid"])
        
        return {
            "validation_results": validation_results,
            "valid_count": valid_count,
            "total_count": len(citations),
            "validity_rate": valid_count / len(citations) if citations else 0
        }
    
    def _validate_single_citation(self, citation: Citation) -> Dict[str, Any]:
        """Validate single citation"""
        issues = []
        
        # Check required fields
        if not citation.title or citation.title.strip() == "":
            issues.append("Missing title")
        
        if not citation.source_url or citation.source_url.strip() == "":
            issues.append("Missing URL")
        
        # Check URL format
        if citation.source_url and not self._is_valid_url(citation.source_url):
            issues.append("Invalid URL format")
        
        # Check dates
        if citation.access_date > datetime.now():
            issues.append("Access date cannot be in the future")
        
        if (citation.publication_date and 
            citation.publication_date > datetime.now()):
            issues.append("Publication date cannot be in the future")
        
        return {
            "citation": citation,
            "is_valid": len(issues) == 0,
            "issues": issues
        }
    
    async def _merge_duplicate_citations(self, citations: List[Citation]) -> Dict[str, Any]:
        """Merge duplicate citations"""
        unique_citations = []
        seen_urls = set()
        duplicates = []
        
        for citation in citations:
            if citation.source_url in seen_urls:
                duplicates.append(citation)
            else:
                unique_citations.append(citation)
                seen_urls.add(citation.source_url)
        
        return {
            "unique_citations": unique_citations,
            "duplicates": duplicates,
            "original_count": len(citations),
            "unique_count": len(unique_citations),
            "duplicate_count": len(duplicates)
        }
    
    def _extract_domain_info(self, url: str) -> Dict[str, str]:
        """Extract domain information"""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            
            # Determine domain type
            domain_type = "unknown"
            if any(academic in domain for academic in [".edu", ".ac.", "scholar", "researchgate"]):
                domain_type = "academic"
            elif any(news in domain for news in ["news", "times", "post", "guardian"]):
                domain_type = "news"
            elif any(gov in domain for gov in [".gov", ".org"]):
                domain_type = "official"
            elif "wikipedia" in domain:
                domain_type = "encyclopedia"
            else:
                domain_type = "general"
            
            return {
                "domain": domain,
                "type": domain_type
            }
        except:
            return {"domain": "unknown", "type": "unknown"}
    
    def _extract_author_from_title(self, title: str) -> Optional[str]:
        """Extract author information from title"""
        # Simple author extraction logic
        # More complex algorithms can be implemented as needed
        
        # Look for common author patterns
        author_patterns = [
            r'by\s+([A-Za-z\s]+)',
            r'Author[：:]\s*([\u4e00-\u9fa5A-Za-z\s]+)',
            r'([A-Za-z\s]+)\s*[：:]',
        ]
        
        for pattern in author_patterns:
            match = re.search(pattern, title, re.IGNORECASE)
            if match:
                author = match.group(1).strip()
                if len(author) > 2 and len(author) < 50:  # Reasonable author name length
                    return author
        
        return None
    
    def _extract_publication_date(self, snippet: str, content: Optional[str] = None) -> Optional[datetime]:
        """Extract publication date"""
        text = (snippet or "") + " " + (content or "")
        
        # Date patterns
        date_patterns = [
            r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})',
            r'(\d{1,2})[-/](\d{1,2})[-/](\d{4})',
            r'(\d{4})年(\d{1,2})月(\d{1,2})日',
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, text)
            if match:
                try:
                    groups = match.groups()
                    if len(groups) == 3:
                        # Try different date formats
                        if len(groups[0]) == 4:  # YYYY-MM-DD
                            year, month, day = int(groups[0]), int(groups[1]), int(groups[2])
                        else:  # MM-DD-YYYY or DD-MM-YYYY
                            year, month, day = int(groups[2]), int(groups[0]), int(groups[1])
                        
                        return datetime(year, month, day)
                except (ValueError, TypeError):
                    continue
        
        return None
    
    def _clean_title(self, title: str) -> str:
        """Clean title"""
        # Remove extra whitespace characters
        title = re.sub(r'\s+', ' ', title.strip())
        
        # Remove common website suffixes
        suffixes = [' - Google Search', ' - Bing', ' | Wikipedia', ' - Baidu']
        for suffix in suffixes:
            if title.endswith(suffix):
                title = title[:-len(suffix)]
        
        return title
    
    def _is_valid_url(self, url: str) -> bool:
        """Validate URL format"""
        try:
            result = urlparse(url)
            return all([result.scheme, result.netloc])
        except:
            return False