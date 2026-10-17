# Security Policy

## Supported Versions

Security fixes are applied to the latest release and the `main` branch. Older releases are not patched.

## Reporting a Vulnerability

Please **do not** open a public issue, discussion, or pull request for security problems.

Report privately through GitHub: go to the **Security** tab of this repository and click
**Report a vulnerability** (GitHub Private Vulnerability Reporting).

Please include:

- affected component (e.g. `agx serve`, desktop app, command sandbox, MCP integration, enterprise gateway)
- version or commit
- steps to reproduce or a proof of concept
- impact you have observed

We aim to acknowledge reports within 3 business days and to share a fix plan after triage.
Please give us a reasonable window to release a fix before any public disclosure.

## Scope

In scope:

- escaping the agent command sandbox or bypassing tool permission / confirmation checks
- unauthenticated access to the local `agx serve` API
- remote code execution through skills, bundles, MCP servers, or IM gateways
- credential or API key leakage

Out of scope:

- issues that require an already compromised local machine or user account
- vulnerabilities in third-party models, providers, or MCP servers themselves
- running the agent with sandboxing disabled by explicit user choice
