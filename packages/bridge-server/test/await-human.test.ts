import { describe, it, expect } from 'vitest';
import { Bridge } from '../src/bridge.js';
import { FakeExtension } from '../src/fake-extension.js';
import { InMemoryAuditSink } from '../src/audit.js';
import type { Observation, HandoffEvent } from '@ai-in-browser/protocol';

const obs: Observation = {
  observationId: 'o1', url: 'https://example.com', title: 'T',
  capturedAt: '2026-06-12T00:00:00.000Z', elements: [], textDigest: '', captchaPresent: false,
};

describe('Bridge.awaitHuman', () => {
  it('requests a handoff and audits a HandoffEvent', async () => {
    const ext = new FakeExtension();
    const audit = new InMemoryAuditSink();
    const bridge = new Bridge({ connection: ext, audit, now: () => 't', newActionId: () => 'aid' });
    ext.nextObservation = obs;
    await bridge.observe();
    ext.handoff = 'took_over';

    const e = await bridge.awaitHuman('this field is yours', 'mcp');

    expect(e.outcome).toBe('took_over');
    expect(e.reason).toBe('this field is yours');
    expect(ext.handoffReasons).toEqual(['this field is yours']);
    expect(audit.records).toHaveLength(1);
    const rec = audit.records[0] as HandoffEvent;
    expect(rec).toMatchObject({ reason: 'this field is yours', outcome: 'took_over', url: 'https://example.com' });
  });
});
