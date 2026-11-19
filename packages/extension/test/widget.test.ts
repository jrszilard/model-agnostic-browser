// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { classifyWidget } from '../src/widget.js';

beforeEach(() => { document.body.innerHTML = ''; });

const el = (html: string): Element => {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
};

describe('classifyWidget', () => {
  it('native <select> -> native_select', () => {
    expect(classifyWidget(el('<select><option>A</option></select>'))).toBe('native_select');
  });
  it('[role=combobox] without aria-autocomplete -> combobox', () => {
    expect(classifyWidget(el('<div role="combobox" aria-haspopup="listbox">Pick</div>'))).toBe('combobox');
  });
  it('combobox input with aria-autocomplete -> typeahead', () => {
    expect(classifyWidget(el('<input role="combobox" aria-autocomplete="list">'))).toBe('typeahead');
  });
  it('aria-haspopup=listbox alone -> combobox', () => {
    expect(classifyWidget(el('<button aria-haspopup="listbox">Menu</button>'))).toBe('combobox');
  });
  it('a plain button -> null', () => {
    expect(classifyWidget(el('<button>Go</button>'))).toBeNull();
  });
});

it('classifies a bounded React-Select (aria-autocomplete=list) as typeahead — classification is NOT the execution gate (slice 2b)', () => {
  document.body.innerHTML = `<input role="combobox" aria-autocomplete="list">`;
  expect(classifyWidget(document.querySelector('input')!)).toBe('typeahead');
});
