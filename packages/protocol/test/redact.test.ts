import { describe, it, expect } from 'vitest';
import { redactAction, REDACTED } from '../src/redact.js';
import type { BrowserAction, PolicyDecision } from '../src/types.js';
const high: PolicyDecision = { risk: 'high', requiresApproval: true, blocked: false, reason: 'sensitive field' };
const medium: PolicyDecision = { risk: 'medium', requiresApproval: false, blocked: false, reason: 'ordinary text entry' };
describe('redactAction', () => {
  it('redacts the value of a sensitive (high) type', () => {
    const action: BrowserAction = { kind: 'type', ref: 'e1', value: 'hunter2', observationId: 'o1' };
    const out = redactAction(action, high);
    expect(out).toEqual({ kind: 'type', ref: 'e1', value: REDACTED, observationId: 'o1' });
    expect(JSON.stringify(out)).not.toContain('hunter2');
  });
  it('preserves an ordinary (medium) type value', () => {
    const action: BrowserAction = { kind: 'type', ref: 'e1', value: 'Pat', observationId: 'o1' };
    expect(redactAction(action, medium)).toEqual(action);
  });
  it('leaves non-type actions untouched', () => {
    const action: BrowserAction = { kind: 'select', ref: 'e1', option: 'Canada', observationId: 'o1' };
    expect(redactAction(action, medium)).toEqual(action);
  });
  it('does not mutate the input action', () => {
    const action: BrowserAction = { kind: 'type', ref: 'e1', value: 'secret', observationId: 'o1' };
    redactAction(action, high);
    expect(action.kind === 'type' && action.value).toBe('secret');
  });
});
