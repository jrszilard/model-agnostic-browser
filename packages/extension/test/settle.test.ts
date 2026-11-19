import { describe, it, expect } from 'vitest';
import { settle } from '../src/settle.js';

/** Manual clock: sleep() resolves instantly but records the virtual time. */
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
  };
}

describe('settle', () => {
  it('returns once two successive digests match', async () => {
    const c = clock();
    const digests = ['a', 'b', 'c', 'c', 'c'];
    let reads = 0;
    await settle(() => digests[Math.min(reads++, digests.length - 1)], {
      intervalMs: 100, maxMs: 5000, sleep: c.sleep, now: c.now,
    });
    expect(reads).toBe(4); // a,b -> b,c -> c,c stable
  });

  it('gives up after maxMs without throwing', async () => {
    const c = clock();
    let reads = 0;
    await expect(settle(() => `never-stable-${reads++}`, {
      intervalMs: 100, maxMs: 300, sleep: c.sleep, now: c.now,
    })).resolves.toBeUndefined();
    expect(c.now()).toBeLessThanOrEqual(400);
  });

  it('returns immediately when the first two reads already match', async () => {
    const c = clock();
    await settle(() => 'same', { intervalMs: 100, maxMs: 5000, sleep: c.sleep, now: c.now });
    expect(c.now()).toBe(100); // exactly one interval
  });
});
