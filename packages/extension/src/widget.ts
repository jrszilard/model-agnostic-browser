export type Widget = 'native_select' | 'combobox' | 'typeahead';

/**
 * Classify a control into a dropdown widget kind, or null if it isn't one.
 * Shared by the snapshot (observe) and the executor (which re-derives from the
 * LIVE element, never trusting a stale observation). Attribute-based, no I/O.
 */
export function classifyWidget(el: Element): Widget | null {
  if (el instanceof HTMLSelectElement) return 'native_select';
  const role = el.getAttribute('role');
  const isCombobox = role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox';
  if (!isCombobox) return null;
  const auto = el.getAttribute('aria-autocomplete');
  return auto === 'list' || auto === 'both' ? 'typeahead' : 'combobox';
}

/** Current displayed value of a dropdown control (no opening). */
export function currentValue(el: Element): string {
  if (el instanceof HTMLSelectElement) {
    const o = el.options[el.selectedIndex];
    return (o?.label || o?.text || '').trim();
  }
  if (el instanceof HTMLInputElement) return el.value.trim();
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}
