// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { executeOnPage, selectViaMainWorld } from '../src/executor.js';
import { takeSnapshot } from '../src/snapshot.js';

const snap = () => takeSnapshot(document, { observationId: 'o1', now: () => 't' });

beforeEach(() => { document.body.innerHTML = ''; });

describe('executeOnPage — click', () => {
  it('clicks the resolved element', async () => {
    document.body.innerHTML = '<button>Go</button>';
    const { refMap } = snap();
    let clicked = false;
    document.querySelector('button')!.addEventListener('click', () => { clicked = true; });
    const r = await executeOnPage({ kind: 'click', ref: 'e1', observationId: 'o1' }, refMap);
    expect(r.status).toBe('executed');
    expect(clicked).toBe(true);
  });

  it('stale ref (element removed) -> stale_ref, nothing happens', async () => {
    document.body.innerHTML = '<button>Go</button>';
    const { refMap } = snap();
    document.body.innerHTML = ''; // page changed under us
    const r = await executeOnPage({ kind: 'click', ref: 'e1', observationId: 'o1' }, refMap);
    expect(r.status).toBe('stale_ref');
  });

  it('unknown ref -> stale_ref', async () => {
    document.body.innerHTML = '<button>Go</button>';
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'click', ref: 'e99', observationId: 'o1' }, refMap);
    expect(r.status).toBe('stale_ref');
  });
});

describe('executeOnPage — type', () => {
  it('sets the value and fires input + change events', async () => {
    document.body.innerHTML = '<input type="text" name="firstName">';
    const { refMap } = snap();
    const input = document.querySelector('input')!;
    const fired: string[] = [];
    input.addEventListener('input', () => fired.push('input'));
    input.addEventListener('change', () => fired.push('change'));
    const r = await executeOnPage({ kind: 'type', ref: 'e1', value: 'Pat', observationId: 'o1' }, refMap);
    expect(r.status).toBe('executed');
    expect(input.value).toBe('Pat');
    expect(fired).toEqual(['input', 'change']);
  });

  it('typing into a non-field -> error (never silently no-ops)', async () => {
    document.body.innerHTML = '<button>Not a field</button>';
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'type', ref: 'e1', value: 'x', observationId: 'o1' }, refMap);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/not a text field/);
  });
});

describe('executeOnPage — select', () => {
  it('selects the option by label and fires change', async () => {
    document.body.innerHTML = `
      <select name="country">
        <option value="">Choose...</option>
        <option value="us">United States</option>
      </select>`;
    const { refMap } = snap();
    const sel = document.querySelector('select')!;
    let changed = false;
    sel.addEventListener('change', () => { changed = true; });
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'United States', observationId: 'o1' }, refMap);
    expect(r.status).toBe('executed');
    expect(sel.value).toBe('us');
    expect(changed).toBe(true);
  });

  it('unknown option -> error naming the option (AI chose from stale options)', async () => {
    document.body.innerHTML = '<select name="c"><option value="a">A</option></select>';
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'Z', observationId: 'o1' }, refMap);
    expect(r.status).toBe('error');
    expect(r.error).toContain('Z');
  });
});

describe('selectViaMainWorld — isolated -> MAIN-world bridge', () => {
  // react-select ignores synthetic mouse events from the extension's isolated content-script
  // world, so select is run in the page's MAIN world. The isolated side marks the target,
  // posts a request, and awaits the MAIN-world reply over window.postMessage.
  it('marks the target, posts the option, resolves with the reply, and cleans up the marker', async () => {
    document.body.innerHTML = '<input role="combobox">';
    const el = document.querySelector('input') as HTMLElement;
    // Stand-in for main-world.ts: confirm the element is marked + findable, echo back. The reply
    // is delivered as a same-window MessageEvent (source: window) — that's what a real browser
    // sets for a self window.postMessage, and what the executor's "only our own window" guard
    // requires. (happy-dom's postMessage sets a non-window source, so we construct the event.)
    const responder = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || d.source !== 'aib-mw-select-request') return;
      const found = document.querySelector(`[data-aib-mw-target="${d.reqId}"]`);
      window.dispatchEvent(new MessageEvent('message', {
        data: { source: 'aib-mw-select-result', reqId: d.reqId,
          result: { status: found ? 'executed' : 'stale_ref', error: d.option } },
        source: window,
      }));
    };
    window.addEventListener('message', responder);
    const r = await selectViaMainWorld(el, 'United States');
    window.removeEventListener('message', responder);

    expect(r.status).toBe('executed');                          // responder saw the marked element
    expect(r.error).toBe('United States');                      // the option crossed the bridge
    expect(el.hasAttribute('data-aib-mw-target')).toBe(false);  // marker cleaned up afterward
  });

  it('ignores a reply from a foreign window source (rejects cross-frame injection)', async () => {
    document.body.innerHTML = '<input role="combobox">';
    const el = document.querySelector('input') as HTMLElement;
    const foreign = {} as unknown as Window;                    // any window that is not ours
    // Forge a reply with the correct reqId + result-tag but a NON-window source — the only thing
    // a real cross-frame attacker controls. The guard must drop it, so the select times out.
    const onReq = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || d.source !== 'aib-mw-select-request') return;
      window.removeEventListener('message', onReq);
      window.dispatchEvent(new MessageEvent('message', {
        data: { source: 'aib-mw-select-result', reqId: d.reqId, result: { status: 'executed' } },
        source: foreign,
      }));
    };
    window.addEventListener('message', onReq);
    const r = await selectViaMainWorld(el, 'X', 40);            // forged reply ignored -> times out
    window.removeEventListener('message', onReq);

    expect(r.status).toBe('error');
    expect(r.error).toMatch(/timed out/);
    expect(el.hasAttribute('data-aib-mw-target')).toBe(false);
  });

  it('times out to an error if the MAIN-world side never replies', async () => {
    document.body.innerHTML = '<input role="combobox">';
    const el = document.querySelector('input') as HTMLElement;
    const r = await selectViaMainWorld(el, 'Yes', 20);          // 20ms timeout, no responder
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/timed out/);
    expect(el.hasAttribute('data-aib-mw-target')).toBe(false);
  });
});

describe('executeOnPage — navigate', () => {
  it('navigate is the background\'s job -> error here', async () => {
    const r = await executeOnPage({ kind: 'navigate', url: 'https://x.com' }, new Map());
    expect(r.status).toBe('error');
  });
});

// A React-Select-like combobox fixture: clicking the control appends a listbox;
// clicking an option updates the control's displayed text (mimics the real widget).
function mountCombobox(opts: string[], selected = ''): HTMLElement {
  document.body.innerHTML = `<div role="combobox" aria-haspopup="listbox" aria-controls="lb">${selected || 'Choose'}</div>`;
  const control = document.body.firstElementChild as HTMLElement;
  control.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') document.getElementById('lb')?.remove();
  });
  control.addEventListener('click', () => {
    if (document.getElementById('lb')) return;
    const lb = document.createElement('ul');
    lb.id = 'lb'; lb.setAttribute('role', 'listbox');
    for (const o of opts) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option'); li.textContent = o;
      li.addEventListener('click', () => { control.textContent = o; lb.remove(); });
      lb.appendChild(li);
    }
    document.body.appendChild(lb);
  });
  return control;
}

const fastOpts = { sleep: async () => {}, now: () => 0, maxMs: 0 } as const;

// A React-Select-like control with aria-autocomplete="list" (so classifyWidget -> 'typeahead').
// `mode: 'open'` renders options on click (bounded select, e.g. Yes/No).
// `mode: 'filter'` renders options ONLY after an input event (async type-ahead, e.g. School).
function mountAutocomplete(opts: string[], mode: 'open' | 'filter' | 'async-filter'): HTMLInputElement {
  document.body.innerHTML = `<input role="combobox" aria-autocomplete="list" aria-controls="lb2">`;
  const input = document.body.firstElementChild as HTMLInputElement;
  const render = (vals: string[]) => {
    document.getElementById('lb2')?.remove();
    const lb = document.createElement('ul');
    lb.id = 'lb2'; lb.setAttribute('role', 'listbox');
    for (const o of vals) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option'); li.textContent = o;
      li.addEventListener('click', () => { input.value = o; lb.remove(); });
      lb.appendChild(li);
    }
    document.body.appendChild(lb);
  };
  if (mode === 'open') {
    // bounded select: clicking shows the full option list; typing does NOT re-filter it
    input.addEventListener('click', () => { if (!document.getElementById('lb2')) render(opts); });
  } else if (mode === 'filter') {
    // async type-ahead: options render only in response to typing
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      render(opts.filter((o) => o.toLowerCase().includes(q)));
    });
  } else if (mode === 'async-filter') {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      queueMicrotask(() => render(opts.filter((o) => o.toLowerCase().includes(q))));
    });
  }
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') document.getElementById('lb2')?.remove();
  });
  return input;
}

describe('executeOnPage — autocomplete dropdowns (slice 2b)', () => {
  it('bounded select (options on open) classified typeahead -> fills via match', async () => {
    mountAutocomplete(['Yes', 'No'], 'open');
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'Yes', observationId: 'o1' }, refMap, fastOpts);
    expect(r.status).toBe('executed');
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('Yes');
  });

  it('async type-ahead (options only after typing) -> fills after the filter step', async () => {
    mountAutocomplete(['MIT', 'Stanford University'], 'filter');
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'MIT', observationId: 'o1' }, refMap, fastOpts);
    expect(r.status).toBe('executed');
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('MIT');
  });

  it('autocomplete with no matching option -> no_match (+availableOptions when any rendered)', async () => {
    mountAutocomplete(['Yes', 'No'], 'open');
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'Maybe', observationId: 'o1' }, refMap, fastOpts);
    expect(r.status).toBe('no_match');
    expect(r.availableOptions).toEqual(['Yes', 'No']);
    expect(document.getElementById('lb2')).toBeNull(); // closed on miss
  });

  it('fills a demographic combobox if asked — policy lives in the caller, not the engine', async () => {
    mountAutocomplete(['Male', 'Female', 'Decline to self-identify'], 'open');
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'Decline to self-identify', observationId: 'o1' }, refMap, fastOpts);
    expect(r.status).toBe('executed');
  });

  it('async type-ahead whose options render after a delay -> polls then fills', async () => {
    mountAutocomplete(['MIT', 'Stanford University'], 'async-filter');
    const { refMap } = snap();
    let t = 0;
    const slowOpts = { sleep: async () => {}, now: () => t++, maxMs: 50 };
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'MIT', observationId: 'o1' }, refMap, slowOpts);
    expect(r.status).toBe('executed');
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('MIT');
  });
});

// Fixture modeling the react-select v5 single-select interaction:
//  - the control opens on the control's `mousedown` (a plain input.click() does NOT open it)
//  - it exposes `aria-controls` -> its own listbox only once open
//  - the option commits on `click`; the committed value shows in a sibling
//    `.select__single-value`, NOT in the input (which react-select clears)
//  - a DECOY always-present [role=listbox] (models the intl-tel-input phone-country list)
//    sits FIRST in the document with country options, to catch any code that resolves the
//    listbox document-wide instead of via the control's aria-controls. ("United States"
//    matches it directly; "No" substring-matches "Norway".)
function mountFaithfulReactSelect(opts: string[]): void {
  document.body.innerHTML = `
    <ul id="iti-country-listbox" role="listbox">
      <li role="option">United States</li>
      <li role="option">Norway</li>
    </ul>
    <div class="select__container">
      <div class="select__control">
        <div class="select__value-container">
          <div class="select__placeholder">Select...</div>
          <input role="combobox" aria-autocomplete="list" aria-expanded="false" />
        </div>
      </div>
    </div>`;
  const container = document.querySelector('.select__container') as HTMLElement;
  const control = container.querySelector('.select__control') as HTMLElement;
  const valueContainer = container.querySelector('.select__value-container') as HTMLElement;
  const input = container.querySelector('input') as HTMLInputElement;

  control.addEventListener('mousedown', () => {             // opens on mousedown, NOT click
    if (container.querySelector('#rs-lb')) return;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'rs-lb');
    const lb = document.createElement('ul');
    lb.id = 'rs-lb'; lb.className = 'select__menu-list'; lb.setAttribute('role', 'listbox');
    for (const o of opts) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option'); li.className = 'select__option'; li.textContent = o;
      li.addEventListener('click', () => {                  // commits on click
        container.querySelector('.select__placeholder')?.remove();
        let sv = valueContainer.querySelector('.select__single-value') as HTMLElement | null;
        if (!sv) { sv = document.createElement('div'); sv.className = 'select__single-value'; valueContainer.prepend(sv); }
        sv.textContent = o;
        input.value = '';                                   // react-select clears the input on commit
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-controls');
        lb.remove();
      });
      lb.appendChild(li);
    }
    container.appendChild(lb);
  });
}

// Real react-select opens ASYNCHRONOUSLY — the menu + aria-controls appear a tick after the
// control's mousedown — and the live form also has an always-present DECOY [role=listbox] (the
// intl-tel-input phone-country list). On the FIRST poll the control has no aria-controls yet, so
// resolveListbox must NOT grab the decoy; it must wait for the control's own listbox. (Grabbing
// the decoy during this race is what made the live select "pick" a phone-country.)
function mountAsyncReactSelectWithDecoy(opts: string[]): void {
  document.body.innerHTML = `
    <ul id="iti-country-listbox" role="listbox">
      <li role="option">United States</li><li role="option">Norway</li>
    </ul>
    <div class="select__container"><div class="select__control"><div class="select__value-container">
      <div class="select__placeholder">Select...</div>
      <input role="combobox" aria-expanded="false">
    </div></div></div>`;
  const container = document.querySelector('.select__container') as HTMLElement;
  const control = container.querySelector('.select__control') as HTMLElement;
  const valueContainer = container.querySelector('.select__value-container') as HTMLElement;
  const input = container.querySelector('input') as HTMLInputElement;
  control.addEventListener('mousedown', () => {
    if (container.querySelector('#rs-lb')) return;
    queueMicrotask(() => {                                   // async open: menu + aria-controls a tick later
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', 'rs-lb');
      const lb = document.createElement('ul');
      lb.id = 'rs-lb'; lb.className = 'select__menu-list'; lb.setAttribute('role', 'listbox');
      for (const o of opts) {
        const li = document.createElement('li');
        li.setAttribute('role', 'option'); li.className = 'select__option'; li.textContent = o;
        li.addEventListener('click', () => {                 // commits on click
          container.querySelector('.select__placeholder')?.remove();
          const sv = document.createElement('div');
          sv.className = 'select__single-value'; sv.textContent = o;
          valueContainer.prepend(sv);
          input.value = '';
          input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-controls'); lb.remove();
        });
        lb.appendChild(li);
      }
      container.appendChild(lb);
    });
  });
}

describe('executeOnPage — react-select opens async with a decoy listbox present', () => {
  it('waits for the control\'s own listbox instead of grabbing the always-present decoy', async () => {
    mountAsyncReactSelectWithDecoy(['Yes', 'No']);
    const { refMap } = snap();
    let t = 0;
    const pollOpts = { sleep: async () => {}, now: () => t++, maxMs: 50 };  // polls past the async open
    const r = await executeOnPage(
      { kind: 'select', ref: 'e1', option: 'No', observationId: 'o1' }, refMap, pollOpts);
    expect(r.status).toBe('executed');
    const committed = document.querySelector('.select__single-value')?.textContent;
    expect(committed).toBe('No');                 // committed the real option...
    expect(committed).not.toBe('United States');  // ...NOT the decoy phone-country list
  });
});

// react-select renders the committed value (the single-value node) ASYNCHRONOUSLY, a tick
// after the option click. The executor must POLL the verify, not read displayedValue once —
// reading once races the render and false-negatives ("selection did not register") even though
// the pick committed (proven live: committedOnPage was "No" while the verify reported error).
function mountAsyncCommitReactSelect(opts: string[]): void {
  document.body.innerHTML = `
    <div class="select__container"><div class="select__control"><div class="select__value-container">
      <div class="select__placeholder">Select...</div>
      <input role="combobox" aria-expanded="false">
    </div></div></div>`;
  const container = document.querySelector('.select__container') as HTMLElement;
  const control = container.querySelector('.select__control') as HTMLElement;
  const valueContainer = container.querySelector('.select__value-container') as HTMLElement;
  const input = container.querySelector('input') as HTMLInputElement;
  control.addEventListener('mousedown', () => {
    if (container.querySelector('#rs-lb')) return;
    input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-controls', 'rs-lb');
    const lb = document.createElement('ul');
    lb.id = 'rs-lb'; lb.className = 'select__menu-list'; lb.setAttribute('role', 'listbox');
    for (const o of opts) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option'); li.className = 'select__option'; li.textContent = o;
      li.addEventListener('click', () => {
        lb.remove(); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-controls');
        queueMicrotask(() => {                               // committed value renders a tick LATER
          container.querySelector('.select__placeholder')?.remove();
          const sv = document.createElement('div');
          sv.className = 'select__single-value'; sv.textContent = o;
          valueContainer.prepend(sv); input.value = '';
        });
      });
      lb.appendChild(li);
    }
    container.appendChild(lb);
  });
}

describe('executeOnPage — react-select commits the value asynchronously', () => {
  it('polls the verify so an async-rendered single-value is not a false "did not register"', async () => {
    mountAsyncCommitReactSelect(['Yes', 'No']);
    const { refMap } = snap();
    let t = 0;
    const pollOpts = { sleep: async () => {}, now: () => t++, maxMs: 50 };
    const r = await executeOnPage(
      { kind: 'select', ref: 'e1', option: 'No', observationId: 'o1' }, refMap, pollOpts);
    expect(r.status).toBe('executed');
    expect(document.querySelector('.select__single-value')?.textContent).toBe('No');
  });
});

describe('executeOnPage — react-select v5 interaction fixture', () => {
  it('opens on mousedown, resolves via aria-controls (ignoring the decoy listbox), commits on click, reads the single-value', async () => {
    mountFaithfulReactSelect(['Yes', 'No']);
    const { refMap } = snap();
    const r = await executeOnPage(
      { kind: 'select', ref: 'e1', option: 'No', observationId: 'o1' }, refMap, fastOpts);
    expect(r.status).toBe('executed');
    const committed = document.querySelector('.select__single-value')?.textContent;
    expect(committed).toBe('No');            // committed the real option...
    expect(committed).not.toBe('United States');  // ...NOT the decoy phone-country list
  });
});

describe('executeOnPage — custom combobox (slice 2a)', () => {
  it('opens, matches the value, clicks it, confirms it took', async () => {
    mountCombobox(['United States', 'Canada']);
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'United States', observationId: 'o1' }, refMap, fastOpts);
    expect(r.status).toBe('executed');
    expect(document.querySelector('[role=combobox]')!.textContent).toBe('United States');
  });

  it('no match -> no_match + availableOptions (never a wrong pick)', async () => {
    mountCombobox(['United States', 'Canada']);
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'Atlantis', observationId: 'o1' }, refMap, fastOpts);
    expect(r.status).toBe('no_match');
    expect(r.availableOptions).toEqual(['United States', 'Canada']);
    expect(document.getElementById('lb')).toBeNull(); // closed on miss
  });

  it('case-insensitive + trimmed match', async () => {
    mountCombobox(['United States']);
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'united states', observationId: 'o1' }, refMap, fastOpts);
    expect(r.status).toBe('executed');
  });

  it('bare type-ahead with no options renders -> no_match (nothing to pick, not a refusal)', async () => {
    document.body.innerHTML = `<input role="combobox" aria-autocomplete="list">`;
    const { refMap } = snap();
    const r = await executeOnPage({ kind: 'select', ref: 'e1', option: 'Anything', observationId: 'o1' }, refMap, fastOpts);
    expect(r.status).toBe('no_match');
    expect(r.availableOptions ?? []).toEqual([]);
  });
});

it('select scrolls the control into view before opening', async () => {
  const control = mountCombobox(['Yes', 'No']);
  let scrolled = false;
  (control as unknown as { scrollIntoView: () => void }).scrollIntoView = () => { scrolled = true; };
  const { refMap } = snap();
  await executeOnPage({ kind: 'select', ref: 'e1', option: 'Yes', observationId: 'o1' }, refMap, fastOpts);
  expect(scrolled).toBe(true);
});
