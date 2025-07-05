# AgenticX Memory System

The AgenticX memory system provides a pluggable, shareable memory architecture based on open standards. It enables agents to maintain both short-term session memory and long-term persistent memory through the Model Context Protocol (MCP).

## Architecture Overview

The memory system consists of several key components:

- **BaseMemory**: Abstract interface defining core memory operations with tenant isolation
- **ShortTermMemory**: In-memory volatile storage for session data
- **MCPMemory**: Long-term persistent memory via MCP servers (like OpenMemory)
- **MemoryComponent**: High-level component with intelligent operations and history tracking
- **KnowledgeBase**: Namespace-based knowledge management with metadata filtering

## Key Features

### 🔄 Pluggable Architecture
- Swap memory backends without changing application code
- Support for both local and remote memory services
- Consistent interface across all memory types

### 🏠 Tenant Isolation
- Built-in multi-tenancy support
- Secure data separation between users/sessions
- Metadata-based access control

### 🧠 Intelligent Operations
- Extract-Retrieve-Reason-Update pipeline for smart memory management
- Automatic content analysis and tagging
- Memory consolidation to reduce redundancy

### 🔍 Advanced Search
- Semantic search across all memory types
- Metadata filtering and scoping
- Cross-memory search capabilities

### 📊 History Tracking
- Complete audit trail of memory operations
- Operation statistics and analytics
- Error tracking and debugging support

## Quick Start

### 1. Short-term Memory

```python
from agenticx.memory import ShortTermMemory

# Create session-based memory
memory = ShortTermMemory(
    tenant_id="user_123",
    max_records=1000,
    ttl_seconds=3600  # 1 hour TTL
)

# Add a memory
memory_id = await memory.add(
    "Python is a programming language",
    metadata={"topic": "programming", "language": "python"}
)

# Search memories
results = await memory.search("Python programming", limit=5)
for result in results:
    print(f"[{result.score:.2f}] {result.record.content}")
```

### 2. MCP Memory (Long-term)

```python
from agenticx.memory import MCPMemory

# Configure MCP server (OpenMemory example)
mcp_config = {
    "command": "docker",
    "args": ["run", "--rm", "-p", "8080:8080", "openmemory/server"],
    "env": {"OPENAI_API_KEY": "your-api-key"}
}

# Create persistent memory
memory = MCPMemory(
    tenant_id="user_123",
    server_config=mcp_config
)

# Use with context manager for automatic cleanup
async with memory:
    # Add persistent memory
    memory_id = await memory.add(
        "Important project information",
        metadata={"project": "agenticx", "importance": "high"}
    )
    
    # Search across all memories
    results = await memory.search("project information")
```

### 3. Knowledge Bases

```python
from agenticx.memory import KnowledgeBase, ShortTermMemory

# Create memory backend
backend = ShortTermMemory(tenant_id="kb_demo")

# Create specialized knowledge bases
docs_kb = KnowledgeBase(
    name="documentation",
    memory_backend=backend,
    allowed_content_types={"tutorial", "guide", "faq"}
)

code_kb = KnowledgeBase(
    name="code_examples", 
    memory_backend=backend,
    allowed_content_types={"code", "snippet"}
)

# Add content to specific knowledge bases
await docs_kb.add(
    "How to create an agent",
    content_type="tutorial",
    metadata={"difficulty": "beginner"}
)

await code_kb.add(
    "agent = Agent(name='demo')",
    content_type="code",
    metadata={"language": "python"}
)

# Search within specific knowledge bases
doc_results = await docs_kb.search("agent creation")
code_results = await code_kb.search("agent", content_type="code")
```

### 4. Memory Component (Intelligent Operations)

```python
from agenticx.memory import MemoryComponent, ShortTermMemory

# Create memory component
primary_memory = ShortTermMemory(tenant_id="demo")
component = MemoryComponent(
    primary_memory=primary_memory,
    enable_history=True,
    auto_consolidate=True
)

# Add content with intelligent processing
memory_id = await component.add_intelligent(
    "def fibonacci(n): return n if n <= 1 else fibonacci(n-1) + fibonacci(n-2)",
    metadata={"source": "code_example"}
)

# The component automatically:
# - Detects content type (code)
# - Extracts topics (python, algorithms)
# - Finds related memories
# - Enhances metadata

# Search across all memories
results = await component.search_across_memories("fibonacci algorithm")

# View operation history
history = await component.get_operation_history(limit=10)
for op in history:
    print(f"{op.timestamp} - {op.operation_type}: {op.result}")
```

## MCP Integration

The memory system is designed to work seamlessly with MCP servers like OpenMemory:

### Setting up OpenMemory

1. **Using Docker (Recommended)**:
```bash
docker run --rm -p 8080:8080 -e OPENAI_API_KEY=your-key openmemory/server
```

2. **Using the quick setup script**:
```bash
curl -sL https://raw.githubusercontent.com/mem0ai/mem0/main/openmemory/run.sh | bash
```

### MCP Configuration

```python
# Local OpenMemory server
mcp_config = {
    "command": "docker",
    "args": ["run", "--rm", "-p", "8080:8080", "openmemory/server"],
    "env": {"OPENAI_API_KEY": "your-openai-key"}
}

# Hosted OpenMemory service
mcp_config = {
    "url": "https://api.openmemory.dev",
    "headers": {"Authorization": "Bearer your-openmemory-token"}
}
```

## Advanced Features

### Memory Consolidation

```python
# Automatic consolidation
component = MemoryComponent(
    primary_memory=memory,
    auto_consolidate=True,
    consolidation_threshold=100  # Consolidate every 100 operations
)

# Manual consolidation
consolidated_count = await component.consolidate_memories()
print(f"Consolidated {consolidated_count} similar memories")
```

### Knowledge Base Views

```python
# Create scoped views of knowledge bases
tutorial_view = docs_kb.create_scoped_view(
    name="tutorials_only",
    content_type_filter="tutorial",
    metadata_filter={"difficulty": "beginner"}
)

# Search within the view
results = await tutorial_view.search("getting started")
```

### Export/Import

```python
# Export knowledge base data
exported_data = await kb.export_data(include_metadata=True)

# Save to file
with open("kb_backup.json", "w") as f:
    json.dump(exported_data, f, indent=2, default=str)

# Import data
with open("kb_backup.json", "r") as f:
    data = json.load(f)

import_stats = await kb.import_data(data, overwrite_existing=False)
print(f"Imported {import_stats['imported']} records")
```

## Best Practices

### 1. Memory Architecture

- Use **ShortTermMemory** for session data, temporary context, and caching
- Use **MCPMemory** for long-term knowledge, user preferences, and persistent data
- Use **KnowledgeBase** for organized, domain-specific content collections

### 2. Tenant Isolation

- Always use meaningful tenant IDs (user ID, session ID, etc.)
- Never share memory instances between different tenants
- Use metadata for additional access control when needed

### 3. Content Organization

- Use consistent metadata schemas across your application
- Leverage content types for better organization and filtering
- Implement proper tagging strategies for effective search

### 4. Performance Optimization

- Set appropriate limits on memory size and TTL
- Use metadata filters to scope searches
- Enable consolidation for applications with many similar memories

### 5. Error Handling

```python
from agenticx.memory import MemoryError, MemoryConnectionError

try:
    await memory.add("content")
except MemoryConnectionError:
    # Handle connection issues
    print("Memory service unavailable")
except MemoryError as e:
    # Handle other memory errors
    print(f"Memory operation failed: {e}")
```

## Testing

Run the memory system tests:

```bash
# Run all memory tests
pytest tests/test_memory.py -v

# Run specific test class
pytest tests/test_memory.py::TestShortTermMemory -v

# Run with coverage
pytest tests/test_memory.py --cov=agenticx.memory
```

## Examples

See the complete example in `examples/memory_example.py`:

```bash
python examples/memory_example.py
```

This example demonstrates:
- All memory types and their usage
- Cross-memory search capabilities
- Knowledge base management
- Export/import functionality
- Intelligent memory operations

## Configuration

### Environment Variables

- `AGENTICX_MEMORY_DEFAULT_TENANT`: Default tenant ID for memory operations
- `AGENTICX_MEMORY_MAX_RECORDS`: Default maximum records for short-term memory
- `AGENTICX_MEMORY_TTL_SECONDS`: Default TTL for short-term memory records

### Memory Configuration

```python
# Short-term memory configuration
memory_config = {
    "max_records": 1000,
    "ttl_seconds": 3600,
    "enable_indexing": True
}

memory = ShortTermMemory(tenant_id="user", **memory_config)
```

## Troubleshooting

### Common Issues

1. **MCP Connection Failed**
   - Ensure MCP server is running and accessible
   - Check network connectivity and ports
   - Verify authentication credentials

2. **Memory Not Found**
   - Check tenant isolation settings
   - Verify record IDs are correct
   - Ensure records haven't expired (TTL)

3. **Search Returns No Results**
   - Check metadata filters
   - Verify content indexing
   - Try broader search terms

### Debug Mode

Enable debug logging for detailed information:

```python
import logging
logging.basicConfig(level=logging.DEBUG)

# Memory operations will now log detailed information
```

## Contributing

The memory system is designed to be extensible. To add new memory backends:

1. Inherit from `BaseMemory`
2. Implement all abstract methods
3. Add comprehensive tests
4. Update documentation

See the existing implementations for reference patterns. 