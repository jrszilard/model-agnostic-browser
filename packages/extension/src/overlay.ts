export type OverlayOutcome = 'approved' | 'denied' | 'timeout' | 'continued' | 'took_over';

export interface OverlayRequest {
  mode: 'approval' | 'handoff';
  reason: string;
  risk?: string;                                          // shown in approval mode
  targetBounds?: { x: number; y: number; w: number; h: number };
  timeoutMs: number;
}

const HOST_ID = 'aib-overlay-host';

/**
 * Renders the human-gate overlay in a shadow root. Resolves with the user's
 * choice, or 'timeout' (approval) / 'timeout' (handoff) when nobody answers —
 * silence is never consent. Only one overlay may be active: a concurrent call
 * resolves 'denied' immediately (fail closed, never stacks gates).
 */
export function showOverlay(doc: Document, req: OverlayRequest): Promise<OverlayOutcome> {
  if (doc.getElementById(HOST_ID)) return Promise.resolve('denied');

  const host = doc.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .panel {
        position: fixed; top: 16px; right: 16px; z-index: 2147483647;
        max-width: 360px; padding: 16px; border-radius: 8px;
        background: #1a1a1f; color: #f5f5f5;
        font: 14px/1.45 system-ui, sans-serif;
        box-shadow: 0 6px 24px rgba(0,0,0,.45); border: 1px solid #3a3a44;
      }
      .title { font-weight: 600; margin-bottom: 6px; }
      .risk { display: inline-block; padding: 1px 8px; border-radius: 9999px;
              background: #7a2330; font-size: 12px; margin-bottom: 8px; }
      .reason { margin-bottom: 12px; word-break: break-word; }
      .actions { display: flex; gap: 8px; }
      button { padding: 6px 14px; border-radius: 6px; border: 1px solid #555;
               cursor: pointer; font: inherit; background: #2a2a31; color: #f5f5f5; }
      button.primary { background: #2563eb; border-color: #2563eb; }
      .highlight { position: fixed; z-index: 2147483646; pointer-events: none;
                   border: 3px solid #2563eb; border-radius: 4px;
                   box-shadow: 0 0 0 4000px rgba(0,0,0,.25); }
    </style>
  `;

  if (req.targetBounds) {
    const hl = doc.createElement('div');
    hl.className = 'highlight';
    hl.setAttribute('data-aib-highlight', '');
    hl.style.left = `${req.targetBounds.x}px`;
    hl.style.top = `${req.targetBounds.y}px`;
    hl.style.width = `${req.targetBounds.w}px`;
    hl.style.height = `${req.targetBounds.h}px`;
    shadow.appendChild(hl);
  }

  const panel = doc.createElement('div');
  panel.className = 'panel';
  const title = req.mode === 'approval' ? 'ai-in-browser wants to act' : 'ai-in-browser: your turn';
  panel.innerHTML = `
    <div class="title">${title}</div>
    ${req.mode === 'approval' && req.risk ? `<span class="risk"></span>` : ''}
    <div class="reason"></div>
    <div class="actions"></div>
  `;
  // textContent (not innerHTML) for values that originate outside this module
  if (req.mode === 'approval' && req.risk) panel.querySelector('.risk')!.textContent = req.risk;
  panel.querySelector('.reason')!.textContent = req.reason;
  shadow.appendChild(panel);
  doc.body.appendChild(host);

  return new Promise<OverlayOutcome>((resolve) => {
    const finish = (outcome: OverlayOutcome) => {
      clearTimeout(timer);
      host.remove();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish('timeout'), req.timeoutMs);
    const actions = panel.querySelector('.actions')!;
    const add = (label: string, outcome: OverlayOutcome, primary = false) => {
      const b = doc.createElement('button');
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.addEventListener('click', () => finish(outcome));
      actions.appendChild(b);
    };
    if (req.mode === 'approval') {
      add('Approve', 'approved', true);
      add('Deny', 'denied');
    } else {
      add('Continue', 'continued', true);
      add("I'll take over", 'took_over');
    }
  });
}
