export interface SettleOptions {
  intervalMs?: number;                    // default 150
  maxMs?: number;                         // default 3000
  sleep?: (ms: number) => Promise<void>;  // injectable for tests
  now?: () => number;                     // injectable for tests
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls `takeDigest` until two successive reads match, or `maxMs` elapses.
 * Never throws: an unsettled page still gets observed (stale-ref protection
 * covers any mid-flight DOM churn).
 */
export async function settle(takeDigest: () => string, opts: SettleOptions = {}): Promise<void> {
  const intervalMs = opts.intervalMs ?? 150;
  const maxMs = opts.maxMs ?? 3000;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;

  const start = now();
  let prev = takeDigest();
  while (now() - start < maxMs) {
    await sleep(intervalMs);
    const cur = takeDigest();
    if (cur === prev) return;
    prev = cur;
  }
}
