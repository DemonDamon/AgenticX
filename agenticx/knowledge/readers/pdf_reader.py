"""PDF file reader for AgenticX Knowledge Management System"""

import asyncio
import logging
from pathlib import Path
from typing import List, Optional, Union, Any

from ..base import BaseReader
from ..document import Document, DocumentMetadata

logger = logging.getLogger(__name__)


class PDFReader(BaseReader):
    """Reader for PDF files"""
    
    def __init__(
        self,
        extract_images: bool = False,
        extract_tables: bool = False,
        page_range: Optional[tuple] = None,
        password: Optional[str] = None,
        **kwargs
    ):
        """
        Initialize PDFReader
        
        Args:
            extract_images: Whether to extract images from PDF
            extract_tables: Whether to extract tables from PDF
            page_range: Tuple of (start_page, end_page) to extract
            password: PDF password if encrypted
            **kwargs: Additional configuration
        """
        self.extract_images = extract_images
        self.extract_tables = extract_tables
        self.page_range = page_range
        self.password = password
        self.config = kwargs
        
        # Try to import required libraries
        self._pdf_library = self._get_pdf_library()
    
    def _get_pdf_library(self):
        """Get available PDF library"""
        
        # Try PyMuPDF (fitz) first - most comprehensive
        try:
            import fitz
            logger.debug("Using PyMuPDF (fitz) for PDF reading")
            return 'fitz'
        except ImportError:
            pass
        
        # Try pypdf as fallback
        try:
            import pypdf
            logger.debug("Using pypdf for PDF reading")
            return 'pypdf'
        except ImportError:
            pass
        
        # Try PyPDF2 as last resort
        try:
            import PyPDF2
            logger.debug("Using PyPDF2 for PDF reading")
            return 'pypdf2'
        except ImportError:
            pass
        
        logger.warning("No PDF library found. Install PyMuPDF, pypdf, or PyPDF2")
        return None
    
    async def read(self, source: Union[str, Path]) -> List[Document]:
        """Read PDF file and return documents
        
        Args:
            source: File path to read
            
        Returns:
            List containing single document with extracted text
            
        Raises:
            FileNotFoundError: If file doesn't exist
            ImportError: If no PDF library is available
            Exception: If PDF reading fails
        """
        
        if not self._pdf_library:
            raise ImportError(
                "No PDF library available. Install one of: "
                "PyMuPDF (pip install PyMuPDF), "
                "pypdf (pip install pypdf), "
                "PyPDF2 (pip install PyPDF2)"
            )
        
        file_path = Path(source)
        
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        if not file_path.is_file():
            raise ValueError(f"Path is not a file: {file_path}")
        
        # Extract text based on available library
        if self._pdf_library == 'fitz':
            content, metadata_dict = await self._read_with_fitz(file_path)
        elif self._pdf_library == 'pypdf':
            content, metadata_dict = await self._read_with_pypdf(file_path)
        elif self._pdf_library == 'pypdf2':
            content, metadata_dict = await self._read_with_pypdf2(file_path)
        else:
            raise ImportError("No supported PDF library found")
        
        # Create document metadata
        metadata = DocumentMetadata(
            name=file_path.name,
            source=str(file_path),
            source_type='file',
            content_type='application/pdf',
            size=len(content.encode('utf-8')),
            reader_name=self.__class__.__name__
        )
        
        # Add PDF-specific metadata
        if metadata_dict:
            metadata.custom.update(metadata_dict)
        
        # Create document
        document = Document(content=content, metadata=metadata)
        
        logger.debug(f"Read PDF file: {file_path} ({len(content)} characters)")
        return [document]
    
    async def read_async(self, source: Union[str, Path], **kwargs):
        """Asynchronously read PDF file and yield documents
        
        Args:
            source: File path to read
            **kwargs: Additional arguments
            
        Yields:
            Documents one by one
        """
        documents = await self.read(source)
        for document in documents:
            yield document
    
    async def _read_with_fitz(self, file_path: Path) -> tuple[str, dict]:
        """Read PDF using PyMuPDF (fitz)"""
        
        def _extract():
            import fitz
            
            doc = fitz.open(str(file_path))
            
            # Handle password
            if doc.needs_pass:
                if self.password:
                    if not doc.authenticate(self.password):
                        raise ValueError("Invalid PDF password")
                else:
                    raise ValueError("PDF requires password")
            
            # Determine page range
            start_page = 0
            end_page = doc.page_count
            
            if self.page_range:
                start_page = max(0, self.page_range[0])
                end_page = min(doc.page_count, self.page_range[1])
            
            # Extract text
            text_parts = []
            for page_num in range(start_page, end_page):
                page = doc[page_num]
                text = page.get_text()
                if text.strip():
                    text_parts.append(f"--- Page {page_num + 1} ---\n{text}")
            
            # Get metadata
            metadata = {
                'pdf_pages': doc.page_count,
                'pdf_title': doc.metadata.get('title', ''),
                'pdf_author': doc.metadata.get('author', ''),
                'pdf_subject': doc.metadata.get('subject', ''),
                'pdf_creator': doc.metadata.get('creator', ''),
                'pdf_producer': doc.metadata.get('producer', ''),
                'pdf_creation_date': doc.metadata.get('creationDate', ''),
                'pdf_modification_date': doc.metadata.get('modDate', ''),
                'pages_extracted': f"{start_page + 1}-{end_page}"
            }
            
            doc.close()
            
            return '\n\n'.join(text_parts), metadata
        
        # Run in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _extract)
    
    async def _read_with_pypdf(self, file_path: Path) -> tuple[str, dict]:
        """Read PDF using pypdf"""
        
        def _extract():
            import pypdf
            
            with open(file_path, 'rb') as file:
                reader = pypdf.PdfReader(file)
                
                # Handle password
                if reader.is_encrypted:
                    if self.password:
                        if not reader.decrypt(self.password):
                            raise ValueError("Invalid PDF password")
                    else:
                        raise ValueError("PDF requires password")
                
                # Determine page range
                start_page = 0
                end_page = len(reader.pages)
                
                if self.page_range:
                    start_page = max(0, self.page_range[0])
                    end_page = min(len(reader.pages), self.page_range[1])
                
                # Extract text
                text_parts = []
                for page_num in range(start_page, end_page):
                    page = reader.pages[page_num]
                    text = page.extract_text()
                    if text.strip():
                        text_parts.append(f"--- Page {page_num + 1} ---\n{text}")
                
                # Get metadata
                metadata = {
                    'pdf_pages': len(reader.pages),
                    'pages_extracted': f"{start_page + 1}-{end_page}"
                }
                
                # Add document info if available
                if reader.metadata:
                    metadata.update({
                        'pdf_title': reader.metadata.get('/Title', ''),
                        'pdf_author': reader.metadata.get('/Author', ''),
                        'pdf_subject': reader.metadata.get('/Subject', ''),
                        'pdf_creator': reader.metadata.get('/Creator', ''),
                        'pdf_producer': reader.metadata.get('/Producer', ''),
                    })
                
                return '\n\n'.join(text_parts), metadata
        
        # Run in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _extract)
    
    async def _read_with_pypdf2(self, file_path: Path) -> tuple[str, dict]:
        """Read PDF using PyPDF2"""
        
        def _extract():
            import PyPDF2
            
            with open(file_path, 'rb') as file:
                reader = PyPDF2.PdfReader(file)
                
                # Handle password
                if reader.is_encrypted:
                    if self.password:
                        if not reader.decrypt(self.password):
                            raise ValueError("Invalid PDF password")
                    else:
                        raise ValueError("PDF requires password")
                
                # Determine page range
                start_page = 0
                end_page = len(reader.pages)
                
                if self.page_range:
                    start_page = max(0, self.page_range[0])
                    end_page = min(len(reader.pages), self.page_range[1])
                
                # Extract text
                text_parts = []
                for page_num in range(start_page, end_page):
                    page = reader.pages[page_num]
                    text = page.extract_text()
                    if text.strip():
                        text_parts.append(f"--- Page {page_num + 1} ---\n{text}")
                
                # Get metadata
                metadata = {
                    'pdf_pages': len(reader.pages),
                    'pages_extracted': f"{start_page + 1}-{end_page}"
                }
                
                # Add document info if available
                if reader.metadata:
                    metadata.update({
                        'pdf_title': reader.metadata.get('/Title', ''),
                        'pdf_author': reader.metadata.get('/Author', ''),
                        'pdf_subject': reader.metadata.get('/Subject', ''),
                        'pdf_creator': reader.metadata.get('/Creator', ''),
                        'pdf_producer': reader.metadata.get('/Producer', ''),
                    })
                
                return '\n\n'.join(text_parts), metadata
        
        # Run in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _extract)
    
    def supports_source(self, source: Any) -> bool:
        """Check if this reader supports the given source
        
        Args:
            source: Source to check
            
        Returns:
            True if supported
        """
        
        if isinstance(source, (str, Path)):
            file_path = Path(source)
            return file_path.suffix.lower() == '.pdf'
        
        return False
    
    def get_supported_extensions(self) -> List[str]:
        """Get list of supported file extensions
        
        Returns:
            List of supported extensions
        """
        
        return ['.pdf']
    
    def __str__(self) -> str:
        return f"PDFReader(library={self._pdf_library}, extract_images={self.extract_images})"