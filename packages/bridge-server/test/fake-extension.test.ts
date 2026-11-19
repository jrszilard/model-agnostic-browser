import { describe, it, expect } from 'vitest';
import { FakeExtension } from '../src/fake-extension.js';
import type { Observation } from '@ai-in-browser/protocol';

const obs: Observation = {
  observationId: 'o1', url: 'https://x.com', title: 'T',
  capturedAt: '2026-06-12T00:00:00.000Z', elements: [], textDigest: '', captchaPresent: false,
};

describe('FakeExtension', () => {
  it('returns scripted values and records calls', async () => {
    const ext = new FakeExtension();
    ext.nextObservation = obs;
    expect((await ext.observe()).observationId).toBe('o1');

    ext.approval = 'denied';
    const outcome = await ext.requestApproval({
      action: { kind: 'navigate', url: 'x' },
      decision: { risk: 'low', requiresApproval: false, blocked: false, reason: '' },
    });
    expect(outcome).toBe('denied');

    await ext.execute({ kind: 'navigate', url: 'x' });
    expect(ext.executed).toHaveLength(1);

    ext.handoff = 'took_over';
    expect(await ext.requestHandoff('why')).toBe('took_over');
    expect(ext.handoffReasons).toEqual(['why']);
  });

  it('observe throws if nothing is scripted', async () => {
    const ext = new FakeExtension();
    await expect(ext.observe()).rejects.toThrow();
  });
});
