import { describe, it, expect } from 'vitest';
import { ObservationSchema, BrowserActionSchema, ElementRefSchema } from '../src/schemas.js';
const validObservation = {
  observationId: 'o1', url: 'https://example.com', title: 'Example',
  capturedAt: '2026-06-12T00:00:00.000Z',
  elements: [
    { ref: 'e1', role: 'button', name: 'Submit', bounds: { x: 1, y: 2, w: 3, h: 4 } },
    { ref: 'e2', role: 'combobox', name: 'Country', bounds: { x: 0, y: 0, w: 10, h: 10 }, options: ['United States', 'Canada'] },
  ],
  textDigest: 'hello', captchaPresent: false,
};
describe('ObservationSchema', () => {
  it('accepts a valid observation', () => {
    expect(ObservationSchema.parse(validObservation)).toEqual(validObservation);
  });
  it('rejects an observation missing captchaPresent', () => {
    const { captchaPresent, ...bad } = validObservation;
    expect(() => ObservationSchema.parse(bad)).toThrow();
  });
});
it('ElementRefSchema accepts widget + value (slice 2a)', () => {
  const ref = {
    ref: 'e1', role: 'combobox', name: 'Country',
    bounds: { x: 0, y: 0, w: 10, h: 10 },
    widget: 'combobox', value: 'United States',
  };
  const parsed = ElementRefSchema.parse(ref);
  expect(parsed.widget).toBe('combobox');
  expect(parsed.value).toBe('United States');
});

it('ElementRefSchema accepts an optional required flag (slice 2b)', () => {
  const base = { ref: 'e1', role: 'combobox', name: 'Authorized?*', bounds: { x: 0, y: 0, w: 1, h: 1 } };
  expect(ElementRefSchema.parse({ ...base, required: true }).required).toBe(true);
  // absent is valid and parses to undefined
  expect(ElementRefSchema.parse(base).required).toBeUndefined();
});

it('ElementRefSchema rejects an unknown widget kind', () => {
  expect(() => ElementRefSchema.parse({
    ref: 'e1', role: 'combobox', name: 'x',
    bounds: { x: 0, y: 0, w: 1, h: 1 }, widget: 'dropdown',
  })).toThrow();
});

describe('BrowserActionSchema', () => {
  it('accepts each action kind', () => {
    expect(BrowserActionSchema.parse({ kind: 'navigate', url: 'https://x.com' }).kind).toBe('navigate');
    expect(BrowserActionSchema.parse({ kind: 'click', ref: 'e1', observationId: 'o1' }).kind).toBe('click');
    expect(BrowserActionSchema.parse({ kind: 'type', ref: 'e1', value: 'hi', observationId: 'o1' }).kind).toBe('type');
    expect(BrowserActionSchema.parse({ kind: 'select', ref: 'e1', option: 'Canada', observationId: 'o1' }).kind).toBe('select');
  });
  it('rejects an unknown action kind', () => {
    expect(() => BrowserActionSchema.parse({ kind: 'scroll', ref: 'e1' })).toThrow();
  });
});
