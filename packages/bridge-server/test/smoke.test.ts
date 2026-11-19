import { describe, it, expect } from 'vitest';
import { BRIDGE_VERSION } from '../src/index.js';

describe('bridge-server package', () => {
  it('exposes a version', () => {
    expect(BRIDGE_VERSION).toBe('slice-1');
  });
});
