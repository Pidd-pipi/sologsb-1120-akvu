/**
 * 多页签数据同步：任一写操作提交后广播 changed，其他页签重拉数据，
 * 保证两个页签同时抢最后一枚零件时，失败方立刻看到被占用后的真实余量。
 * 优先用 BroadcastChannel，不支持时退化为 localStorage storage 事件。
 */

const CHANNEL_NAME = 'gbclockrepair:sync';
const LS_PING_KEY = 'gbclockrepair:sync-ping';

export type SyncScope = 'clocks' | 'parts' | 'lots' | 'steps' | 'tests' | 'all';

export interface SyncMessage {
  scope: SyncScope;
  at: number;
}

type Listener = (msg: SyncMessage) => void;

let channel: BroadcastChannel | null = null;
const listeners = new Set<Listener>();

function ensureChannel(): BroadcastChannel | null {
  if (channel !== null) return channel;
  if (typeof BroadcastChannel === 'undefined') {
    channel = null;
  } else {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (ev: MessageEvent<SyncMessage>) => {
      listeners.forEach((fn) => fn(ev.data));
    };
  }
  return channel;
}

if (typeof window !== 'undefined' && typeof BroadcastChannel === 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key !== LS_PING_KEY || !ev.newValue) return;
    try {
      const msg = JSON.parse(ev.newValue) as SyncMessage;
      listeners.forEach((fn) => fn(msg));
    } catch {
      /* 忽略无法解析的 ping */
    }
  });
}

export function onSyncChange(fn: Listener): () => void {
  ensureChannel();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifySync(scope: SyncScope = 'all'): void {
  const msg: SyncMessage = { scope, at: Date.now() };
  const bc = ensureChannel();
  if (bc) {
    bc.postMessage(msg);
    return;
  }
  try {
    window.localStorage.setItem(LS_PING_KEY, JSON.stringify(msg));
  } catch {
    /* localStorage 不可用时仅同页生效 */
  }
}
