"""Studio OTel enable helper. Import-safe and never raises to callers.

Author: Damon Li
"""

from __future__ import annotations


def maybe_enable_studio_otel() -> bool:
    """Enable OTel from env. Return True if enabled. Never raise."""
    try:
        from agenticx.observability.otel import OTelConfig, enable_otel, register_otel_hooks

        cfg = OTelConfig.from_env()
        if not cfg.enabled:
            return False
        enable_otel(
            service_name=cfg.service_name or "agenticx-studio",
            otlp_endpoint=cfg.otlp_endpoint,
            export_to_console=cfg.export_to_console,
            export_to_span_tree=True,
            trace_sample_rate=cfg.trace_sample_rate,
        )
        register_otel_hooks(service_name=cfg.service_name or "agenticx-studio")
        return True
    except Exception:
        return False
