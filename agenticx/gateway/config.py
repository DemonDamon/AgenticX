#!/usr/bin/env python3
"""Load gateway server YAML configuration.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field


class ServerListenConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8081


class FeishuAdapterConfig(BaseModel):
    enabled: bool = False
    app_id: str = ""
    app_secret: str = ""
    encrypt_key: str = ""
    verification_token: str = ""


class WeComAdapterConfig(BaseModel):
    enabled: bool = False
    corp_id: str = ""
    agent_id: int = 0
    secret: str = ""
    token: str = ""
    encoding_aes_key: str = ""


class DingTalkAdapterConfig(BaseModel):
    enabled: bool = False
    app_secret: str = ""


class DeviceAuthEntry(BaseModel):
    device_id: str = ""
    token: str = ""
    binding_code: str = ""


class DevicesConfig(BaseModel):
    auth_tokens: List[DeviceAuthEntry] = Field(default_factory=list)


class AdaptersConfig(BaseModel):
    feishu: FeishuAdapterConfig = Field(default_factory=FeishuAdapterConfig)
    wecom: WeComAdapterConfig = Field(default_factory=WeComAdapterConfig)
    dingtalk: DingTalkAdapterConfig = Field(default_factory=DingTalkAdapterConfig)


class GatewayServerConfig(BaseModel):
    server: ServerListenConfig = Field(default_factory=ServerListenConfig)
    adapters: AdaptersConfig = Field(default_factory=AdaptersConfig)
    devices: DevicesConfig = Field(default_factory=DevicesConfig)
    # Optional shared secret for POST /api/command (Siri etc.)
    command_api_secret: str = ""
    reply_timeout_seconds: float = 300.0


def load_gateway_config(path: Path) -> GatewayServerConfig:
    if not path.exists():
        return GatewayServerConfig()
    with path.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    if not isinstance(raw, dict):
        raise ValueError("gateway config must be a YAML mapping")
    return GatewayServerConfig.model_validate(raw)


def device_token_table(config: GatewayServerConfig) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for entry in config.devices.auth_tokens:
        did = (entry.device_id or "").strip()
        tok = (entry.token or "").strip()
        if did and tok:
            out[did] = tok
    return out


def binding_code_table(config: GatewayServerConfig) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for entry in config.devices.auth_tokens:
        code = (entry.binding_code or "").strip()
        did = (entry.device_id or "").strip()
        if code and did:
            out[code] = did
    return out


def binding_code_for_device(config: GatewayServerConfig, device_id: str) -> Optional[str]:
    """Return the binding_code from gateway config for a registered device_id."""
    did = (device_id or "").strip()
    if not did:
        return None
    for entry in config.devices.auth_tokens:
        if (entry.device_id or "").strip() == did:
            code = (entry.binding_code or "").strip()
            return code or None
    return None
