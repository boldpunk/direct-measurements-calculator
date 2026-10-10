import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandingAssetUrl, parseDataUri, isBrandingAssetUrl } from '../src/branding-assets.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('data URIs become short, content-versioned URLs', () => {
  const url = brandingAssetUrl('logo', PNG);
  assert.match(url, /^\/api\/branding\/logo\?v=[0-9a-f]{12}$/);
  assert.equal(brandingAssetUrl('logo', PNG), url, 'stable for the same image');
  assert.notEqual(brandingAssetUrl('logo', PNG + 'A'), url, 'changes with the image');
});

test('empty and plain URLs pass through', () => {
  assert.equal(brandingAssetUrl('logo', null), null);
  assert.equal(brandingAssetUrl('logo', 'https://x/y.png'), 'https://x/y.png');
});

test('parseDataUri decodes base64 and plain payloads', () => {
  const png = parseDataUri(PNG);
  assert.equal(png.type, 'image/png');
  assert.deepEqual([...png.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const svg = parseDataUri('data:image/svg+xml,%3Csvg%2F%3E');
  assert.equal(svg.type, 'image/svg+xml');
  assert.equal(svg.body.toString(), '<svg/>');
  assert.equal(parseDataUri('https://x'), null);
});

test('our own asset URLs are recognised so they are never saved as the logo', () => {
  assert.equal(isBrandingAssetUrl('/api/branding/logo?v=abc'), true);
  assert.equal(isBrandingAssetUrl('https://crm.example/api/branding/favicon?v=1'), true);
  assert.equal(isBrandingAssetUrl(PNG), false);
});
