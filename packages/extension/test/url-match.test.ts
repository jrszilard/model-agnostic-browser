import { describe, it, expect } from 'vitest';
import { sameDocument } from '../src/url-match.js';

// sameDocument decides whether a navigate target is the SAME document the tab is already
// showing. If so, chrome.tabs.update({url}) is a no-op (no reload) and an orphaned
// pre-reload content script survives — the executor must force a reload instead.
describe('sameDocument', () => {
  it('true for identical urls', () => {
    expect(sameDocument('https://x.io/jobs/1', 'https://x.io/jobs/1')).toBe(true);
  });

  it('ignores a trailing slash', () => {
    expect(sameDocument('https://x.io/jobs/1/', 'https://x.io/jobs/1')).toBe(true);
  });

  it('ignores the hash (same document, in-page anchor)', () => {
    expect(sameDocument('https://x.io/jobs/1#application', 'https://x.io/jobs/1')).toBe(true);
  });

  it('false for a different path (a real navigation reloads on its own)', () => {
    expect(sameDocument('https://x.io/jobs/1', 'https://x.io/jobs/2')).toBe(false);
  });

  it('false for a different query (different document)', () => {
    expect(sameDocument('https://x.io/j?a=1', 'https://x.io/j?a=2')).toBe(false);
  });

  it('false when the current url is unknown', () => {
    expect(sameDocument(undefined, 'https://x.io/jobs/1')).toBe(false);
  });
});
