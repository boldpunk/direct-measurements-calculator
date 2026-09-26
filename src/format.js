import { getState, getOrderStatusTone } from './store.js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

// currencyOverride is used by commercial proposals, which each carry their
// own currency rather than the instance-wide one.
export function money(n, currencyOverride) {
  const v = Number(n) || 0;
  const currency = currencyOverride || getState().settings?.currency || '$';
  return `${v.toLocaleString('ru-RU')} ${currency}`;
}

// Mirrors bundledBrandLogo() in server/src/pdf-proposal.js: the same key rule
// over the same files in public/brand-logos, so what the editor previews is
// what the КП PDF draws. Returns '' when the brand has no own logo and its
// name yields no key; a key that has no file 404s and the <img> is dropped by
// its own onerror, falling back to the placeholder/name.
export function brandLogoSrc(brand) {
  if (brand?.logoUrl) return brand.logoUrl;
  const key = String(brand?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key ? `/brand-logos/${key}.png` : '';
}

export function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

export function formatPhone(value) {
  if (!value) return '';
  const parsed = parsePhoneNumberFromString(String(value));
  return parsed ? parsed.formatInternational() : String(value);
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function statusBadgeClass(status) {
  switch (status) {
    case 'готово': return 'badge badge--done';
    case 'в работе': return 'badge badge--active';
    case 'проверка': return 'badge badge--review';
    case 'ожидает': return 'badge badge--pending';
    default: return 'badge';
  }
}

export function priorityBadgeClass(priority) {
  switch (priority) {
    case 'Срочно': return 'badge badge--urgent';
    case 'Высокий': return 'badge badge--high';
    case 'Низкий': return 'badge badge--muted';
    default: return 'badge badge--medium';
  }
}

export function orderStatusBadgeClass(status) {
  return `badge badge--tone-${getOrderStatusTone(status)}`;
}

export function deadlineBadgeClass(tone) {
  return `badge badge--tone-${tone}`;
}
