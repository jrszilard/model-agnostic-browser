// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { takeSnapshot } from '../src/snapshot.js';

const NOW = '2026-06-12T00:00:00.000Z';
const snap = () => takeSnapshot(document, { observationId: 'o1', now: () => NOW });

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = 'Test Page';
});

describe('takeSnapshot — elements & refs', () => {
  it('captures interactive elements with stable sequential refs and a refMap', () => {
    document.body.innerHTML = `
      <a href="/pricing">Pricing</a>
      <button>Submit Application</button>
      <input type="text" name="firstName" placeholder="First name">
    `;
    const { observation, refMap } = snap();
    expect(observation.observationId).toBe('o1');
    expect(observation.capturedAt).toBe(NOW);
    expect(observation.title).toBe('Test Page');
    expect(observation.elements.map((e) => e.ref)).toEqual(['e1', 'e2', 'e3']);
    expect(refMap.get('e2')?.textContent).toBe('Submit Application');
  });

  it('maps roles: link, button, textbox, combobox, checkbox, radio', () => {
    document.body.innerHTML = `
      <a href="/x">L</a>
      <button>B</button>
      <textarea name="msg"></textarea>
      <select name="country"><option>USA</option></select>
      <input type="checkbox" name="agree">
      <input type="radio" name="opt">
      <div role="button">Custom</div>
    `;
    const roles = snap().observation.elements.map((e) => e.role);
    expect(roles).toEqual(['link', 'button', 'textbox', 'combobox', 'checkbox', 'radio', 'button']);
  });

  it('computes accessible names: aria-label > label[for] > placeholder > text', () => {
    document.body.innerHTML = `
      <button aria-label="Close dialog">X</button>
      <label for="em">Email address</label><input id="em" type="email" name="email">
      <input type="text" name="q" placeholder="Search...">
      <a href="/d">Docs</a>
    `;
    const names = snap().observation.elements.map((e) => e.name);
    expect(names).toEqual(['Close dialog', 'Email address', 'Search...', 'Docs']);
  });

  it('collects fieldHints from inputType/autocomplete/name', () => {
    document.body.innerHTML =
      '<input type="password" name="pw" autocomplete="current-password">';
    const [el] = snap().observation.elements;
    expect(el.fieldHints).toEqual({
      inputType: 'password', autocomplete: 'current-password', name: 'pw',
    });
  });

  it('surfaces select options so the AI never picks blind', () => {
    document.body.innerHTML = `
      <select name="country">
        <option value="">Choose...</option>
        <option value="us">United States</option>
        <option value="de">Germany</option>
      </select>`;
    const [el] = snap().observation.elements;
    expect(el.options).toEqual(['Choose...', 'United States', 'Germany']);
  });

  it('skips hidden/aria-hidden/type=hidden elements', () => {
    document.body.innerHTML = `
      <button hidden>Ghost</button>
      <input type="hidden" name="csrf">
      <div aria-hidden="true"><button>Invisible</button></div>
      <button>Visible</button>
    `;
    const names = snap().observation.elements.map((e) => e.name);
    expect(names).toEqual(['Visible']);
  });
});

describe('takeSnapshot — captcha & digest', () => {
  it('flags captchaPresent for recaptcha/hcaptcha/turnstile markers', () => {
    document.body.innerHTML = '<div class="g-recaptcha" data-sitekey="k"></div>';
    expect(snap().observation.captchaPresent).toBe(true);
    document.body.innerHTML = '<iframe src="about:blank#challenges.cloudflare.com/turnstile"></iframe>';
    expect(snap().observation.captchaPresent).toBe(true);
    document.body.innerHTML = '<p>No captcha here</p>';
    expect(snap().observation.captchaPresent).toBe(false);
  });

  it('textDigest is normalized body text (excludes script/style/template), capped at 2000 chars', () => {
    document.body.innerHTML = `<p>Hello   world</p><p>${'x'.repeat(3000)}</p>`;
    const d = snap().observation.textDigest;
    expect(d.startsWith('Hello world')).toBe(true);
    expect(d.length).toBeLessThanOrEqual(2000);
  });

  it('textDigest excludes script/style source', () => {
    document.body.innerHTML =
      `<p>Visible copy</p><script>const secret = "DO_NOT_LEAK";</script><style>.x{color:red}</style>`;
    const d = snap().observation.textDigest;
    expect(d).toContain('Visible copy');
    expect(d).not.toContain('DO_NOT_LEAK');
    expect(d).not.toContain('color:red');
  });

  it('produces a valid Observation per the protocol schema', async () => {
    document.body.innerHTML = '<button>OK</button>';
    const { ObservationSchema } = await import('@ai-in-browser/protocol');
    expect(ObservationSchema.safeParse(snap().observation).success).toBe(true);
  });
});

describe('takeSnapshot — widget classification', () => {
  it('classifies native select with options + value', () => {
    document.body.innerHTML = `<select name="c">
    <option value="">Choose</option><option value="us" selected>United States</option></select>`;
    const e = snap().observation.elements[0];
    expect(e.widget).toBe('native_select');
    expect(e.options).toEqual(['Choose', 'United States']);
    expect(e.value).toBe('United States');
  });

  it('flags a custom combobox: widget set, NO options harvested, value surfaced', () => {
    document.body.innerHTML = `<div role="combobox" aria-haspopup="listbox">Canada</div>`;
    const e = snap().observation.elements[0];
    expect(e.widget).toBe('combobox');
    expect(e.options).toBeUndefined();
    expect(e.value).toBe('Canada');
  });

  it('flags an async type-ahead combobox', () => {
    document.body.innerHTML = `<input role="combobox" aria-autocomplete="list" value="Sta">`;
    const e = snap().observation.elements[0];
    expect(e.widget).toBe('typeahead');
    expect(e.value).toBe('Sta');
  });
});

describe('takeSnapshot — required (slice 2b)', () => {
  it('flags aria-required="true"', () => {
    document.body.innerHTML = `<div role="combobox" aria-required="true">Choose</div>`;
    expect(snap().observation.elements[0].required).toBe(true);
  });

  it('flags a native required control', () => {
    document.body.innerHTML = `<input type="text" name="email" required>`;
    expect(snap().observation.elements[0].required).toBe(true);
  });

  it('flags a field whose label ends in an asterisk', () => {
    document.body.innerHTML = `<label for="q">Authorized to work?*</label><input id="q" name="q">`;
    expect(snap().observation.elements[0].required).toBe(true);
  });

  it('leaves required absent when nothing indicates it', () => {
    document.body.innerHTML = `<input type="text" name="nick">`;
    expect(snap().observation.elements[0].required).toBeUndefined();
  });
});
