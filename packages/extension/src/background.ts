import {
  BridgeRequestSchema, WS_DEFAULT_HOST, WS_DEFAULT_PORT, type BridgeRequest,
} from '@ai-in-browser/protocol';
import { sameDocument } from './url-match.js';

const WS_URL = `ws://${WS_DEFAULT_HOST}:${WS_DEFAULT_PORT}`;
const PING_INTERVAL_MS = 20_000; // WS activity also keeps the MV3 worker alive (Chromium >=116)
const RECONNECT_ALARM = 'aib-reconnect';

let ws: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pingCounter = 0;

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const socket = new WebSocket(WS_URL);
  ws = socket;
  socket.onopen = () => {
    console.log('[ai-in-browser] connected to bridge');
    pingTimer = setInterval(() => socket.send(JSON.stringify({ id: `p${++pingCounter}`, type: 'ping' })), PING_INTERVAL_MS);
  };
  socket.onclose = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    ws = null; // the alarm retries; bridge fails its in-flight calls itself
  };
  socket.onmessage = (event) => { void route(socket, String(event.data)); };
}

async function route(socket: WebSocket, raw: string): Promise<void> {
  let msg: BridgeRequest;
  try {
    msg = BridgeRequestSchema.parse(JSON.parse(raw));
  } catch {
    return; // malformed bridge frame: drop (the bridge times the call out)
  }
  if (msg.type === 'pong') return;

  try {
    if (msg.type === 'execute' && msg.action.kind === 'navigate') {
      socket.send(JSON.stringify(await navigateActiveTab(msg.id, msg.action.url)));
      return;
    }
    const tab = await activeTab();
    const reply = await chrome.tabs.sendMessage(tab.id!, msg);
    socket.send(JSON.stringify(reply));
  } catch (err) {
    socket.send(JSON.stringify({
      id: msg.id, type: 'error',
      message: `no scriptable active tab (${err instanceof Error ? err.message : String(err)})`,
    }));
  }
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('none found');
  return tab;
}

async function navigateActiveTab(id: string, url: string): Promise<unknown> {
  const tab = await activeTab();
  const completed = waitForComplete(tab.id!); // attach listener BEFORE update — avoid missing a fast 'complete'
  // A same-document navigation via update({url}) is a no-op — no reload — so an orphaned
  // pre-reload content script survives an extension reload (the stale-content-script trap
  // that has silently failed live applies). Force a reload to inject a fresh content
  // script; a different document reloads on its own.
  if (sameDocument(tab.url, url)) {
    await chrome.tabs.reload(tab.id!);
  } else {
    await chrome.tabs.update(tab.id!, { url });
  }
  await completed;
  // post-navigation observation comes from the freshly injected content script
  const reply = await chrome.tabs.sendMessage(tab.id!, { id, type: 'observe' }) as { observation?: unknown };
  return { id, type: 'executed', status: 'executed', ...(reply?.observation ? { observation: reply.observation } : {}) };
}

function waitForComplete(tabId: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      // give document_idle content scripts a beat to register their listener
      setTimeout(resolve, 300);
    };
    const listener = (updatedId: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (updatedId === tabId && info.status === 'complete') done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Self-labeled bound below the bridge's 20s execute gate: if no 'complete'
    // arrives (already-loaded same-URL nav, or a missed event), proceed to
    // observe anyway — the content script's settle() re-stabilizes the page.
    const timer = setTimeout(done, timeoutMs);
  });
}

// The worker can be torn down while disconnected; an alarm wakes it to retry.
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === RECONNECT_ALARM) connect(); });
connect();
