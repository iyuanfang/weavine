/**
 * Lightweight client-side telemetry.
 *
 * Events are emitted to console + a bounded localStorage queue so we can
 * inspect usage patterns without depending on a backend endpoint. When a
 * future server endpoint ships, swap `flush()` to a POST instead of
 * dropping on the floor.
 *
 * Design choices:
 * - Fire-and-forget: `emit()` never throws, never blocks the UI.
 * - Schema is open: callers can pass any object as `payload`. Document
 *   known payloads inline at each call site.
 * - For now we keep the queue tiny (50 events) so a stuck tab doesn't
 *   eat disk. Old events get evicted FIFO.
 */
const STORAGE_KEY = 'weavine:telemetry:v1';
const MAX_QUEUE = 50;

export type TelemetryEvent =
  | 'graph_tab_open'
  | 'graph_node_click'
  | 'graph_overflow';

export interface TelemetryPayload {
  graph_tab_open: {
    entity_type: string;
    entity_id: string;
    source: 'tab' | 'route';
  };
  graph_node_click: {
    entity_type: string;
    center_type: string;
    action: 'detail' | 'drill';
  };
  graph_overflow: {
    hidden_count: number;
    visible_count: number;
  };
}

interface QueuedEvent {
  ts: string;
  name: TelemetryEvent;
  payload: unknown;
}

function readQueue(): QueuedEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(events: QueuedEvent[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // localStorage may be full or disabled (private mode); silently drop.
  }
}

export function emit<K extends TelemetryEvent>(
  name: K,
  payload: TelemetryPayload[K]
): void {
  const event: QueuedEvent = {
    ts: new Date().toISOString(),
    name,
    payload,
  };
  if (typeof console !== 'undefined' && console.debug) {
    console.debug(`[telemetry] ${name}`, payload);
  }
  const queue = readQueue();
  queue.push(event);
  while (queue.length > MAX_QUEUE) queue.shift();
  writeQueue(queue);
}

export function readEvents(): QueuedEvent[] {
  return readQueue();
}

export function clearEvents(): void {
  writeQueue([]);
}
