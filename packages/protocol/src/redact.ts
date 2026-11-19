import type { BrowserAction, PolicyDecision } from './types.js';
export const REDACTED = '[redacted]';
export function redactAction(action: BrowserAction, decision: PolicyDecision): BrowserAction {
  if (action.kind === 'type' && decision.risk === 'high') {
    return { ...action, value: REDACTED };
  }
  return action;
}
