"""Text file reader for AgenticX Knowledge Management System"""

import asyncio
import logging
from pathlib import Path
from typing import List, Optional, Union, Any
import chardet

from ..base import BaseReader
from ..document import Document, DocumentMetadata

logger = logging.getLogger(__name__)


class TextReader(BaseReader):
    """Reader for plain text files"""
    
    def __init__(
        self,
        encoding: Optional[str] = None,
        auto_detect_encoding: bool = True,
        chunk_size: int = 8192,
        **kwargs
    ):
        """
        Initialize TextReader
        
        Args:
            encoding: Text encoding (auto-detect if None)
            auto_detect_encoding: Whether to auto-detect encoding
            chunk_size: Size for reading file chunks
            **kwargs: Additional configuration
        """
        self.encoding = encoding
        self.auto_detect_encoding = auto_detect_encoding
        self.chunk_size = chunk_size
        self.config = kwargs
    
    async def read(self, source: Union[str, Path]) -> List[Document]:
        """Read text file and return documents
        
        Args:
            source: File path to read
            
        Returns:
            List containing single document
            
        Raises:
            FileNotFoundError: If file doesn't exist
            UnicodeDecodeError: If encoding detection fails
        """
        
        file_path = Path(source)
        
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        if not file_path.is_file():
            raise ValueError(f"Path is not a file: {file_path}")
        
        # Detect encoding if needed
        encoding = await self._detect_encoding(file_path)
        
        # Read file content
        try:
            content = await self._read_file_async(file_path, encoding)
        except UnicodeDecodeError as e:
            logger.error(f"Failed to decode {file_path} with encoding {encoding}: {e}")
            # Try with fallback encodings
            for fallback_encoding in ['utf-8', 'latin-1', 'cp1252']:
                if fallback_encoding != encoding:
                    try:
                        content = await self._read_file_async(file_path, fallback_encoding)
                        encoding = fallback_encoding
                        logger.warning(f"Used fallback encoding {encoding} for {file_path}")
                        break
                    except UnicodeDecodeError:
                        continue
            else:
                raise UnicodeDecodeError(f"Could not decode {file_path} with any encoding")
        
        # Create document metadata
        metadata = DocumentMetadata(
            name=file_path.name,
            source=str(file_path),
            source_type='file',
            content_type='text/plain',
            encoding=encoding,
            size=len(content.encode('utf-8')),
            reader_name=self.__class__.__name__
        )
        
        # Create document
        document = Document(content=content, metadata=metadata)
        
        logger.debug(f"Read text file: {file_path} ({len(content)} characters)")
        return [document]
    
    async def read_async(self, source: Union[str, Path], **kwargs):
        """Asynchronously read text file and yield documents
        
        Args:
            source: File path to read
            **kwargs: Additional arguments
            
        Yields:
            Documents one by one
        """
        documents = await self.read(source)
        for document in documents:
            yield document
    
    async def _detect_encoding(self, file_path: Path) -> str:
        """Detect file encoding
        
        Args:
            file_path: Path to file
            
        Returns:
            Detected encoding name
        """
        
        if self.encoding:
            return self.encoding
        
        if not self.auto_detect_encoding:
            return 'utf-8'
        
        # Read a sample for encoding detection
        try:
            with open(file_path, 'rb') as f:
                sample = f.read(min(self.chunk_size, file_path.stat().st_size))
            
            if sample:
                detection = chardet.detect(sample)
                encoding = detection.get('encoding', 'utf-8')
                confidence = detection.get('confidence', 0.0)
                
                # Use detected encoding if confidence is high enough
                if confidence > 0.7:
                    logger.debug(f"Detected encoding {encoding} with confidence {confidence:.2f} for {file_path}")
                    return encoding
                else:
                    logger.debug(f"Low confidence ({confidence:.2f}) for detected encoding {encoding}, using utf-8")
            
        except Exception as e:
            logger.warning(f"Encoding detection failed for {file_path}: {e}")
        
        return 'utf-8'
    
    async def _read_file_async(self, file_path: Path, encoding: str) -> str:
        """Read file content asynchronously
        
        Args:
            file_path: Path to file
            encoding: Text encoding
            
        Returns:
            File content as string
        """
        
        def _read_file():
            with open(file_path, 'r', encoding=encoding) as f:
                return f.read()
        
        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _read_file)
    
    def supports_source(self, source: Any) -> bool:
        """Check if this reader supports the given source
        
        Args:
            source: Source to check
            
        Returns:
            True if supported
        """
        
        if isinstance(source, (str, Path)):
            file_path = Path(source)
            
            # Check if it's a file
            if not file_path.exists() or not file_path.is_file():
                return False
            
            # Check file extension
            text_extensions = {
                '.txt', '.md', '.markdown', '.rst', '.py', '.js', '.ts',
                '.html', '.htm', '.xml', '.json', '.yaml', '.yml', 
                '.csv', '.log', '.cfg', '.conf', '.ini'
            }
            
            extension = file_path.suffix.lower()
            return extension in text_extensions or extension == ''
        
        return False
    
    def get_supported_extensions(self) -> List[str]:
        """Get list of supported file extensions
        
        Returns:
            List of supported extensions
        """
        
        return [
            '.txt', '.md', '.markdown', '.rst', '.py', '.js', '.ts',
            '.html', '.htm', '.xml', '.json', '.yaml', '.yml',
            '.csv', '.log', '.cfg', '.conf', '.ini'
        ]
    
    def __str__(self) -> str:
        return f"TextReader(encoding={self.encoding}, auto_detect={self.auto_detect_encoding})"