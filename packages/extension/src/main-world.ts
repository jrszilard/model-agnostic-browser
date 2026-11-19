// MAIN-world content script. react-select commits a selection only in response to events
// dispatched in the page's own (main) world — synthetic mouse events from the extension's
// ISOLATED content-script world don't drive it (proven live: the menu never opens). So the
// select interaction runs HERE, reached from the isolated executor (selectViaMainWorld) over
// window.postMessage: the isolated side marks the target element + posts a request; this side
// runs selectOnPage on the marked element and posts the result back. The DOM is shared across
// worlds, so the marker attribute and the selection are both visible to the isolated side.
//
// This script uses NO chrome.* APIs (unavailable in the main world) — only the DOM.
import { selectOnPage, MW_SELECT_REQ, MW_SELECT_RES, type PageExecResult } from './executor.js';

window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;   // only our own window — no cross-frame injection
  const d = ev.data as { source?: string; reqId?: string; option?: string } | null;
  if (!d || d.source !== MW_SELECT_REQ || typeof d.reqId !== 'string') return;
  void runSelect(d.reqId, typeof d.option === 'string' ? d.option : '');
});

async function runSelect(reqId: string, option: string): Promise<void> {
  let result: PageExecResult;
  try {
    const el = document.querySelector(`[data-aib-mw-target="${cssEscape(reqId)}"]`);
    result = (!el || !el.isConnected) ? { status: 'stale_ref' } : await selectOnPage(el, option);
  } catch (e) {
    result = { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
  window.postMessage({ source: MW_SELECT_RES, reqId, result }, '*');
}

function cssEscape(s: string): string {
  const g = globalThis as { CSS?: { escape?(v: string): string } };
  return g.CSS?.escape ? g.CSS.escape(s) : s.replace(/["\\\]]/g, '\\$&');
}
