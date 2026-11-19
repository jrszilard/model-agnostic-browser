/**
 * True when `target` is the same document the tab already shows (ignoring hash and a
 * trailing slash). Navigating a tab to the same document via chrome.tabs.update is a
 * no-op — no reload fires — so an orphaned pre-reload content script survives after an
 * extension reload. The executor uses this to force a reload instead (a different
 * document reloads on its own). Query string differences ARE significant (different doc).
 */
export function sameDocument(current: string | undefined, target: string): boolean {
  if (!current) return false;
  const norm = (u: string): string => {
    try {
      const x = new URL(u);
      return x.origin + x.pathname.replace(/\/+$/, '') + x.search;
    } catch {
      return u.split('#')[0].replace(/\/+$/, '');
    }
  };
  return norm(current) === norm(target);
}
