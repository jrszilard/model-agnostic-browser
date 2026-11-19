// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { showOverlay } from '../src/overlay.js';

const root = () => document.getElementById('aib-overlay-host');
const shadow = () => root()!.shadowRoot!;
const button = (label: string) =>
  Array.from(shadow().querySelectorAll('button')).find((b) => b.textContent === label)!;

afterEach(() => { root()?.remove(); });

describe('showOverlay — approval mode', () => {
  it('renders reason + risk, resolves approved on Approve, and cleans up', async () => {
    const p = showOverlay(document, {
      mode: 'approval', reason: 'high-risk control "Submit Application"', risk: 'high',
      targetBounds: { x: 10, y: 20, w: 100, h: 30 }, timeoutMs: 5000,
    });
    expect(shadow().textContent).toContain('high-risk control "Submit Application"');
    expect(shadow().textContent).toContain('high');
    button('Approve').click();
    expect(await p).toBe('approved');
    expect(root()).toBeNull();
  });

  it('resolves denied on Deny', async () => {
    const p = showOverlay(document, {
      mode: 'approval', reason: 'r', risk: 'high', timeoutMs: 5000,
    });
    button('Deny').click();
    expect(await p).toBe('denied');
  });

  it('resolves timeout when nobody answers', async () => {
    const p = showOverlay(document, { mode: 'approval', reason: 'r', risk: 'high', timeoutMs: 10 });
    expect(await p).toBe('timeout');
    expect(root()).toBeNull();
  });

  it('renders a highlight box over the target bounds', () => {
    void showOverlay(document, {
      mode: 'approval', reason: 'r', risk: 'high',
      targetBounds: { x: 10, y: 20, w: 100, h: 30 }, timeoutMs: 5000,
    });
    const hl = shadow().querySelector('[data-aib-highlight]') as HTMLElement;
    expect(hl).toBeTruthy();
    expect(hl.style.left).toBe('10px');
    expect(hl.style.top).toBe('20px');
    button('Deny').click(); // cleanup
  });

  it('only one overlay at a time: a second call resolves denied immediately', async () => {
    const first = showOverlay(document, { mode: 'approval', reason: 'r', risk: 'high', timeoutMs: 5000 });
    const second = showOverlay(document, { mode: 'approval', reason: 'r2', risk: 'high', timeoutMs: 5000 });
    expect(await second).toBe('denied');
    button('Approve').click();
    expect(await first).toBe('approved');
  });
});

describe('showOverlay — handoff mode', () => {
  it('resolves continued on Continue', async () => {
    const p = showOverlay(document, { mode: 'handoff', reason: 'this field is yours', timeoutMs: 5000 });
    expect(shadow().textContent).toContain('this field is yours');
    button('Continue').click();
    expect(await p).toBe('continued');
  });

  it("resolves took_over on I'll take over", async () => {
    const p = showOverlay(document, { mode: 'handoff', reason: 'r', timeoutMs: 5000 });
    button("I'll take over").click();
    expect(await p).toBe('took_over');
  });
});
