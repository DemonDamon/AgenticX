/**
 * 极简模块级事件总线（不引三方库）。
 *
 * - bindingChanged：绑定态变化（配对成功 / 解绑 / 401 失效）→ useGateway 重建 client
 * - confirmsChanged：审批状态可能变化（send 触发 pending / 审批决策完成）
 *   → ConfirmCard 立即重拉、消息页立即刷新
 */

type Handler = () => void;

const bindingHandlers = new Set<Handler>();
const confirmsHandlers = new Set<Handler>();

export function onBindingChanged(handler: Handler): () => void {
  bindingHandlers.add(handler);
  return () => {
    bindingHandlers.delete(handler);
  };
}

export function notifyBindingChanged(): void {
  for (const handler of [...bindingHandlers]) handler();
}

export function onConfirmsChanged(handler: Handler): () => void {
  confirmsHandlers.add(handler);
  return () => {
    confirmsHandlers.delete(handler);
  };
}

export function notifyConfirmsChanged(): void {
  for (const handler of [...confirmsHandlers]) handler();
}
