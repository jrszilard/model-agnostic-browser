import type { BridgeRequest, Observation } from '@ai-in-browser/protocol';
import { takeSnapshot } from './snapshot.js';
import { settle } from './settle.js';
import { executeOnPage, selectViaMainWorld, type PageExecResult } from './executor.js';
import { showOverlay } from './overlay.js';

// These markers distinguish the current executor from a stale content script on a
// reused tab after the extension reloads. Bump the tag when select behavior changes.
document.documentElement.dataset.aibProbe = 'injected';
document.documentElement.dataset.aibBuild = 'mainworld+strictlb+pollverify+srcguard';

const APPROVAL_TIMEOUT_MS = 110_000; // just under the bridge's 120s gate
const HANDOFF_TIMEOUT_MS = 590_000;  // just under the bridge's 600s gate

/** The executor resolves refs against the snapshot the AI actually cited. */
let lastSnap: { observationId: string; refMap: Map<string, Element> } | null = null;

async function freshObservation(): Promise<Observation> {
  await settle(() => {
    const t = document.body?.textContent ?? '';
    return `${t.length}:${t.slice(0, 500)}`;
  });
  const { observation, refMap } = takeSnapshot(document, {
    // randomUUID requires a secure context: ok on https and http://localhost|127.0.0.1
    // (the Task 9 form host); on plain http origins it may throw -> surfaces as a
    // clean wire error via the listener's rejection handler (Fix 1).
    observationId: crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
  lastSnap = { observationId: observation.observationId, refMap };
  return observation;
}

async function handle(msg: BridgeRequest): Promise<unknown> {
  switch (msg.type) {
    case 'observe':
      return { id: msg.id, type: 'observation', observation: await freshObservation() };
    case 'execute': {
      const { action } = msg;
      if (action.kind === 'navigate') {
        return { id: msg.id, type: 'error', message: 'navigate must be handled by the background' };
      }
      if (!lastSnap || lastSnap.observationId !== action.observationId) {
        return { id: msg.id, type: 'executed', status: 'stale_ref' };
      }
      let r: PageExecResult;
      if (action.kind === 'select') {
        // react-select ignores synthetic mouse events from this isolated content-script
        // world, so the select runs in the page's MAIN world (main-world.ts). Other actions
        // run here as before — their input/click events DO cross into the page.
        const el = lastSnap.refMap.get(action.ref);
        r = (!el || !el.isConnected)
          ? { status: 'stale_ref' }
          : await selectViaMainWorld(el as HTMLElement, action.option);
      } else {
        r = await executeOnPage(action, lastSnap.refMap);
      }
      if (r.status !== 'executed') return { id: msg.id, type: 'executed', ...r };
      return { id: msg.id, type: 'executed', status: 'executed', observation: await freshObservation() };
    }
    case 'requestApproval': {
      const outcome = await showOverlay(document, {
        mode: 'approval',
        reason: msg.decision.reason,
        risk: msg.decision.risk,
        targetBounds: msg.target?.bounds,
        timeoutMs: APPROVAL_TIMEOUT_MS,
      });
      return { id: msg.id, type: 'approval', outcome: outcome === 'approved' ? 'approved' : outcome === 'timeout' ? 'timeout' : 'denied' };
    }
    case 'requestHandoff': {
      const outcome = await showOverlay(document, {
        mode: 'handoff', reason: msg.reason, timeoutMs: HANDOFF_TIMEOUT_MS,
      });
      return {
        id: msg.id, type: 'handoff',
        outcome: outcome === 'continued' ? 'continued' : outcome === 'took_over' ? 'took_over' : 'timeout',
      };
    }
    case 'pong':
      return null;
  }
}

chrome.runtime.onMessage.addListener((msg: BridgeRequest, _sender, sendResponse) => {
  handle(msg).then(sendResponse, (err) =>
    sendResponse({ id: msg.id, type: 'error', message: err instanceof Error ? err.message : String(err) }));
  return true; // async response
});
