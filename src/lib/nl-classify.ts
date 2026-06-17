export type QuickLogType = 'interaction' | 'action' | 'event';

/**
 * Heuristic NL classifier for QuickLog input text.
 * Returns the most likely type based on keywords and patterns.
 */
export function classifyInput(text: string): QuickLogType {
  const t = text.trim().toLowerCase();
  // 含具体时间且不像是纯记录 → Event
  if (/[0-9]+[点:：]/.test(t) || /今天|明天|后天|周[一二三四五六日]/.test(t)) {
    if (/了|过|说|聊|沟通|确认|记|已|刚/.test(t)) return 'interaction';
    if (/开会|见面|约|聚|聊|吃饭|喝/.test(t)) return 'event';
    return 'event';
  }
  // 过去时 → Interaction
  if (/了|过|说|聊|沟通|确认|已|刚|告诉|通知/.test(t)) return 'interaction';
  // 要做 → Action
  if (/做|交|准备|跟进|回复|买|发|写|整理|催|追|送|联系|问|查|确认|提交|安排|处理/.test(t))
    return 'action';
  // 默认
  return 'action';
}
