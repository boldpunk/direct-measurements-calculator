// Logo and favicon are stored in Settings as base64 data URIs. Shipping them
// inside /api/state and /api/branding made every page load re-download them
// (~50 KB of a 200 KB state on Sobirov). Instead the JSON carries a short,
// content-versioned URL and the image itself is served once and cached.
import crypto from 'node:crypto';

const DATA_URI = /^data:([\w.+/-]+)(;base64)?,(.*)$/s;

export function parseDataUri(value) {
  const m = DATA_URI.exec(String(value || ''));
  if (!m) return null;
  const body = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { type: m[1], body };
}

// kind: 'logo' | 'favicon'. A plain http(s) URL is passed through untouched.
export function brandingAssetUrl(kind, value) {
  if (!value) return null;
  if (!String(value).startsWith('data:')) return value;
  const v = crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
  return `/api/branding/${kind}?v=${v}`;
}

// Settings PUT must never store one of our own asset URLs back as the logo
// (a client echoing what it received would replace the image with a link to
// itself).
export function isBrandingAssetUrl(value) {
  return typeof value === 'string' && value.includes('/api/branding/');
}
