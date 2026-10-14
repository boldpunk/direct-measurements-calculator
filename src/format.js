import { getState, getOrderStatusTone } from './store.js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

// ---- Display currency ----
// Settings.fxRate ({from, to, rate}: 1 `from` = rate `to`) lets each viewer
// see sums in the company's second currency (Профиль → Валюта). Display
// only: inputs, saved values and PDFs stay in the company currency.
const DISPLAY_KEY = 'mebelflow_display_currency';

export function getDisplayCurrency() {
  try { return localStorage.getItem(DISPLAY_KEY) || ''; } catch { return ''; }
}
export function setDisplayCurrency(currency) {
  try { localStorage.setItem(DISPLAY_KEY, currency || ''); } catch { /* private mode */ }
}

// The second currency this company can be shown in, or null.
export function altCurrency() {
  const settings = getState()?.settings;
  const fx = settings?.fxRate;
  if (!fx || !(fx.rate > 0)) return null;
  if (fx.from === settings.currency) return fx.to;
  if (fx.to === settings.currency) return fx.from;
  return null;
}

// { value, currency } as the viewer wants to see it.
export function displayAmount(n, currencyOverride) {
  const settings = getState()?.settings;
  const base = settings?.currency || '$';
  const v = Number(n) || 0;
  if (currencyOverride) return { value: v, currency: currencyOverride };
  const want = getDisplayCurrency();
  const fx = settings?.fxRate;
  if (!want || want === base || !fx || !(fx.rate > 0) || altCurrency() !== want) return { value: v, currency: base };
  const converted = fx.from === base ? v * fx.rate : v / fx.rate;
  // Whole units for anything sizeable, cents for small amounts.
  const value = Math.abs(converted) >= 100 ? Math.round(converted) : Math.round(converted * 100) / 100;
  return { value, currency: want };
}

// currencyOverride is used by commercial proposals, which each carry their
// own currency rather than the instance-wide one.
export function money(n, currencyOverride) {
  const { value, currency } = displayAmount(n, currencyOverride);
  // No-break space before the currency: in a narrow table cell "4 200 $"
  // otherwise wraps into "4 200" / "$" on two lines.
  return `${value.toLocaleString('ru-RU')}\u00A0${currency}`;
}

// Like money(), but the currency may drop to the next line in a narrow box
// (the figure itself never splits).
export function moneyWrap(n, currencyOverride) {
  const { value, currency } = displayAmount(n, currencyOverride);
  return `<span class="nowrap">${value.toLocaleString('ru-RU')}</span> ${currency}`;
}

// KPI tiles: so'm totals run to 10+ digits ("2 761 141 000 so'm") and didn't
// fit a tile. From 10 million up, show "2,76 млрд so'm" / "56,6 млн so'm";
// the exact amount stays in the tooltip.
export function moneyKpi(n, currencyOverride) {
  const { value: v, currency } = displayAmount(n, currencyOverride);
  const abs = Math.abs(v);
  let figure = v.toLocaleString('ru-RU');
  if (abs >= 1e7) {
    const [div, unit, digits] = abs >= 1e9 ? [1e9, 'млрд', 2] : [1e6, 'млн', 1];
    figure = `${(v / div).toLocaleString('ru-RU', { maximumFractionDigits: digits })}\u00A0${unit}`;
  }
  // Currency in smaller type so the figure gets the room; in a really narrow
  // tile it drops under the figure instead of spilling out of the card.
  return `<span class="kpi__money" title="${v.toLocaleString('ru-RU')}\u00A0${currency}"><span class="kpi__figure">${figure}</span> <small>${currency}</small></span>`;
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
