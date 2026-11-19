import type { BrowserAction } from '@ai-in-browser/protocol';
import { classifyWidget, currentValue } from './widget.js';

export interface PageExecResult {
  status: 'executed' | 'stale_ref' | 'error' | 'no_match';
  error?: string;
  availableOptions?: string[];
}

export interface ExecOpts {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxMs?: number;     // budget to wait for the listbox to render
  intervalMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function scrollIntoView(el: Element): void {
  (el as Partial<HTMLElement>).scrollIntoView?.({ block: 'center' });
}

/**
 * Executes an approved action against the live DOM using the cited snapshot's ref
 * registry. Element gone/detached -> stale_ref (fail closed). navigate never reaches
 * here. Async because custom comboboxes must open + wait for their (portal) listbox.
 */
export async function executeOnPage(
  action: BrowserAction,
  refMap: Map<string, Element>,
  opts: ExecOpts = {},
): Promise<PageExecResult> {
  if (action.kind === 'navigate') {
    return { status: 'error', error: 'navigate is handled by the background, not the content script' };
  }
  const el = refMap.get(action.ref);
  if (!el || !el.isConnected) return { status: 'stale_ref' };

  switch (action.kind) {
    case 'click':
      scrollIntoView(el);
      (el as HTMLElement).click();
      return { status: 'executed' };
    case 'type': {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        return { status: 'error', error: `ref ${action.ref} is not a text field` };
      }
      scrollIntoView(el);
      el.focus();
      el.value = action.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { status: 'executed' };
    }
    case 'select':
      return selectOnPage(el, action.option, opts);
  }
}

// Bridge message types for running a select in the page's MAIN world (main-world.ts).
export const MW_SELECT_REQ = 'aib-mw-select-request';
export const MW_SELECT_RES = 'aib-mw-select-result';

let mwReqCounter = 0;
function newReqId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.randomUUID ? c.randomUUID() : `aib-sel-${++mwReqCounter}`;
}

/**
 * Run a select in the page's MAIN world and await the result. react-select does NOT react
 * to synthetic mouse events dispatched from the extension's isolated content-script world
 * (proven live: the menu never opens), but it does in the page's own world — so the select
 * is executed by the MAIN-world content script (main-world.ts). We mark the target element
 * with a temporary attribute (the DOM is shared across worlds), post a request, and resolve
 * on the matching reply over window.postMessage. Text/click/observe still run in the
 * isolated world (their events DO cross), so only select takes this path.
 */
export function selectViaMainWorld(
  el: HTMLElement, option: string, timeoutMs = 8000,
): Promise<PageExecResult> {
  const reqId = newReqId();
  el.setAttribute('data-aib-mw-target', reqId);
  return new Promise<PageExecResult>((resolve) => {
    let done = false;
    const finish = (r: PageExecResult): void => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      el.removeAttribute('data-aib-mw-target');
      resolve(r);
    };
    const onMessage = (ev: MessageEvent): void => {
      if (ev.source !== window) return;   // only our own window — no cross-frame injection
      const d = ev.data as { source?: string; reqId?: string; result?: PageExecResult } | null;
      if (!d || d.source !== MW_SELECT_RES || d.reqId !== reqId) return;
      finish(d.result ?? { status: 'error', error: 'main-world select returned no result' });
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: MW_SELECT_REQ, reqId, option }, '*');
    const timer = setTimeout(
      () => finish({ status: 'error', error: 'main-world select timed out' }), timeoutMs);
  });
}

function nativeSelect(el: HTMLSelectElement, option: string): PageExecResult {
  const idx = Array.from(el.options).findIndex((o) => (o.label || o.text).trim() === option.trim());
  if (idx < 0) return { status: 'error', error: `option "${option}" not found` };
  el.selectedIndex = idx;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { status: 'executed' };
}

/**
 * The select interaction, run against the live DOM. react-select responds to synthetic
 * mouse events ONLY in the page's main world, so this runs in the MAIN-world content
 * script (main-world.ts), reached from the isolated executor via selectViaMainWorld.
 */
export async function selectOnPage(el: Element, option: string, opts: ExecOpts = {}): Promise<PageExecResult> {
  scrollIntoView(el);
  if (el instanceof HTMLSelectElement) return nativeSelect(el, option);   // slice-1 behavior, unchanged

  const widget = classifyWidget(el);
  if (!widget) return { status: 'error', error: `ref is not a select or combobox` };
  // Both 'combobox' and 'typeahead' are attempted: open, then match; if nothing matches yet,
  // type-to-filter (filters a bounded list; triggers an async one) and match again. The
  // "never guess this field" decision belongs to the caller, not the mechanical executor.

  realClick(el as HTMLElement);                             // open: react-select opens on the
                                                            // control's mousedown (a plain .click()
                                                            // is a no-op); click-based widgets open on
                                                            // the click. Once open the combobox sets
                                                            // aria-controls -> its own listbox.
  let listbox = await waitForListbox(el, opts);             // may be null for async type-aheads
  let chosen = listbox ? matchOption(optionsOf(listbox), option) : undefined;

  if (!chosen) {                                            // type-to-filter
    const input = textInputOf(el);
    if (input) {
      input.focus();
      setReactInputValue(input, option);
      const r = await waitForOption(el, listbox, option, opts);
      chosen = r.chosen;
      listbox = r.listbox;
    }
  }

  if (!chosen) {
    const root = listbox && listbox.isConnected ? listbox : document;
    const availableOptions = optionsOf(root).map((o) => (o.textContent ?? '').trim()).filter(Boolean);
    closeListbox(el);
    return { status: 'no_match', availableOptions };
  }

  scrollIntoView(chosen);
  realClick(chosen);                                        // commit: the option commits on click
  // Confirm the selection registered. react-select renders the committed value (the
  // single-value node) asynchronously, so POLL the displayed value rather than read it once
  // — reading once races the render and false-negatives even though the pick took.
  if (await waitForValue(el, option, opts)) return { status: 'executed' };
  return { status: 'error', error: 'selection did not register' };
}

/** Poll the control's displayed value until it reflects the chosen option (async commit). */
async function waitForValue(el: Element, option: string, opts: ExecOpts): Promise<boolean> {
  const want = option.trim().toLowerCase();
  const maxMs = opts.maxMs ?? 3000;
  const now = opts.now ?? Date.now;
  const start = now();
  for (;;) {
    if (displayedValue(el).toLowerCase().includes(want)) return true;
    if (now() - start >= maxMs) return displayedValue(el).toLowerCase().includes(want);
    await sleepFor(opts);
  }
}

/**
 * Drive an element the way a real user click does — the full pointer/mouse sequence,
 * not just `HTMLElement.click()` (which fires ONLY a `click` event). Used both to OPEN a
 * custom select and to COMMIT an option: react-select opens on the control's `mousedown`
 * (so a plain `.click()` never opens it) and commits an option on `click`, while simpler
 * click-based comboboxes do both on `click` — one real-click sequence satisfies all of them.
 * Dispatching the whole sequence once = a single click, so it opens react-select without
 * re-toggling it closed.
 */
function realClick(el: HTMLElement): void {
  const init: MouseEventInit = { bubbles: true, cancelable: true };
  const view = el.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  const Pointer = view?.PointerEvent ?? (globalThis as typeof globalThis & { PointerEvent?: typeof PointerEvent }).PointerEvent;
  if (Pointer) el.dispatchEvent(new Pointer('pointerdown', init));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  el.dispatchEvent(new MouseEvent('mouseup', init));
  el.dispatchEvent(new MouseEvent('click', init));
}

/**
 * The control's displayed value, for verifying a pick took. react-select clears its
 * input on commit and shows the chosen label in a sibling `single-value` node (NOT in
 * the input), so `currentValue` (which reads input.value) reports empty. Fall back to
 * the single-value text within the control container when the direct read is empty.
 */
function displayedValue(el: Element): string {
  const direct = currentValue(el);
  if (direct) return direct;
  const container = (el as HTMLElement).closest?.('[class*="control"]') as HTMLElement | null;
  const sv = container?.querySelector('[class*="single-value"], [class*="singleValue"]');
  if (sv?.textContent?.trim()) return sv.textContent.replace(/\s+/g, ' ').trim();
  if (container) {
    const t = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return direct;
}

/**
 * Set a value on a (possibly React-controlled) text input. Assigning `input.value`
 * directly bypasses React's value tracker, so its onChange never fires and async
 * type-aheads (School/Degree) never filter. Call the prototype's native setter, then
 * dispatch `input` so React detects the change and runs its filter.
 */
function setReactInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input) as object, 'value',
  )?.set ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function optionsOf(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll('[role="option"]')) as HTMLElement[];
}

function matchOption(labels: HTMLElement[], option: string): HTMLElement | undefined {
  const want = option.trim().toLowerCase();
  return (
    labels.find((o) => (o.textContent ?? '').trim().toLowerCase() === want) ??
    labels.find((o) => (o.textContent ?? '').trim().toLowerCase().includes(want))
  );
}

function textInputOf(el: Element): HTMLInputElement | null {
  if (el instanceof HTMLInputElement) return el;
  return el.querySelector('input');
}

function closeListbox(el: Element): void {
  // Signal close the safe way — never rip a framework-owned node out of the DOM.
  (el as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  (el as HTMLElement).blur?.();
}

/** After typing into a type-ahead, poll until an option matches (it may render async). */
async function waitForOption(
  el: Element,
  listboxHint: ParentNode | null,
  option: string,
  opts: ExecOpts,
): Promise<{ chosen: HTMLElement | undefined; listbox: ParentNode | null }> {
  const maxMs = opts.maxMs ?? 3000;
  const now = opts.now ?? Date.now;
  const start = now();
  for (;;) {
    const listbox = listboxHint && listboxHint.isConnected ? listboxHint : resolveListbox(el);
    const chosen = listbox ? matchOption(optionsOf(listbox), option) : undefined;
    if (chosen) return { chosen, listbox };
    if (now() - start >= maxMs) return { chosen: undefined, listbox };
    await sleepFor(opts);
  }
}

async function waitForListbox(el: Element, opts: ExecOpts): Promise<ParentNode | null> {
  const maxMs = opts.maxMs ?? 3000;
  const now = opts.now ?? Date.now;
  const start = now();
  for (;;) {
    const lb = resolveListbox(el);
    if (lb) return lb;
    if (now() - start >= maxMs) return resolveListbox(el);
    await sleepFor(opts);
  }
}

function resolveListbox(el: Element): ParentNode | null {
  const id = el.getAttribute('aria-controls') ?? el.getAttribute('aria-owns');
  if (id) {
    const byId = el.ownerDocument.getElementById(id);
    if (byId && (byId.getAttribute('role') === 'listbox' || byId.querySelector('[role="option"]'))) return byId;
    return null; // aria-controls names a not-yet-rendered listbox -> wait for it (don't grab a decoy)
  }
  // A combobox exposes its options via aria-controls once OPEN. Before that — or during the
  // async open race — DO NOT fall back to a document-wide [role="listbox"]: on real forms that
  // grabs an UNRELATED widget's list (e.g. the always-present intl-tel-input phone-country
  // listbox), which the executor would then "select" a wrong option from. Wait for el's own
  // listbox instead. Only non-combobox controls use the legacy document-wide fallback.
  const isCombobox = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox';
  if (isCombobox) return null;
  const lb = el.ownerDocument.querySelector('[role="listbox"]');
  if (lb && lb.querySelector('[role="option"]')) return lb;
  return el.ownerDocument.querySelector('[role="option"]') ? el.ownerDocument : null;
}

function sleepFor(opts: ExecOpts): Promise<void> {
  return (opts.sleep ?? realSleep)(opts.intervalMs ?? 100);
}
