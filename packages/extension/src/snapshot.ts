import type { ElementRef, Observation } from '@ai-in-browser/protocol';
import { classifyWidget, currentValue } from './widget.js';

export interface SnapshotOptions {
  observationId: string;
  now: () => string; // ISO; injectable for deterministic tests
}

export interface SnapshotResult {
  observation: Observation;
  /** ref -> live element; the executor resolves against THIS observation's registry. */
  refMap: Map<string, Element>;
}

const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="textbox"]',
  '[role="combobox"]', '[role="checkbox"]', '[role="radio"]',
].join(', ');

const CAPTCHA_SELECTOR = [
  '.g-recaptcha', '.h-captcha', '[data-sitekey]',
  'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]', 'iframe[src*="challenges.cloudflare.com"]',
].join(', ');

const TEXT_DIGEST_CAP = 2000;

export function takeSnapshot(doc: Document, opts: SnapshotOptions): SnapshotResult {
  const refMap = new Map<string, Element>();
  const elements: ElementRef[] = [];
  let n = 0;

  for (const el of Array.from(doc.querySelectorAll(INTERACTIVE_SELECTOR))) {
    if (isHidden(el)) continue;
    const ref = `e${++n}`;
    refMap.set(ref, el);
    elements.push(describe(el, ref));
  }

  return {
    observation: {
      observationId: opts.observationId,
      url: doc.location?.href ?? '',
      title: doc.title,
      capturedAt: opts.now(),
      elements,
      textDigest: digest(doc),
      captchaPresent: doc.querySelector(CAPTCHA_SELECTOR) !== null,
    },
    refMap,
  };
}

/**
 * Attribute-based visibility filter only. Does NOT detect CSS `display:none`,
 * `visibility:hidden`, or offscreen positioning — happy-dom performs no layout,
 * so layout-aware filtering is deferred. A CSS-hidden control may still be
 * surfaced in the snapshot.
 */
function isHidden(el: Element): boolean {
  if (el instanceof HTMLInputElement && el.type === 'hidden') return true;
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (cur.hasAttribute('hidden') || cur.getAttribute('aria-hidden') === 'true') return true;
  }
  return false;
}

function describe(el: Element, ref: string): ElementRef {
  const r = el.getBoundingClientRect();
  const entry: ElementRef = {
    ref,
    role: roleOf(el),
    name: accessibleName(el),
    bounds: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  };
  const hints = fieldHints(el);
  if (hints) entry.fieldHints = hints;
  const widget = classifyWidget(el);
  if (widget) {
    entry.widget = widget;
    const v = currentValue(el);
    if (v) entry.value = v;
    if (el instanceof HTMLSelectElement) {
      entry.options = Array.from(el.options).map((o) => o.label || o.text);
    }
    // custom combobox / typeahead: options are discovered at select-time, not here.
  }
  if (isRequired(el, entry.name)) entry.required = true;
  return entry;
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return 'checkbox';
    if (el.type === 'radio') return 'radio';
    if (el.type === 'submit' || el.type === 'button') return 'button';
    return 'textbox';
  }
  return tag;
}

function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const t = labelledBy.split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ').trim();
    if (t) return clean(t);
  }
  if (el.id) {
    // Use attribute selector with manual escaping as a fallback if CSS.escape is unavailable
    const escapedId = typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(el.id)
      : el.id.replace(/"/g, '\\"');
    const label = el.ownerDocument.querySelector(`label[for="${escapedId}"]`);
    if (label?.textContent?.trim()) return clean(label.textContent);
  }
  const wrapping = el.closest('label');
  if (wrapping?.textContent?.trim()) return clean(wrapping.textContent);
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();
  if (el.textContent?.trim()) return clean(el.textContent);
  const title = el.getAttribute('title');
  if (title) return title.trim();
  if (el instanceof HTMLInputElement && el.value && (el.type === 'submit' || el.type === 'button')) {
    return el.value.trim();
  }
  return el.getAttribute('name') ?? '';
}

function isRequired(el: Element, name: string): boolean {
  if (el.getAttribute('aria-required') === 'true') return true;
  const r = (el as Partial<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>).required;
  if (r === true) return true;
  return /\*\s*$/.test(name); // Some forms mark required fields with a trailing '*' in the label
}

function fieldHints(el: Element): ElementRef['fieldHints'] {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    || el instanceof HTMLSelectElement)) return undefined;
  const hints: NonNullable<ElementRef['fieldHints']> = {};
  if (el instanceof HTMLInputElement) hints.inputType = el.type;
  const autocomplete = el.getAttribute('autocomplete');
  if (autocomplete) hints.autocomplete = autocomplete;
  const name = el.getAttribute('name') ?? el.id;
  if (name) hints.name = name;
  return Object.keys(hints).length ? hints : undefined;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function digest(doc: Document): string {
  const body = doc.body;
  if (!body) return '';
  const clone = body.cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll('script, style, noscript, template'))) {
    el.remove();
  }
  return clean(clone.textContent ?? '').slice(0, TEXT_DIGEST_CAP);
}
