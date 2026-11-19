import { describe, it, expect } from 'vitest';
import type { Observation, ActionResult, HandoffEvent } from '@ai-in-browser/protocol';
import { formatObservation, formatResult, formatHandoff } from '../src/format.js';

const obs = (over: Partial<Observation> = {}): Observation => ({
  observationId: 'o1',
  url: 'http://127.0.0.1/form',
  title: 'Form',
  capturedAt: '2026-06-15T00:00:00.000Z',
  elements: [
    { ref: 'e1', role: 'textbox', name: 'Full name', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    { ref: 'e2', role: 'combobox', name: 'Country', bounds: { x: 0, y: 0, w: 1, h: 1 }, options: ['United States', 'Germany'] },
  ],
  textDigest: 'a form',
  captchaPresent: false,
  ...over,
});

describe('formatObservation', () => {
  it('emits actionable JSON: observationId, url, refs, roles, names, select options', () => {
    const parsed = JSON.parse(formatObservation(obs()));
    expect(parsed.observationId).toBe('o1');
    expect(parsed.url).toBe('http://127.0.0.1/form');
    expect(parsed.captchaPresent).toBe(false);
    expect(parsed.elements).toEqual([
      { ref: 'e1', role: 'textbox', name: 'Full name' },
      { ref: 'e2', role: 'combobox', name: 'Country', options: ['United States', 'Germany'] },
    ]);
    expect(parsed.textDigest).toBe('a form');
  });

  it('omits the options key when an element has none', () => {
    const parsed = JSON.parse(formatObservation(obs()));
    expect('options' in parsed.elements[0]).toBe(false);
  });

  it('emits required:true when set, and omits it otherwise (slice 2b)', () => {
    const o = {
      observationId: 'o1', url: 'http://127.0.0.1/form', title: 'Form', capturedAt: 't',
      textDigest: 'a form', captchaPresent: false,
      elements: [
        { ref: 'e1', role: 'textbox', name: 'First Name', bounds: { x: 0, y: 0, w: 1, h: 1 } },
        { ref: 'e2', role: 'combobox', name: 'Authorized?*', bounds: { x: 0, y: 0, w: 1, h: 1 }, widget: 'typeahead' as const, required: true },
      ],
    };
    const parsed = JSON.parse(formatObservation(o));
    expect('required' in parsed.elements[0]).toBe(false);
    expect(parsed.elements[1].required).toBe(true);
  });
});

describe('formatResult', () => {
  const decision = { risk: 'medium' as const, requiresApproval: false, blocked: false, reason: 'ordinary field' };

  it('summarizes status + risk + reason, and appends the post-action page when present', () => {
    const r: ActionResult = { actionId: 'a1', status: 'executed', decision, observation: obs() };
    const text = formatResult(r);
    expect(text).toContain('status: executed');
    expect(text).toContain('risk: medium');
    expect(text).toContain('reason: ordinary field');
    expect(text).toContain('--- page after action ---');
    expect(text).toContain('"observationId": "o1"');
  });

  it('shows approvedBy when an approval gate ran, and the error when one is set', () => {
    const high = { risk: 'high' as const, requiresApproval: true, blocked: false, reason: 'high-risk control "Submit"' };
    const approved: ActionResult = { actionId: 'a2', status: 'executed', decision: high, approvedBy: 'user', observation: obs() };
    expect(formatResult(approved)).toContain('approvedBy: user');
    const errored: ActionResult = { actionId: 'a3', status: 'error', decision, error: 'not clickable' };
    const text = formatResult(errored);
    expect(text).toContain('status: error');
    expect(text).toContain('error: not clickable');
    expect(text).not.toContain('--- page after action ---');
  });
});

describe('formatHandoff', () => {
  it('renders the outcome and the reason', () => {
    const h: HandoffEvent = { ts: 't', clientId: 'mcp', url: 'u', reason: 'your turn', outcome: 'continued' };
    const text = formatHandoff(h);
    expect(text).toContain('outcome: continued');
    expect(text).toContain('your turn');
  });
});

it('formatObservation includes widget + value for dropdown controls', () => {
  const out = formatObservation({
    observationId: 'o1', url: 'u', title: 't', capturedAt: 'T', captchaPresent: false, textDigest: '',
    elements: [{ ref: 'e1', role: 'combobox', name: 'Country', bounds: { x: 0, y: 0, w: 1, h: 1 }, widget: 'combobox', value: 'Canada' }],
  });
  expect(out).toContain('"widget": "combobox"');
  expect(out).toContain('"value": "Canada"');
});

it('formatResult surfaces availableOptions on no_match so the AI can retry', () => {
  const out = formatResult({
    actionId: 'a1', status: 'no_match',
    decision: { risk: 'medium', requiresApproval: false, blocked: false, reason: 'ordinary dropdown' },
    availableOptions: ['United States', 'Canada'],
  });
  expect(out).toContain('status: no_match');
  expect(out).toContain('availableOptions: United States, Canada');
});
