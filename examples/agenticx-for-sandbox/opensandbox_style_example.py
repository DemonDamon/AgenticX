#!/usr/bin/env python3
"""OpenSandbox-style example for AgenticX Sandbox.

A complete example demonstrating how to use agenticx/sandbox module
similar to opensandbox API.

Author: Damon Li
"""

import asyncio

from agenticx.sandbox import (
    Sandbox,
    SandboxType,
    CodeInterpreterSandbox,
    SandboxTemplate,
)


async def main() -> None:
    """Main example function demonstrating opensandbox-style usage."""
    
    # 1. Create a sandbox
    # Note: Our API doesn't use Docker images directly, but uses templates
    # For similar functionality, we can create a template with custom environment
    template = SandboxTemplate(
        name="code-interpreter-example",
        type=SandboxType.CODE_INTERPRETER,
        environment={"PYTHON_VERSION": "3.11"},
        timeout_seconds=600,  # 10 minutes timeout
    )
    
    sandbox = Sandbox.create(
        type=SandboxType.CODE_INTERPRETER,
        template=template,
        backend="auto",  # Auto-select best available backend
    )

    async with sandbox:
        # 2. Execute Python code to print a message
        # Note: microsandbox/python image on macOS Apple Silicon has shell command limitations
        # Using Python code instead of shell commands for better compatibility
        # Original: sandbox.run_command("echo 'Hello AgenticX Sandbox!'")
        execution = await sandbox.execute("print('Hello AgenticX Sandbox!')")
        print(execution.stdout.strip())  # Output: Hello AgenticX Sandbox!

        # 3. Write a file
        # Equivalent to: sandbox.files.write_files([WriteEntry(...)])
        # Note: Our API uses write_file() for single files
        await sandbox.write_file("/tmp/hello.txt", "Hello World")
        print("File written successfully")

        # 4. Read a file
        # Equivalent to: sandbox.files.read_file("/tmp/hello.txt")
        content = await sandbox.read_file("/tmp/hello.txt")
        print(f"Content: {content}")  # Output: Content: Hello World

        # 5. Create a code interpreter
        # Equivalent to: CodeInterpreter.create(sandbox)
        # Note: CodeInterpreterSandbox can work independently or use the sandbox
        interpreter = CodeInterpreterSandbox(backend="auto")
        
        async with interpreter:
            # 6. Execute Python code (single-run, pass language directly)
            # Equivalent to: interpreter.codes.run(code, language=SupportedLanguage.PYTHON)
            result = await interpreter.run(
                """
import sys
print(sys.version)
result = 2 + 2
result
                """,
                language="python",
            )

            # Note: In our API, the last expression result is printed to stdout
            # The output includes both print statements and the last expression value
            print("Python version:")
            print(result.stdout)  # Contains sys.version output and result value
            
            # Extract just the result value (last line typically)
            lines = result.stdout.strip().split('\n')
            if lines:
                print(f"Result: {lines[-1]}")  # Should be "4"

    # 7. Cleanup the sandbox
    # Note: Cleanup is automatic via async context manager (__aexit__)
    print("\nSandbox cleaned up successfully")


async def advanced_example() -> None:
    """Advanced example with multiple file operations and code execution."""
    
    print("\n" + "=" * 60)
    print("Advanced Example: Multiple Operations")
    print("=" * 60)
    
    async with Sandbox.create(type=SandboxType.CODE_INTERPRETER) as sandbox:
        # Write multiple files (simulating write_files with multiple entries)
        files_to_write = [
            ("/tmp/file1.txt", "Content of file 1"),
            ("/tmp/file2.txt", "Content of file 2"),
            ("/tmp/data.json", '{"key": "value", "number": 42}'),
        ]
        
        for path, content in files_to_write:
            await sandbox.write_file(path, content)
            print(f"Written: {path}")
        
        # Read all files back
        print("\nReading files back:")
        for path, _ in files_to_write:
            content = await sandbox.read_file(path)
            print(f"{path}: {content[:50]}...")
        
        # Execute code that uses the files
        # IMPORTANT: Use the same sandbox instance to access the files we created!
        # Creating a new CodeInterpreterSandbox() would create an isolated environment
        # that cannot see files from this sandbox.
        result = await sandbox.execute(
            """
import json

# Read the JSON file we created in this same sandbox
with open('/tmp/data.json', 'r') as f:
    data = json.load(f)

print(f"Key: {data['key']}")
print(f"Number: {data['number']}")
result = data['number'] * 2
print(f"Result: {result}")
            """,
            language="python",
        )
        
        print("\nCode execution result:")
        print(result.stdout)
        
        if result.success:
            print(f"Execution successful (exit code: {result.exit_code})")
        else:
            print(f"Execution failed: {result.stderr}")


if __name__ == "__main__":
    # Run the main example
    asyncio.run(main())
    
    # Run the advanced example
    asyncio.run(advanced_example())
    
    print("\n" + "=" * 60)
    print("All examples completed!")
    print("=" * 60)
