"""Content extraction framework for AgenticX Knowledge Management System

This module provides comprehensive content extraction capabilities including
text content, structural elements, metadata, and content type detection.
"""

import logging
import mimetypes
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, Tuple
from datetime import datetime, timezone, UTC

from .document import Document, DocumentMetadata

logger = logging.getLogger(__name__)


class ContentType(Enum):
    """Content type enumeration"""
    TEXT = "text"
    PDF = "pdf"
    HTML = "html"
    XML = "xml"
    JSON = "json"
    CSV = "csv"
    MARKDOWN = "markdown"
    CODE = "code"
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"
    ARCHIVE = "archive"
    BINARY = "binary"
    UNKNOWN = "unknown"


class StructuralElementType(Enum):
    """Types of structural elements in documents"""
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST = "list"
    LIST_ITEM = "list_item"
    TABLE = "table"
    TABLE_ROW = "table_row"
    TABLE_CELL = "table_cell"
    CODE_BLOCK = "code_block"
    QUOTE = "quote"
    LINK = "link"
    IMAGE = "image"
    FORMULA = "formula"
    FOOTNOTE = "footnote"
    SECTION = "section"
    METADATA = "metadata"


@dataclass
class StructuralElement:
    """Represents a structural element in a document"""
    element_type: StructuralElementType
    content: str
    level: Optional[int] = None  # For headings, list nesting, etc.
    attributes: Dict[str, Any] = field(default_factory=dict)
    position: Optional[Tuple[int, int]] = None  # (start, end) character positions
    children: List['StructuralElement'] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation"""
        return {
            'element_type': self.element_type.value,
            'content': self.content,
            'level': self.level,
            'attributes': self.attributes,
            'position': self.position,
            'children': [child.to_dict() for child in self.children],
            'metadata': self.metadata
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StructuralElement':
        """Create from dictionary representation"""
        children = [cls.from_dict(child) for child in data.get('children', [])]
        return cls(
            element_type=StructuralElementType(data['element_type']),
            content=data['content'],
            level=data.get('level'),
            attributes=data.get('attributes', {}),
            position=tuple(data['position']) if data.get('position') else None,
            children=children,
            metadata=data.get('metadata', {})
        )


@dataclass
class ExtractionResult:
    """Result of content extraction"""
    text_content: str
    structural_elements: List[StructuralElement] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    content_type: Optional[ContentType] = None
    extraction_time: float = 0.0
    success: bool = True
    error: Optional[str] = None
    
    def get_elements_by_type(self, element_type: StructuralElementType) -> List[StructuralElement]:
        """Get all elements of a specific type"""
        elements = []
        for element in self.structural_elements:
            if element.element_type == element_type:
                elements.append(element)
            # Recursively search children
            elements.extend(self._search_children(element, element_type))
        return elements
    
    def _search_children(self, element: StructuralElement, target_type: StructuralElementType) -> List[StructuralElement]:
        """Recursively search for elements in children"""
        elements = []
        for child in element.children:
            if child.element_type == target_type:
                elements.append(child)
            elements.extend(self._search_children(child, target_type))
        return elements
    
    def get_headings(self) -> List[StructuralElement]:
        """Get all heading elements"""
        return self.get_elements_by_type(StructuralElementType.HEADING)
    
    def get_tables(self) -> List[StructuralElement]:
        """Get all table elements"""
        return self.get_elements_by_type(StructuralElementType.TABLE)
    
    def get_code_blocks(self) -> List[StructuralElement]:
        """Get all code block elements"""
        return self.get_elements_by_type(StructuralElementType.CODE_BLOCK)


class BaseContentExtractor(ABC):
    """Abstract base class for content extractors"""
    
    def __init__(self, name: Optional[str] = None):
        self.name = name or self.__class__.__name__
    
    @abstractmethod
    async def extract_text_content(self, document: Document) -> str:
        """Extract plain text content from document
        
        Args:
            document: Document to extract from
            
        Returns:
            Extracted text content
        """
        pass
    
    @abstractmethod
    async def extract_structural_elements(self, document: Document) -> List[StructuralElement]:
        """Extract structural elements from document
        
        Args:
            document: Document to extract from
            
        Returns:
            List of structural elements
        """
        pass
    
    @abstractmethod
    async def extract_metadata(self, document: Document) -> Dict[str, Any]:
        """Extract metadata from document
        
        Args:
            document: Document to extract from
            
        Returns:
            Extracted metadata
        """
        pass
    
    @abstractmethod
    def detect_content_type(self, file_path: str) -> ContentType:
        """Detect content type of file
        
        Args:
            file_path: Path to file
            
        Returns:
            Detected content type
        """
        pass


class TextContentExtractor(BaseContentExtractor):
    """Content extractor for plain text documents"""
    
    def __init__(self):
        super().__init__()
    
    async def extract_text_content(self, document: Document) -> str:
        """Extract text content (already available in document)"""
        return document.content
    
    async def extract_structural_elements(self, document: Document) -> List[StructuralElement]:
        """Extract structural elements from text"""
        elements = []
        content = document.content
        lines = content.split('\n')
        
        current_position = 0
        for i, line in enumerate(lines):
            line_start = current_position
            line_end = current_position + len(line)
            
            # Detect headings (markdown style)
            if line.strip().startswith('#'):
                level = len(line) - len(line.lstrip('#'))
                heading_text = line.lstrip('#').strip()
                elements.append(StructuralElement(
                    element_type=StructuralElementType.HEADING,
                    content=heading_text,
                    level=level,
                    position=(line_start, line_end),
                    metadata={'line_number': i + 1}
                ))
            
            # Detect code blocks
            elif line.strip().startswith('```'):
                # Find end of code block
                code_lines = [line]
                j = i + 1
                while j < len(lines) and not lines[j].strip().startswith('```'):
                    code_lines.append(lines[j])
                    j += 1
                if j < len(lines):
                    code_lines.append(lines[j])
                
                code_content = '\n'.join(code_lines)
                elements.append(StructuralElement(
                    element_type=StructuralElementType.CODE_BLOCK,
                    content=code_content,
                    position=(line_start, line_start + len(code_content)),
                    metadata={'line_number': i + 1, 'language': line.strip()[3:]}
                ))
            
            # Detect lists
            elif re.match(r'^\s*[-*+]\s+', line) or re.match(r'^\s*\d+\.\s+', line):
                list_text = line.strip()
                elements.append(StructuralElement(
                    element_type=StructuralElementType.LIST_ITEM,
                    content=list_text,
                    position=(line_start, line_end),
                    metadata={'line_number': i + 1}
                ))
            
            # Regular paragraphs
            elif line.strip():
                elements.append(StructuralElement(
                    element_type=StructuralElementType.PARAGRAPH,
                    content=line.strip(),
                    position=(line_start, line_end),
                    metadata={'line_number': i + 1}
                ))
            
            current_position = line_end + 1  # +1 for newline
        
        return elements
    
    async def extract_metadata(self, document: Document) -> Dict[str, Any]:
        """Extract metadata from text document"""
        content = document.content
        
        metadata = {
            'character_count': len(content),
            'word_count': len(content.split()),
            'line_count': len(content.split('\n')),
            'paragraph_count': len([p for p in content.split('\n\n') if p.strip()]),
            'extracted_at': datetime.now(timezone.utc).isoformat(),
            'extractor': self.name
        }
        
        # Detect language (simple heuristic)
        if re.search(r'[\u4e00-\u9fff]', content):
            metadata['detected_language'] = 'zh'
        elif re.search(r'[a-zA-Z]', content):
            metadata['detected_language'] = 'en'
        else:
            metadata['detected_language'] = 'unknown'
        
        # Detect if it's code
        code_indicators = ['def ', 'class ', 'import ', 'function ', 'var ', 'const ']
        if any(indicator in content for indicator in code_indicators):
            metadata['content_category'] = 'code'
        elif content.count('#') > 3:  # Many headings
            metadata['content_category'] = 'documentation'
        else:
            metadata['content_category'] = 'text'
        
        return metadata
    
    def detect_content_type(self, file_path: str) -> ContentType:
        """Detect content type based on file extension and content"""
        path = Path(file_path)
        extension = path.suffix.lower()
        
        # Map extensions to content types
        extension_map = {
            '.txt': ContentType.TEXT,
            '.md': ContentType.MARKDOWN,
            '.markdown': ContentType.MARKDOWN,
            '.py': ContentType.CODE,
            '.js': ContentType.CODE,
            '.ts': ContentType.CODE,
            '.java': ContentType.CODE,
            '.cpp': ContentType.CODE,
            '.c': ContentType.CODE,
            '.html': ContentType.HTML,
            '.htm': ContentType.HTML,
            '.xml': ContentType.XML,
            '.json': ContentType.JSON,
            '.csv': ContentType.CSV,
            '.pdf': ContentType.PDF,
        }
        
        if extension in extension_map:
            return extension_map[extension]
        
        # Use mimetypes for additional detection
        mime_type, _ = mimetypes.guess_type(file_path)
        if mime_type:
            if mime_type.startswith('text/'):
                return ContentType.TEXT
            elif mime_type.startswith('image/'):
                return ContentType.IMAGE
            elif mime_type.startswith('audio/'):
                return ContentType.AUDIO
            elif mime_type.startswith('video/'):
                return ContentType.VIDEO
        
        return ContentType.UNKNOWN


class MarkdownContentExtractor(BaseContentExtractor):
    """Content extractor specialized for Markdown documents"""
    
    def __init__(self):
        super().__init__()
    
    async def extract_text_content(self, document: Document) -> str:
        """Extract plain text from markdown, removing formatting"""
        content = document.content
        
        # Remove markdown formatting
        # Remove headers
        content = re.sub(r'^#{1,6}\s+', '', content, flags=re.MULTILINE)
        # Remove bold/italic
        content = re.sub(r'\*\*(.*?)\*\*', r'\1', content)
        content = re.sub(r'\*(.*?)\*', r'\1', content)
        # Remove links
        content = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', content)
        # Remove code blocks
        content = re.sub(r'```.*?```', '', content, flags=re.DOTALL)
        # Remove inline code
        content = re.sub(r'`([^`]+)`', r'\1', content)
        
        return content.strip()
    
    async def extract_structural_elements(self, document: Document) -> List[StructuralElement]:
        """Extract structural elements from markdown"""
        elements = []
        content = document.content
        lines = content.split('\n')
        
        current_position = 0
        in_code_block = False
        code_block_lines = []
        code_block_start = 0
        
        for i, line in enumerate(lines):
            line_start = current_position
            line_end = current_position + len(line)
            
            # Handle code blocks
            if line.strip().startswith('```'):
                if not in_code_block:
                    # Start of code block
                    in_code_block = True
                    code_block_lines = [line]
                    code_block_start = line_start
                    language = line.strip()[3:].strip()
                else:
                    # End of code block
                    code_block_lines.append(line)
                    code_content = '\n'.join(code_block_lines)
                    elements.append(StructuralElement(
                        element_type=StructuralElementType.CODE_BLOCK,
                        content=code_content,
                        position=(code_block_start, line_end),
                        attributes={'language': language if 'language' in locals() else ''},
                        metadata={'line_number': i + 1}
                    ))
                    in_code_block = False
                    code_block_lines = []
            elif in_code_block:
                code_block_lines.append(line)
            
            # Skip processing if inside code block
            elif not in_code_block:
                # Detect headings
                if line.strip().startswith('#'):
                    level = len(line) - len(line.lstrip('#'))
                    heading_text = line.lstrip('#').strip()
                    elements.append(StructuralElement(
                        element_type=StructuralElementType.HEADING,
                        content=heading_text,
                        level=level,
                        position=(line_start, line_end),
                        metadata={'line_number': i + 1}
                    ))
                
                # Detect lists
                elif re.match(r'^\s*[-*+]\s+', line):
                    list_text = line.strip()[2:].strip()  # Remove bullet
                    indent_level = (len(line) - len(line.lstrip())) // 2
                    elements.append(StructuralElement(
                        element_type=StructuralElementType.LIST_ITEM,
                        content=list_text,
                        level=indent_level,
                        position=(line_start, line_end),
                        metadata={'line_number': i + 1, 'list_type': 'unordered'}
                    ))
                
                elif re.match(r'^\s*\d+\.\s+', line):
                    list_text = re.sub(r'^\s*\d+\.\s+', '', line).strip()
                    indent_level = (len(line) - len(line.lstrip())) // 2
                    elements.append(StructuralElement(
                        element_type=StructuralElementType.LIST_ITEM,
                        content=list_text,
                        level=indent_level,
                        position=(line_start, line_end),
                        metadata={'line_number': i + 1, 'list_type': 'ordered'}
                    ))
                
                # Detect quotes
                elif line.strip().startswith('>'):
                    quote_text = line.lstrip('>').strip()
                    elements.append(StructuralElement(
                        element_type=StructuralElementType.QUOTE,
                        content=quote_text,
                        position=(line_start, line_end),
                        metadata={'line_number': i + 1}
                    ))
                
                # Detect links
                elif '[' in line and '](' in line:
                    links = re.findall(r'\[([^\]]+)\]\(([^\)]+)\)', line)
                    for link_text, link_url in links:
                        elements.append(StructuralElement(
                            element_type=StructuralElementType.LINK,
                            content=link_text,
                            attributes={'url': link_url},
                            position=(line_start, line_end),
                            metadata={'line_number': i + 1}
                        ))
                
                # Regular paragraphs
                elif line.strip():
                    elements.append(StructuralElement(
                        element_type=StructuralElementType.PARAGRAPH,
                        content=line.strip(),
                        position=(line_start, line_end),
                        metadata={'line_number': i + 1}
                    ))
            
            current_position = line_end + 1
        
        return elements
    
    async def extract_metadata(self, document: Document) -> Dict[str, Any]:
        """Extract metadata from markdown document"""
        content = document.content
        
        # Basic text statistics
        metadata = {
            'character_count': len(content),
            'word_count': len(content.split()),
            'line_count': len(content.split('\n')),
            'extracted_at': datetime.now(UTC).isoformat(),
            'extractor': self.name,
            'format': 'markdown'
        }
        
        # Count markdown elements
        metadata['heading_count'] = len(re.findall(r'^#{1,6}\s+', content, re.MULTILINE))
        metadata['code_block_count'] = content.count('```') // 2
        metadata['link_count'] = len(re.findall(r'\[([^\]]+)\]\([^\)]+\)', content))
        metadata['image_count'] = len(re.findall(r'!\[([^\]]*)\]\([^\)]+\)', content))
        
        # Extract title (first heading)
        title_match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
        if title_match:
            metadata['title'] = title_match.group(1).strip()
        
        # Extract front matter if present
        if content.startswith('---'):
            front_matter_match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
            if front_matter_match:
                metadata['has_front_matter'] = True
                # Simple YAML-like parsing
                front_matter = front_matter_match.group(1)
                for line in front_matter.split('\n'):
                    if ':' in line:
                        key, value = line.split(':', 1)
                        metadata[f'fm_{key.strip()}'] = value.strip()
        
        return metadata
    
    def detect_content_type(self, file_path: str) -> ContentType:
        """Detect if file is markdown"""
        path = Path(file_path)
        extension = path.suffix.lower()
        
        if extension in ['.md', '.markdown']:
            return ContentType.MARKDOWN
        
        # Check content for markdown patterns
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read(1000)  # Read first 1000 chars
                if re.search(r'^#{1,6}\s+', content, re.MULTILINE) or '```' in content:
                    return ContentType.MARKDOWN
        except:
            pass
        
        return ContentType.TEXT


class ContentExtractor:
    """Unified content extractor with multiple specialized extractors"""
    
    def __init__(self):
        self.extractors: Dict[ContentType, BaseContentExtractor] = {
            ContentType.TEXT: TextContentExtractor(),
            ContentType.MARKDOWN: MarkdownContentExtractor(),
            ContentType.CODE: TextContentExtractor(),  # Use text extractor for code
        }
        
        # Default extractor for unknown types
        self.default_extractor = TextContentExtractor()
    
    def register_extractor(self, content_type: ContentType, extractor: BaseContentExtractor):
        """Register a custom extractor for a content type"""
        self.extractors[content_type] = extractor
        logger.info(f"Registered extractor {extractor.name} for {content_type.value}")
    
    async def extract_text_content(self, document: Document) -> str:
        """Extract text content from document"""
        extractor = self._get_extractor(document)
        return await extractor.extract_text_content(document)
    
    async def extract_structural_elements(self, document: Document) -> List[StructuralElement]:
        """Extract structural elements from document"""
        extractor = self._get_extractor(document)
        return await extractor.extract_structural_elements(document)
    
    async def extract_metadata(self, document: Document) -> Dict[str, Any]:
        """Extract metadata from document"""
        extractor = self._get_extractor(document)
        return await extractor.extract_metadata(document)
    
    def detect_content_type(self, file_path: str) -> ContentType:
        """Detect content type of file"""
        # Try each extractor's detection method
        for extractor in self.extractors.values():
            content_type = extractor.detect_content_type(file_path)
            if content_type != ContentType.UNKNOWN:
                return content_type
        
        # Fallback to default detection
        return self.default_extractor.detect_content_type(file_path)
    
    async def extract_all(self, document: Document) -> ExtractionResult:
        """Extract all content types from document"""
        import time
        start_time = time.time()
        
        try:
            # Detect content type if not set
            content_type = None
            if document.metadata.source:
                content_type = self.detect_content_type(document.metadata.source)
            
            # Extract all content
            text_content = await self.extract_text_content(document)
            structural_elements = await self.extract_structural_elements(document)
            metadata = await self.extract_metadata(document)
            
            extraction_time = time.time() - start_time
            
            return ExtractionResult(
                text_content=text_content,
                structural_elements=structural_elements,
                metadata=metadata,
                content_type=content_type,
                extraction_time=extraction_time,
                success=True
            )
            
        except Exception as e:
            extraction_time = time.time() - start_time
            logger.error(f"Content extraction failed: {e}")
            
            return ExtractionResult(
                text_content=document.content,  # Fallback to original content
                extraction_time=extraction_time,
                success=False,
                error=str(e)
            )
    
    def _get_extractor(self, document: Document) -> BaseContentExtractor:
        """Get appropriate extractor for document"""
        # Try to detect content type from source
        if document.metadata.source:
            content_type = self.detect_content_type(document.metadata.source)
            if content_type in self.extractors:
                return self.extractors[content_type]
        
        # Check content type from metadata
        if document.metadata.content_type:
            for content_type, extractor in self.extractors.items():
                if content_type.value in document.metadata.content_type:
                    return extractor
        
        # Default to text extractor
        return self.default_extractor
    
    def get_supported_types(self) -> List[ContentType]:
        """Get list of supported content types"""
        return list(self.extractors.keys())
    
    def __str__(self) -> str:
        return f"ContentExtractor(extractors={len(self.extractors)})"