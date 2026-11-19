import { describe, it, expect } from 'vitest';
import { BridgeRequestSchema, ExtensionMessageSchema } from '../src/wire.js';

const obs = {
  observationId: 'o1', url: 'https://x.com', title: 'T',
  capturedAt: '2026-06-12T00:00:00.000Z', elements: [], textDigest: '', captchaPresent: false,
};

describe('BridgeRequestSchema (bridge -> extension)', () => {
  it.each([
    [{ id: 'r1', type: 'observe' }],
    [{ id: 'r2', type: 'execute', action: { kind: 'click', ref: 'e1', observationId: 'o1' } }],
    [{
      id: 'r3', type: 'requestApproval',
      action: { kind: 'click', ref: 'e2', observationId: 'o1' },
      decision: { risk: 'high', requiresApproval: true, blocked: false, reason: 'high-risk control "Submit"' },
      target: { ref: 'e2', role: 'button', name: 'Submit', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    }],
    [{ id: 'r4', type: 'requestHandoff', reason: 'this field is yours' }],
    [{ id: 'p1', type: 'pong' }],
  ])('accepts %j', (msg) => {
    expect(BridgeRequestSchema.safeParse(msg).success).toBe(true);
  });

  it.each([
    [{ type: 'observe' }],                                   // missing id
    [{ id: 'r1', type: 'launch_missiles' }],                 // unknown type
    [{ id: 'r2', type: 'execute', action: { kind: 'click' } }], // malformed action
  ])('rejects %j', (msg) => {
    expect(BridgeRequestSchema.safeParse(msg).success).toBe(false);
  });
});

describe('ExtensionMessageSchema (extension -> bridge)', () => {
  it.each([
    [{ id: 'r1', type: 'observation', observation: obs }],
    [{ id: 'r2', type: 'executed', status: 'executed', observation: obs }],
    [{ id: 'r2', type: 'executed', status: 'stale_ref' }],
    [{ id: 'r2', type: 'executed', status: 'error', error: 'not clickable' }],
    [{ id: 'r3', type: 'approval', outcome: 'denied' }],
    [{ id: 'r4', type: 'handoff', outcome: 'took_over' }],
    [{ id: 'r9', type: 'error', message: 'no active tab' }],
    [{ id: 'p1', type: 'ping' }],
  ])('accepts %j', (msg) => {
    expect(ExtensionMessageSchema.safeParse(msg).success).toBe(true);
  });

  it.each([
    [{ id: 'r1', type: 'observation', observation: { url: 'x' } }], // malformed observation
    [{ id: 'r3', type: 'approval', outcome: 'maybe' }],             // invalid outcome
    [{ id: 'r2', type: 'executed', status: 'denied' }],             // exec can't produce policy outcomes
  ])('rejects %j', (msg) => {
    expect(ExtensionMessageSchema.safeParse(msg).success).toBe(false);
  });
});

describe('slice-2a round-trip guards', () => {
  it('executed message round-trips no_match + availableOptions (slice 2a)', () => {
    const parsed = ExtensionMessageSchema.parse({
      id: 'x', type: 'executed', status: 'no_match', availableOptions: ['A', 'B'],
    });
    expect(parsed).toMatchObject({ status: 'no_match', availableOptions: ['A', 'B'] });
  });
});

describe('untrusted-boundary hardening', () => {
  it('strips unknown keys rather than rejecting (top-level and nested)', () => {
    const parsed = BridgeRequestSchema.parse({
      id: 'r1', type: 'execute',
      action: { kind: 'click', ref: 'e1', observationId: 'o1', injected: 'evil' },
      smuggled: 'payload',
    });
    expect(parsed).not.toHaveProperty('smuggled');
    expect(parsed.type === 'execute' && (parsed.action as Record<string, unknown>).injected).toBeUndefined();
  });

  it('rejects a wrong-typed field even when the discriminator + required keys are present', () => {
    const msg = {
      id: 'r1', type: 'observation',
      observation: {
        observationId: 'o1', url: 'https://x.com', title: 'T',
        capturedAt: '2026-06-12T00:00:00.000Z', elements: [], textDigest: '',
        captchaPresent: 'yes', // should be boolean
      },
    };
    expect(ExtensionMessageSchema.safeParse(msg).success).toBe(false);
  });

  it('routes by discriminator: an approval outcome cannot borrow an executed-status value', () => {
    // 'executed' is a valid executed.status but NOT a valid approval outcome
    expect(ExtensionMessageSchema.safeParse({ id: 'x', type: 'approval', outcome: 'executed' }).success).toBe(false);
  });
});
