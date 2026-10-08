#!/usr/bin/env python3
"""JSON-RPC wire models for the MCP Skills extension (io.modelcontextprotocol/skills).

The official Python SDK (``mcp<2``) does not yet wrap the skills extension
methods, so this module provides the pydantic request/result models used to
speak the wire protocol through ``ClientSession.send_request`` (host side) and
through an extended low-level ``Server`` (server side):

- ``skills/list``   -> :class:`SkillsListRequest` / :class:`SkillsListResult`
- ``skills/get``    -> :class:`SkillsGetRequest` / :class:`SkillsGetResult`
- ``resources/directory/read`` -> :class:`DirectoryReadRequest` / :class:`DirectoryReadResult`

:func:`get_extended_client_request` / :func:`get_extended_server_result` build
union subclasses so the SDK's session can validate and dispatch these custom
methods without forking the SDK — they subclass the SDK's own union RootModels
so pattern matching in ``mcp.server.lowlevel.Server`` keeps working.

When the ``mcp`` extra is not installed the models degrade to plain pydantic
classes; skills methods check availability at runtime.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Type, Union

from pydantic import BaseModel, ConfigDict, Field

try:
    from mcp import types as mcp_types
except ImportError:  # pragma: no cover - degraded when the mcp extra is absent
    mcp_types = None  # type: ignore[assignment]

from agenticx.skills.manifest import SKILLS_EXTENSION_ID  # re-exported for callers


# ---------------------------------------------------------------------------
# Params models (defined first so request bases can reference them)
# ---------------------------------------------------------------------------

if mcp_types is not None:
    _PaginatedParamsBase = mcp_types.PaginatedRequestParams
    _ParamsBase = mcp_types.RequestParams
else:  # pragma: no cover
    _PaginatedParamsBase = BaseModel
    _ParamsBase = BaseModel


class SkillsListRequestParams(_PaginatedParamsBase):
    """``skills/list`` params: pagination cursor only."""


class SkillsGetRequestParams(_ParamsBase):
    """``skills/get`` params."""

    uri: str
    model_config = ConfigDict(extra="allow")


class DirectoryReadRequestParams(_PaginatedParamsBase):
    """``resources/directory/read`` params: directory URI + optional cursor."""

    uri: str
    model_config = ConfigDict(extra="allow")


# ---------------------------------------------------------------------------
# Requests (wire: client -> server)
# ---------------------------------------------------------------------------

if mcp_types is not None:
    _ListRequestBase = mcp_types.PaginatedRequest[Literal["skills/list"]]
    _GetRequestBase = mcp_types.Request[SkillsGetRequestParams, Literal["skills/get"]]  # type: ignore[valid-type]
    _DirRequestBase = mcp_types.PaginatedRequest[Literal["resources/directory/read"]]
else:  # pragma: no cover
    _ListRequestBase = BaseModel
    _GetRequestBase = BaseModel
    _DirRequestBase = BaseModel


class SkillsListRequest(_ListRequestBase):
    """``skills/list`` request."""

    method: Literal["skills/list"] = "skills/list"
    params: Optional[SkillsListRequestParams] = None
    model_config = ConfigDict(extra="allow")


class SkillsGetRequest(_GetRequestBase):
    """``skills/get`` request."""

    method: Literal["skills/get"] = "skills/get"
    params: SkillsGetRequestParams
    model_config = ConfigDict(extra="allow")


class DirectoryReadRequest(_DirRequestBase):
    """``resources/directory/read`` request (optional; requires directoryRead=true)."""

    method: Literal["resources/directory/read"] = "resources/directory/read"
    params: Optional[DirectoryReadRequestParams] = None
    model_config = ConfigDict(extra="allow")


# ---------------------------------------------------------------------------
# Results (wire: server -> client). Field names match the spec examples.
# ---------------------------------------------------------------------------

if mcp_types is not None:
    _PaginatedResultBase = mcp_types.PaginatedResult
    _ResultBase = mcp_types.Result
else:  # pragma: no cover
    _PaginatedResultBase = BaseModel
    _ResultBase = BaseModel


class SkillEntryModel(BaseModel):
    """Raw ``Skill`` entry (see agenticx.skills.manifest for the parsed view)."""

    uri: str
    frontmatter: Dict[str, Any] = Field(default_factory=dict)
    resources: Union[List[Dict[str, Any]], Literal["dynamic"]] = Field(default_factory=list)
    model_config = ConfigDict(extra="allow")


class SkillsListResult(_PaginatedResultBase):
    """``skills/list`` result."""

    resultType: Optional[str] = None
    skills: List[SkillEntryModel] = Field(default_factory=list)
    ttlMs: Optional[int] = None
    cacheScope: Optional[str] = None
    model_config = ConfigDict(extra="allow")


class SkillsGetResult(_ResultBase):
    """``skills/get`` result."""

    resultType: Optional[str] = None
    skill: SkillEntryModel
    ttlMs: Optional[int] = None
    cacheScope: Optional[str] = None
    model_config = ConfigDict(extra="allow")


class DirectoryReadResource(BaseModel):
    """One direct child of a directory resource."""

    uri: str
    name: Optional[str] = None
    mimeType: Optional[str] = None
    size: Optional[int] = None
    model_config = ConfigDict(extra="allow")


class DirectoryReadResult(_PaginatedResultBase):
    """``resources/directory/read`` result."""

    resultType: Optional[str] = None
    resources: List[DirectoryReadResource] = Field(default_factory=list)
    model_config = ConfigDict(extra="allow")


# ---------------------------------------------------------------------------
# Extended unions for the SDK session (server side dispatch), built once.
# ---------------------------------------------------------------------------

_ExtendedClientRequest: Optional[Type[BaseModel]] = None
_ExtendedServerResult: Optional[Type[BaseModel]] = None


def get_extended_client_request() -> Type[BaseModel]:
    """Return (building once) a ClientRequest subclass accepting skills methods.

    The subclass keeps ``isinstance(x, ClientRequest)`` true so the SDK server's
    pattern matching keeps dispatching to ``request_handlers``.
    """
    global _ExtendedClientRequest
    if _ExtendedClientRequest is None:
        assert mcp_types is not None, "mcp SDK required for skills wire models"
        root_union = Union[
            mcp_types.ClientRequestType,  # type: ignore[valid-type]
            SkillsListRequest,
            SkillsGetRequest,
            DirectoryReadRequest,
        ]

        class _SkillsClientRequest(mcp_types.ClientRequest):  # type: ignore[misc, valid-type]
            root: root_union  # type: ignore[valid-type]

        _ExtendedClientRequest = _SkillsClientRequest
    return _ExtendedClientRequest


def get_extended_server_result() -> Type[BaseModel]:
    """Return (building once) a ServerResult subclass accepting skills results."""

    global _ExtendedServerResult
    if _ExtendedServerResult is None:
        assert mcp_types is not None, "mcp SDK required for skills wire models"
        root_union = Union[
            mcp_types.ServerResultType,  # type: ignore[valid-type]
            SkillsListResult,
            SkillsGetResult,
            DirectoryReadResult,
        ]

        class _SkillsServerResult(mcp_types.ServerResult):  # type: ignore[misc, valid-type]
            root: root_union  # type: ignore[valid-type]

        _ExtendedServerResult = _SkillsServerResult
    return _ExtendedServerResult


def make_server_result(payload: Any) -> Any:
    """Wrap a skills result payload for a low-level server handler response."""
    return get_extended_server_result()(payload)
