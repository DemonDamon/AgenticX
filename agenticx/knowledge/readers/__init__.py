"""Document readers for AgenticX Knowledge Management System"""

import logging
from pathlib import Path
from typing import Optional, Type, Dict, Any

from ..base import BaseReader
from .text_reader import TextReader
from .pdf_reader import PDFReader
from .web_reader import WebReader
from .json_reader import JSONReader
from .csv_reader import CSVReader

logger = logging.getLogger(__name__)

# Registry of available readers
READER_REGISTRY: Dict[str, Type[BaseReader]] = {
    'text': TextReader,
    'pdf': PDFReader,
    'web': WebReader,
    'json': JSONReader,
    'csv': CSVReader,
}

# File extension to reader mapping
EXTENSION_MAPPING = {
    '.txt': 'text',
    '.md': 'text',
    '.markdown': 'text',
    '.rst': 'text',
    '.py': 'text',
    '.js': 'text',
    '.ts': 'text',
    '.html': 'text',
    '.htm': 'text',
    '.xml': 'text',
    '.json': 'json',
    '.yaml': 'text',
    '.yml': 'text',
    '.csv': 'csv',
    '.tsv': 'csv',
    '.log': 'text',
    '.pdf': 'pdf',
}


def register_reader(name: str, reader_class: Type[BaseReader]) -> None:
    """Register a new reader
    
    Args:
        name: Reader name
        reader_class: Reader class
    """
    READER_REGISTRY[name] = reader_class
    logger.info(f"Registered reader: {name}")


def get_reader(
    source: Any,
    reader_name: Optional[str] = None,
    **kwargs
) -> BaseReader:
    """Get appropriate reader for the source
    
    Args:
        source: Source to read (file path, URL, etc.)
        reader_name: Specific reader name to use
        **kwargs: Additional arguments for reader
        
    Returns:
        Reader instance
        
    Raises:
        ValueError: If no suitable reader found
    """
    
    if reader_name:
        # Use specified reader
        if reader_name not in READER_REGISTRY:
            raise ValueError(f"Unknown reader: {reader_name}")
        return READER_REGISTRY[reader_name](**kwargs)
    
    # Auto-detect reader based on source
    if isinstance(source, (str, Path)):
        source_path = Path(source)
        
        # Check if it's a URL
        if isinstance(source, str) and (source.startswith('http://') or source.startswith('https://')):
            return READER_REGISTRY['web'](**kwargs)
        
        # Check file extension
        extension = source_path.suffix.lower()
        if extension in EXTENSION_MAPPING:
            reader_name = EXTENSION_MAPPING[extension]
            return READER_REGISTRY[reader_name](**kwargs)
    
    # Default to text reader
    logger.warning(f"No specific reader found for {source}, using text reader")
    return READER_REGISTRY['text'](**kwargs)


def list_readers() -> Dict[str, Type[BaseReader]]:
    """List all available readers
    
    Returns:
        Dictionary of reader names to classes
    """
    return READER_REGISTRY.copy()


__all__ = [
    'BaseReader',
    'TextReader',
    'PDFReader', 
    'WebReader',
    'JSONReader',
    'CSVReader',
    'register_reader',
    'get_reader',
    'list_readers',
    'READER_REGISTRY',
    'EXTENSION_MAPPING',
]