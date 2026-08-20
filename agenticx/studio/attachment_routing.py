#!/usr/bin/env python3
"""附件自动路由 · 运行时判定。

策略由企业后台在 ``/api/desktop/bootstrap`` 下发，Desktop 主进程写进全局配置的
``enterprise.attachment_routing``（与 PAT、portal origin 同一处）。规则的唯一出处在
服务端，这里只负责执行——和 :mod:`agenticx.studio.web_search.enterprise` 同样的形态。

为什么运行时也要判一遍，而不是只在 Electron 里做：Desktop 的聊天框不是唯一入口。
CLI、定时任务、子智能体、分身委派都不经过那段 UI 代码，只在前端拦一道就是个洞——
而这条策略拦的是"文档内容会不会离开私有部署"，漏一条路径就等于没做。

判定必须在调用模型**之前**发生。Office 文档最终会被抽成文本进上下文，先解析后决定
的话，文本已经发给公网模型了才想起来要切。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence

DEFAULT_MAX_RENDERED_PAGES = 20


@dataclass(frozen=True)
class RoutingModelRef:
    """三种寻址方式一起下发，因为两端寻址不一样。

    portal 直接用 ``provider`` + ``model``；Desktop 把企业下发的模型全部挂在**单一**
    ``enterprise`` provider 下、拿 ``id``（``<provider>/<model>``）当模型名——见
    main.ts 的 applyEnterpriseProvider。只带 provider/model 的话客户端就得自己拼 id，
    拼错就是切到一个不存在的模型。
    """

    provider: str
    model: str
    label: str
    id: str = ""


@dataclass(frozen=True)
class AttachmentRoutingPolicy:
    enabled: bool = False
    document_target: Optional[RoutingModelRef] = None
    document_extensions: tuple[str, ...] = ()
    image_strategy: str = "vision-fallback"
    vision_fallback: Optional[RoutingModelRef] = None
    max_rendered_pages: int = DEFAULT_MAX_RENDERED_PAGES


ROUTING_OFF = AttachmentRoutingPolicy()


def _model_ref(raw: Any) -> Optional[RoutingModelRef]:
    if not isinstance(raw, dict):
        return None
    provider = str(raw.get("provider") or "").strip()
    model = str(raw.get("model") or "").strip()
    if not provider or not model:
        return None
    label = str(raw.get("label") or "").strip() or f"{provider}/{model}"
    ref_id = str(raw.get("id") or "").strip() or f"{provider}/{model}"
    return RoutingModelRef(provider=provider, model=model, label=label, id=ref_id)


def read_policy(raw: Any = None) -> AttachmentRoutingPolicy:
    """读下发快照。**默认关**，只有明确认得的内容才启用。

    取不到目标模型时整条关掉，而不是让"检测到文档但无处可切"发生——那会把附件落回
    公网模型，而用户已经被告知它留在私有部署里。
    """
    if raw is None:
        raw = _load_from_global_config()
    if not isinstance(raw, dict) or raw.get("enabled") is not True:
        return ROUTING_OFF
    target = _model_ref(raw.get("documentTarget") or raw.get("document_target"))
    if target is None:
        return ROUTING_OFF
    raw_exts = raw.get("documentExtensions") or raw.get("document_extensions") or []
    extensions = tuple(
        ext
        for ext in (
            str(item or "").strip().lower()
            for item in raw_exts
            if isinstance(item, str)
        )
        if ext.startswith(".") and len(ext) > 1
    )
    if not extensions:
        return ROUTING_OFF
    try:
        pages = int(raw.get("maxRenderedPages") or raw.get("max_rendered_pages") or 0)
    except (TypeError, ValueError):
        pages = 0
    strategy = str(raw.get("imageStrategy") or raw.get("image_strategy") or "").strip()
    return AttachmentRoutingPolicy(
        enabled=True,
        document_target=target,
        document_extensions=extensions,
        image_strategy="sticky" if strategy == "sticky" else "vision-fallback",
        vision_fallback=_model_ref(raw.get("visionFallback") or raw.get("vision_fallback")),
        max_rendered_pages=pages if pages >= 1 else DEFAULT_MAX_RENDERED_PAGES,
    )


def _load_from_global_config() -> Dict[str, Any]:
    """只读全局用户配置。

    和企业 PAT / portal origin 同一条纪律：**不走 ``ConfigManager.get_value()``**，
    否则一个项目级 config 就能覆盖企业下发的策略，本地放一份
    ``{"enabled": false}`` 就能把附件送回公网模型。
    """
    try:
        from agenticx.cli.config_manager import ConfigManager

        global_config = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
    except Exception:
        return {}
    enterprise = global_config.get("enterprise")
    if not isinstance(enterprise, dict):
        return {}
    raw = enterprise.get("attachment_routing") or enterprise.get("attachmentRouting")
    return raw if isinstance(raw, dict) else {}


def _extension_of(name: str) -> str:
    base = os.path.basename(str(name or "").strip().replace("\\", "/"))
    _, ext = os.path.splitext(base.lower())
    return ext if len(ext) > 1 else ""


def has_routed_document(
    filenames: Iterable[str], policy: AttachmentRoutingPolicy
) -> bool:
    """这批文件里有没有会触发锁定的文档。只看扩展名——判定发生在解析之前。"""
    if not policy.enabled or policy.document_target is None:
        return False
    wanted = set(policy.document_extensions)
    return any(_extension_of(name) in wanted for name in filenames)


@dataclass(frozen=True)
class RoutingDecision:
    """``action`` 取 ``"none"`` 或 ``"lock"``。"""

    action: str
    target: Optional[RoutingModelRef] = None
    announce: bool = False


def decide(
    *,
    policy: AttachmentRoutingPolicy,
    filenames: Sequence[str],
    locked_target: Optional[RoutingModelRef],
) -> RoutingDecision:
    """决定这一轮要不要锁模型。

    sticky 的含义：**一旦锁定，本会话不再解锁**。理由不止是"别泄露"——文档内容已经
    进了这段对话的上下文（PDF 是页图，Office 是文本），换回纯文本云端模型要么看不见
    它，要么得把它抽成文本再发出去。所以后续每一轮都返回 lock，只是不再 announce。
    """
    if not policy.enabled or policy.document_target is None:
        return RoutingDecision(action="none")
    if locked_target is not None:
        # 目标以当前下发的为准：管理员换了私有模型之后，老会话下一轮跟着走，不会卡
        # 在一个已经下线的模型上。
        return RoutingDecision(action="lock", target=policy.document_target, announce=False)
    if not has_routed_document(filenames, policy):
        return RoutingDecision(action="none")
    return RoutingDecision(action="lock", target=policy.document_target, announce=True)


#: Desktop 企业登录后所有模型都挂在这个 provider 下。
ENTERPRISE_PROVIDER = "enterprise"


def address_for_session(session: Any, target: RoutingModelRef) -> tuple[str, str]:
    """把目标模型翻译成这个会话能用的 (provider, model)。

    企业托管的 Desktop 会话只有一个 ``enterprise`` provider，模型名就是全 id；直连
    配置的会话则按 provider/model 寻址。判错的后果是切到一个不存在的模型，所以看当前
    会话实际在用哪种，而不是猜。
    """
    if str(getattr(session, "provider_name", "") or "").strip() == ENTERPRISE_PROVIDER:
        return ENTERPRISE_PROVIDER, (target.id or f"{target.provider}/{target.model}")
    return target.provider, target.model


LOCK_ATTR = "_attachment_routing_lock"


def session_locked_target(session: Any) -> Optional[RoutingModelRef]:
    raw = getattr(session, LOCK_ATTR, None)
    return raw if isinstance(raw, RoutingModelRef) else None


def remember_lock(session: Any, target: RoutingModelRef) -> None:
    try:
        setattr(session, LOCK_ATTR, target)
    except Exception:
        pass


def lock_reason(target: RoutingModelRef) -> str:
    return (
        f"本会话包含文档附件，已锁定到「{target.label}」（私有部署）。"
        "文档内容不会离开这台部署。"
    )


def apply_to_session(
    session: Any,
    *,
    filenames: Sequence[str],
    policy: Optional[AttachmentRoutingPolicy] = None,
) -> Optional[RoutingDecision]:
    """判定并把结果落到 session 上。

    必须在解析 LLM **之前**调用：下游是拿 ``session.provider_name`` /
    ``session.model_name`` 去 ``ProviderResolver.resolve`` 的，晚一步就来不及了。

    Args:
        filenames: 本轮附件的名字或路径。只看扩展名，不看内容——判定发生在解析之前。
        policy: 覆盖下发策略，仅供测试。

    Returns:
        锁定时返回决策（``announce`` 为真表示这是本会话第一次锁定，该告诉用户），
        不需要动模型时返回 ``None``。
    """
    resolved = read_policy() if policy is None else policy
    decision = decide(
        policy=resolved,
        filenames=list(filenames),
        locked_target=session_locked_target(session),
    )
    target = decision.target
    if decision.action != "lock" or target is None:
        return None
    provider, model = address_for_session(session, target)
    switched = (
        str(getattr(session, "provider_name", "") or "") != provider
        or str(getattr(session, "model_name", "") or "") != model
    )
    session.provider_name = provider
    session.model_name = model
    if switched:
        # declared_context_window 是跟着客户端选的那个模型一起传上来的。模型被我们
        # 换掉之后它就是错的，留着会让运行时按错误的窗口做预算，清掉以回落到按模型
        # 名推断。
        try:
            session.declared_context_window = None
        except Exception:
            pass
    remember_lock(session, target)
    return decision
