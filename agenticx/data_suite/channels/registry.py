from __future__ import annotations

from typing import Dict, List

from agenticx.data_suite.channels.base import ChannelProbeResult, DataChannel


class ChannelRegistry:
    """Name → DataChannel registry with bulk probe."""

    def __init__(self) -> None:
        self._channels: Dict[str, DataChannel] = {}

    def register(self, channel: DataChannel) -> None:
        self._channels[channel.name] = channel

    def get(self, name: str) -> DataChannel:
        try:
            return self._channels[name]
        except KeyError as exc:
            raise KeyError(f"unknown channel: {name}") from exc

    def probe_all(self) -> List[ChannelProbeResult]:
        return [ch.probe() for ch in self._channels.values()]

    def names(self) -> List[str]:
        return sorted(self._channels.keys())
