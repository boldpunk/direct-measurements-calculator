// Light / dark / follow-the-device theme. The choice is a per-browser
// convenience, so localStorage is the right home for it (and every access is
// guarded — storage can be blocked). index.html applies the saved value
// before first paint; this module changes it at runtime.

const KEY = 'mebelflow_theme';
const TOPBAR = { light: '#FFFFFF', dark: '#161A21' };

export function getThemePreference() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setThemePreference(pref) {
  const root = document.documentElement;
  if (pref === 'dark' || pref === 'light') root.setAttribute('data-theme', pref);
  else root.removeAttribute('data-theme');
  try {
    if (pref === 'dark' || pref === 'light') localStorage.setItem(KEY, pref);
    else localStorage.removeItem(KEY);
  } catch {
    // Not persisted — still applied for this visit.
  }
  // index.html carries one theme-color per scheme; a forced theme pins both
  // to that theme's top-bar colour, "auto" restores the pair.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const scheme = (meta.getAttribute('media') || '').includes('dark') ? 'dark' : 'light';
    meta.setAttribute('content', pref === 'auto' ? TOPBAR[scheme] : TOPBAR[pref]);
  });
}
