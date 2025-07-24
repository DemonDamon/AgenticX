# Workflow Merge Migration Guide

## Overview

We have merged three independent workflow files into a unified `UnifiedResearchWorkflow`, supporting three working modes:

- **Basic Mode (BASIC)**: Similar to the original `DeepSearchWorkflow`
- **Interactive Mode (INTERACTIVE)**: Similar to the original `InteractiveDeepSearchWorkflow`
- **Advanced Mode (ADVANCED)**: Similar to the original `MultiIterationResearchWorkflow`

## Migration Steps

### 1. Replace Import Statements

**Old Code:**
```python
from workflows.deep_search_workflow import DeepSearchWorkflow
from workflows.interactive_deep_search_workflow import InteractiveDeepSearchWorkflow
from workflows.multi_iteration_workflow import MultiIterationResearchWorkflow
```

**New Code:**
```python
from workflows.unified_research_workflow import UnifiedResearchWorkflow, WorkflowMode
```

### 2. Replace Instantiation Code

**Old Code:**
```python
# Basic Mode
workflow = DeepSearchWorkflow(llm_provider=llm, max_research_loops=3)

# Interactive Mode  
workflow = InteractiveDeepSearchWorkflow(llm_provider=llm, max_research_loops=5)

# Advanced Mode
workflow = MultiIterationResearchWorkflow(config=config)
```

**New Code:**
```python
# Basic Mode
workflow = UnifiedResearchWorkflow(
    llm_provider=llm,
    mode=WorkflowMode.BASIC,
    max_research_loops=3
)

# Interactive Mode
workflow = UnifiedResearchWorkflow(
    llm_provider=llm,
    mode=WorkflowMode.INTERACTIVE,
    max_research_loops=5
)

# Advanced Mode
workflow = UnifiedResearchWorkflow(
    llm_provider=llm,
    mode=WorkflowMode.ADVANCED,
    max_research_loops=7
)
```

### 3. Usage Methods Remain Unchanged

Execution methods remain unchanged:

```python
result = workflow.execute("AI development trends")
```

## Backward Compatibility

For backward compatibility, the original three workflow files are temporarily retained, but gradual migration to the unified workflow is recommended.

## New Features

1. **Unified API**: All modes use the same interface
2. **Mode Switching**: Easy switching between different working modes through parameters
3. **Unified Logging**: All modes use the same log format
4. **Unified Configuration**: Support for unified configuration file format
5. **Extensibility**: Easier to add new working modes

## File Structure

```
workflows/
├── __init__.py                    # Unified exports
├── unified_research_workflow.py   # New unified workflow
├── MIGRATION_GUIDE.md            # This migration guide
├── deep_search_workflow.py        # [Retained] Backward compatibility
├── interactive_deep_search_workflow.py  # [Retained] Backward compatibility  
├── multi_iteration_workflow.py    # [Retained] Backward compatibility
```

## Future Plans

- Gradually phase out old workflow files
- Add more advanced features to the unified workflow
- Support custom workflow modes