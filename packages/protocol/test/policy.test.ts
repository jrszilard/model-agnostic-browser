import { describe, it, expect } from 'vitest';
import { classify } from '../src/policy.js';
import type { BrowserAction, ElementRef } from '../src/types.js';
const el = (over: Partial<ElementRef>): ElementRef => ({
  ref: 'e1', role: 'button', name: '', bounds: { x: 0, y: 0, w: 1, h: 1 }, ...over,
});
describe('classify: navigate', () => {
  it('is low and auto', () => {
    const d = classify({ kind: 'navigate', url: 'https://x.com' });
    expect(d).toMatchObject({ risk: 'low', requiresApproval: false, blocked: false });
  });
});
describe('classify: click', () => {
  const click: BrowserAction = { kind: 'click', ref: 'e1', observationId: 'o1' };
  it.each(['Submit', 'Submit Application', 'Apply Now', 'Place Order', 'Pay', 'Buy Now', 'Checkout', 'Send Message', 'Delete', 'Confirm Order'])(
    'gates high-risk label %s', (name) => {
      const d = classify(click, el({ name }));
      expect(d).toMatchObject({ risk: 'high', requiresApproval: true, blocked: false });
    });
  it.each(['Next', 'Continue', 'Save and Continue', 'Pricing', 'Learn More', 'Cancel', 'Back'])(
    'auto-executes ordinary label %s', (name) => {
      const d = classify(click, el({ name }));
      expect(d).toMatchObject({ risk: 'medium', requiresApproval: false, blocked: false });
    });
  it('fails closed to high when the target is missing', () => {
    const d = classify(click, undefined);
    expect(d).toMatchObject({ risk: 'high', requiresApproval: true });
  });
});
describe('classify: type', () => {
  const type: BrowserAction = { kind: 'type', ref: 'e1', value: 'x', observationId: 'o1' };
  it('gates a password input', () => {
    const d = classify(type, el({ role: 'textbox', fieldHints: { inputType: 'password' } }));
    expect(d).toMatchObject({ risk: 'high', requiresApproval: true });
  });
  it.each(['cc-number', 'cc-csc', 'current-password', 'new-password'])(
    'gates sensitive autocomplete %s', (autocomplete) => {
      const d = classify(type, el({ fieldHints: { autocomplete } }));
      expect(d.risk).toBe('high');
    });
  it.each(['ssn', 'creditCard', 'routingNumber', 'iban'])(
    'gates sensitive field name %s', (name) => {
      const d = classify(type, el({ fieldHints: { name } }));
      expect(d.risk).toBe('high');
    });
  it.each([
    { inputType: 'text', name: 'firstName' },
    { inputType: 'email', autocomplete: 'email' },
    { inputType: 'tel', autocomplete: 'tel' },
    { name: 'message' },
  ])('auto-executes ordinary field %o', (fieldHints) => {
    const d = classify(type, el({ role: 'textbox', fieldHints }));
    expect(d).toMatchObject({ risk: 'medium', requiresApproval: false });
  });
  it.each(['success', 'accessToken', 'accountName', 'occupancy'])(
    'does not gate ordinary field name %s (regex false-positive guard)', (name) => {
      const d = classify(type, el({ fieldHints: { name } }));
      expect(d).toMatchObject({ risk: 'medium', requiresApproval: false });
    });
});
describe('classify: select', () => {
  it('is medium and auto', () => {
    const d = classify({ kind: 'select', ref: 'e1', option: 'Canada', observationId: 'o1' }, el({ role: 'combobox', name: 'Country' }));
    expect(d).toMatchObject({ risk: 'medium', requiresApproval: false, blocked: false });
  });
});

it('select stays medium/auto for a custom combobox target (slice 2a safety guard)', () => {
  const target = {
    ref: 'e1', role: 'combobox', name: 'Country',
    bounds: { x: 0, y: 0, w: 1, h: 1 }, widget: 'combobox' as const,
  };
  const d = classify({ kind: 'select', ref: 'e1', option: 'United States', observationId: 'o1' }, target);
  expect(d.risk).toBe('medium');
  expect(d.requiresApproval).toBe(false);
  expect(d.blocked).toBe(false);
});
