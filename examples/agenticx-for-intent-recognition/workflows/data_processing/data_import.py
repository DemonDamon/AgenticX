from agenticx.core.workflow import Workflow, WorkflowNode, WorkflowEdge
from tools.data_management.data_loader import DataLoaderTool
from tools.data_management.data_validation import DataValidationTool

class DataImportWorkflow(Workflow):
    def __init__(self):
        # Initialize tools
        data_loader = DataLoaderTool()
        data_validation = DataValidationTool()

        # Define nodes
        load_node = WorkflowNode(
            id="load_data",
            name="load_data",
            type="tool",
            config=data_loader.__dict__,
            inputs={"file_path": "workflow.input.file_path"}
        )

        validate_node = WorkflowNode(
            id="validate_data",
            name="validate_data",
            type="tool",
            config=data_validation.__dict__,
            inputs={"examples": "load_data.output"}
        )

        # Define edges
        edge = WorkflowEdge(source=load_node.id, target=validate_node.id)

        super().__init__(
            name="data_import_workflow",
            organization_id="default_org",
            nodes=[load_node, validate_node],
            edges=[edge]
        )

    def _run(self, file_path: str):
        data_loader = DataLoaderTool()
        loaded_data = data_loader._run(file_path)
        
        # Convert TrainingExample objects to dictionaries for validation
        examples_dict = [example.dict() for example in loaded_data]
        
        data_validation = DataValidationTool()
        validation_result = data_validation._run(examples=examples_dict)
        
        return {"validate_data": validation_result}