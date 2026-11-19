import type { BrowserAction, ElementRef, PolicyDecision } from './types.js';
// Deliberately conservative: a safety classifier over-gates rather than under-gates,
// so ordinary labels containing apply/send/confirm (e.g. "Apply Filter") may gate. That
// is an accepted tradeoff — gating an extra button is safe; missing a real submit is not.
const SUBMIT_PATTERN = /(submit|apply|purchase|checkout|place\s*order|\bpay\b|\bbuy\b|\bsend\b|\bdelete\b|confirm)/i;
// Matched against a field's inputType / autocomplete / name. `\bcc-` targets the HTML
// autocomplete cc-* tokens (cc-number, cc-csc) WITHOUT matching words like "success".
const SENSITIVE_PATTERN =
  /(password|passwd|\bcc-|credit|card|cvc|cvv|\bssn\b|social[ -]?security|routing|account.?number|\biban\b|\bpin\b|\bbank)/i;
function decision(risk: PolicyDecision['risk'], requiresApproval: boolean, reason: string, blocked = false): PolicyDecision {
  return { risk, requiresApproval, blocked, reason };
}
function isSensitiveField(el: ElementRef): boolean {
  const h = el.fieldHints;
  if (!h) return false;
  if (h.inputType && h.inputType.toLowerCase() === 'password') return true;
  if (h.autocomplete && SENSITIVE_PATTERN.test(h.autocomplete)) return true;
  if (h.name && SENSITIVE_PATTERN.test(h.name)) return true;
  return false;
}
export function classify(action: BrowserAction, target?: ElementRef): PolicyDecision {
  switch (action.kind) {
    case 'navigate':
      return decision('low', false, 'navigation');
    case 'click':
      if (!target) return decision('high', true, 'unresolved click target — gating');
      return SUBMIT_PATTERN.test(target.name)
        ? decision('high', true, `high-risk control "${target.name}"`)
        : decision('medium', false, 'ordinary click');
    case 'type':
      if (!target) return decision('high', true, 'unresolved type target — gating');
      return isSensitiveField(target)
        ? decision('high', true, 'sensitive field')
        : decision('medium', false, 'ordinary text entry');
    case 'select':
      if (!target) return decision('high', true, 'unresolved select target — gating');
      return decision('medium', false, 'ordinary dropdown');
    default: {
      const _exhaustive: never = action;
      throw new Error(`classify: unhandled action kind ${String((action as { kind?: unknown }).kind)}`);
    }
  }
}
